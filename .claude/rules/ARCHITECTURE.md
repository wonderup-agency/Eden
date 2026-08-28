# Architecture

## Overview

The project has two distinct parts:

1. **Browser code** (`src/`) — components and pages that run on the Webflow site
2. **Tooling** (`scripts/`, config files) — build pipeline, scaffolding scripts

These never mix. Browser code is bundled by Rollup into `dist/`. Tooling runs in Node.js only.

## Browser Runtime Flow

```
Webflow page loads
  → <script src="main.js" type="module" defer>
    → main.js waits for DOMContentLoaded (or runs immediately if DOM is ready)
    → main.js imports components.js (the registry)
    → main.js dynamically imports global.js
      → global.js default function runs (site-wide setup)
    → main.js iterates the registry:
      → For each component, checks if selector exists on the page
      → If yes: dynamically imports the component module
      → Calls the default function with matching elements
      → Stores returned lifecycle hooks (resize, breakpoint)
    → Window resize event (debounced 150ms) fires hooks on all active components
      (but only when the viewport WIDTH changes — height-only resizes from the
       mobile address bar show/hide are ignored, since the expensive resize hooks
       like ScrollTrigger.refresh() stalled scroll on every address-bar tick)
    → Breakpoint changes fire breakpoint hooks with current and previous values
```

### The LCP critical path

**The hero cannot paint until our JS runs**, because the anti-FOUC gate holds
`[data-component="hero"]` at `opacity: 0` until `hero.js` lifts it. That makes the entire
module graph a dependency of the Largest Contentful Paint, and `main.js` discovers it one
hop at a time:

```
main.js  →  await import(global.js)  →  import(hero.js)  →  import(word-reveal.js)
```

Those chunks are **~500 bytes each**. The cost is not bytes — it is **three sequential
round trips** to jsDelivr, each undiscoverable until the previous one has been parsed,
with the LCP element waiting behind all of them. Measured on mobile (2026-08-06 audit,
before the fix): **FCP 5.3s, LCP 5.7s** — only 0.4s apart, which is the tell: the paint was
gated on this chain, not on the 6 MB of hero video.

The fix is `modulepreload` in the Webflow head for `main.js`, `global.js`, `word-reveal.js`,
`hero.js` and `nav.js`, so the whole graph downloads in parallel during head parse. Mirror:
`webflow-snippet.html`.

Two consequences to keep in mind:

- **Chunk filenames must stay stable** — that is why the content hash was removed (see
  `ROLLUP.md`). A hashed name would break every preload link on each build.
- **Putting a new component on the LCP path means adding it to that list**, or it silently
  costs a round trip again. The list is a contract, not an optimisation detail.

> A tempting alternative is to drop `[data-component="hero"]` from the gate so the
> server-rendered hero paints immediately. That trades the round trips for a visible flash
> of the un-animated hero followed by it re-animating — which is the exact thing the gate
> exists to prevent. Preloading buys the same LCP without the flash.

Key design decisions:

- **Code splitting**: Components only load if their DOM selector is present. A page with no `data-component` attributes loads zero component code.
- **Isolation**: Each component is independent. A failing component doesn't break others (try/catch per component).
- **No framework**: Vanilla JS. Components receive raw DOM elements and work with them directly.

## Component System

### Registry (`src/components.js`)

An array of `{ selector, importFn }` objects. The selector is usually `data-component` attribute matching, but it can be **any CSS selector** — e.g. a cross-cutting reveal keyed on a boolean attribute like `[data-title-animation='True']`. `main.js` queries whatever selector is given; `getComponentName()` reads the `data-component` value, falling back to the `data-*` attribute name for the dev-log label. The `importFn` is a dynamic import function for code splitting.

**Orchestrator components**: a registered component can itself be a thin orchestrator over several **modules**. `blog-post` (`src/components/blog-post/`) is the example — one `data-component="blog-post"` on the article root runs five feature modules (`toc`, `lightbox`, `table-collapse`, `share`, `references`), each `export`ing an `init*(root)` and living in the same folder. The modules are **not** registered independently; `blog-post.js` imports them, runs each in an isolated try/catch, and aggregates their `resize` hooks. Group a feature's files under a folder named after the orchestrator when they're always used together (all five here are blog-post-scoped and co-occur).

### Loading (`src/main.js`)

1. Queries DOM for each selector
2. Skips components with no matching elements
3. Dynamically imports the module
4. Calls the default export with the element array
5. Collects lifecycle hooks from the return value
6. After **all** components have initialised (`Promise.all`), calls `ScrollTrigger.refresh()` once (if present). Components load in parallel, so the ScrollTriggers they create are registered in non-deterministic order; per-component refreshes during init run before every trigger exists, so positions (and any pin-spacing) can be miscalculated. This one authoritative refresh recomputes everything together in page order. There are **no GSAP-pinned sections** — `paradigm` is now an autoplay tabs component (time-driven, `IntersectionObserver`, no ScrollTrigger) and `scroll-morph` is a normal in-flow section that fires a **timed, once** ring assembly when it scrolls into view (no pin, no scrub, no sticky). The refresh still matters for the remaining ScrollTrigger users (`scroll-morph`, `title-animation`) so their trigger start/end stay exact after all sections lay out.

### Global (`src/components/global.js`)

Loaded before any components. Runs on every page regardless of data attributes. Use for analytics, global event listeners, shared setup.

**Perf monitor** (`PERF` flag, temporary diagnostic): a single rAF loop that logs only janky frames (slower than `LONG_FRAME` ms) with the `scrollY` and the `[data-component]` section centered in the viewport, plus a rolling FPS once a second. Used to pinpoint which section drops frames on mobile without the observer effect of per-frame logging. Set `PERF = false` to remove before deploy.

**Smooth scroll (Lenis)** lives here. It's initialised **desktop-only** (`min-width: 992px` via `matchMedia`) — tablet and below keep native scroll. The matchMedia listener starts/stops Lenis reactively as the viewport crosses 992px (no reload). `window.Lenis` is expected as a global (loaded site-wide in Webflow, same as GSAP). When GSAP is present, Lenis is driven by the GSAP ticker and `lenis.on('scroll', ScrollTrigger.update)` keeps pinned ScrollTriggers in sync (single rAF). Skipped entirely under `prefers-reduced-motion`. The Lenis **library** `<script>` stays in the Webflow head; the **init** must NOT also live there (it's here now) or smooth scroll double-initialises. Pinned at **`lenis@1.3.26`** (`cdn.jsdelivr.net/npm/lenis@1.3.26/dist/lenis.min.js`, `defer` — its UMD build sets `globalThis.Lenis`, which is what `new Lenis()` here needs).

**Lenis's scroll limit is re-measured by US, not by Lenis** (fixed 2026-08-19). Lenis caches
the document height at init and clamps the scroll to it. Its own `ResizeObserver` watches
`document.documentElement` — and on this site that element's box **is the viewport**
(measured: `900px` tall against a `9156px` body), so it **never fires** and the cached limit
is frozen at whatever the page happened to measure on init. Anything that grows the page
afterwards — lazy images decoding, webfonts reflowing copy, a component's own enhancement —
is then simply **unreachable by scrolling**, with no error anywhere.

> **This is what "sometimes About Us won't scroll past Headquarters" was.** Measured on a
> cold load: Lenis stopped at **7059px** of an **8256px** page, and the headquarters section
> — the last one before the footer — starts at **7074px**. The page had grown ~1200px after
> init (`7959 → 9156`). It was intermittent because a **warm cache** measures the final
> height at init and the page never grows, so the bug disappears on reload. Nothing to do
> with the tabs component: `lenis.resize()` in the console restored the full range instantly,
> with the tabs untouched.

So `start()` attaches a `ResizeObserver` on **`document.body`** — the element that *does*
track content height — calling `lenis.resize()`. `stop()` disconnects it. RO delivers at most
once per frame and after layout, so a height tween (the tabs accordion, `fitPanels`) costs one
cheap re-measure per frame rather than a layout thrash. **Don't move the observer back to
`documentElement`** — that is precisely the element that doesn't report this.

> **This whole block was dead code between some point before 2026-08-06 and that date, and nothing surfaced it.** The `<script>` had gone missing from the Webflow head, so `window.Lenis` was undefined on **every** page. `global.js` handles that by design — one `console.warn` and native scroll — so the failure was completely silent in production, and it silently took **four** features with it: desktop smooth scroll, the anchor→Lenis bridge, `research-search`'s pagination scroll and the blog TOC's scroll. The audit found it by checking `window.Lenis` on the live pages rather than trusting this doc. Restored with a pinned version for that reason: an unpinned or absent library is indistinguishable from "working" from the inside.

**Anchor links → Lenis**: a single **delegated, capture-phase** `click` listener on `document` routes any `a[href^="#"]` (including the links a Finsweet TOC injects) through `lenis.scrollTo(target, { offset })`, with `offset` measured from the live `[data-component="nav"]` height plus `ANCHOR_GAP`, and updates the URL hash via `history.pushState`. Delegation + capture is deliberate: it covers anchors injected **after** load (Finsweet runs async) without awaiting it, and pre-empts the anchor's own native jump regardless of script order — so no race with the dependency. The handler no-ops (native jump) whenever `lenis` is null (mobile / reduced-motion), so anchors still work there.

**Secondary-button beam** (`initButtonBeams`): the secondary button's rotating gold beam is **opt-in** — it only runs on a secondary button that also carries `data-gradient-animation="True"` on its `.button_main-wrap` (value case-sensitive). Secondary buttons **without** that attribute get a simpler treatment (borderless frosted glass with a subtle background lift on hover — no gold ring) — pure CSS, no JS. On the opt-in buttons the beam is a CSS animation (`buttonBeamSpin`) declared on `.button_main-element` in `button.css` (bundled into `dist/styles.css` like the rest). The ring itself is **one** gold arc that fades up, peaks and fades back out over `--btn-beam-arc` (`140deg`), leaving the remaining `220deg` of the lap dark — so it visibly appears and disappears once per turn. This function owns two things about that spin, both because CSS can't express them.

**(1) Constant speed around the contour** (`retimeBeam`). A `conic-gradient` sweeps by **angle**, and equal angles cover wildly unequal amounts of a non-square perimeter — so the lit point crawls along the middle of the long edges and whips around the corners. Measured on a 160×48 box: **8.1×** between the slowest and fastest slice of the lap (1.57px vs 12.76px of border travelled per equal time step). `retimeBeam` measures the button's border box (width, height, computed corner radius), asks `src/utils/beam-path.js` for `BEAM_STEPS` (96) angle samples taken at **equal perimeter steps**, and injects them as a generated `@keyframes buttonBeamSpin-<n>` that replaces the linear 0→360 one through an inline `animation-name`. Same measurement re-run: **1.01×**. Four details that are load-bearing:

- The mapping depends only on `w/h` and `r/h`, so it is **scale-invariant** — rules are cached per **shape bucket**, not per button, and a page of same-proportioned buttons generates exactly one.
- A button's proportions change with the breakpoint (and when a webfont lands and re-wraps the label), so a `ResizeObserver` re-times it. The swap carries the spin's `currentTime` **and** `playbackRate` over, or the beam would snap back to the top of the lap mid-lap.
- Rules are added with `insertRule` on a single `<style id="button-beam-keyframes">`. Rewriting that element's `textContent` re-parses the sheet and **restarts every running beam**.
- The CSS `@keyframes buttonBeamSpin` stays as the fallback: no JS (or a zero-size box) leaves the original linear sweep, which is uneven but never broken. The lookup matches `startsWith(BEAM_ANIM)` so it finds either.

**(1b) Constant length of the lit wedge.** The same "angles ≠ perimeter" fact shows up a second time: `--btn-beam-arc` sizes the lit wedge in **degrees**, so its *pixel* length breathes as it rounds the box — **1.7×** at the shipping `140deg` on that 200×48 box, and **worse the shorter the arc** (2.6× at `120deg`, 4.6× at `80deg`; roughly double all of those at 300px wide). So the same generated keyframes animate `--btn-beam-arc` too, widening the wedge over the long edges and narrowing it at the corners — measured **1.00×** after. Three notes: the token in `button.css` is therefore the **average** span, not a fixed one (and is read out of the computed style, so CSS stays the single place it's tuned); `--btn-beam-arc` had to be `@property`-registered as an `<angle>` for the keyframes to interpolate it; and the computation is only a **fixed index shift back through the stops table** — cheap precisely *because* the stops are already uniform in arc length. Without this the arc could not be tuned freely, which is what prompted it.

**(2) Hover speed.** Grabs the running animation via `el.getAnimations()` and sets its `playbackRate` (idle `1×` → `BEAM_HOVER_RATE`, currently `1.8×` = a 5s lap against the 9s idle, on `mouseenter`/`focusin`; back to `1×` on leave/blur). Those two numbers are **matched to the tertiary bloom's** (`--btn-tert-speed` / `TERT_HOVER_RATE`) as of 2026-08-05, so both animated variants share one idle+hover rhythm; they stay separate constants so either variant can still be tuned alone, but move them together unless the tempos are meant to diverge. The idle pace is the CSS duration alone — deliberately **not** a second "idle rate" constant, which would make any lap time the product of two numbers living in two files. Changing `playbackRate` preserves the animation's current time, so the beam accelerates **from its current position** — no jump/reset (the reason the speed change is JS, not a CSS `:hover` duration swap, which would snap the beam to the idle-clock position). Hover leaves the **ring** untouched — there is deliberately no `:hover` override on the `::after`. Everything else about the hover is CSS: a flat gold wash background (`--btn-sec-wash-hover`, overriding the plain-secondary grey hover lift) and, since 2026-08-06, an **orbiting bloom on `::before`** borrowed from the tertiary variant (invisible at rest, faded up on hover — see `button.md`). That bloom needs no JS at all, and it **cannot** be hijacked by `retimeBeam` even though it reuses the `buttonTertiaryOrbit` keyframes: the lookup above is `el.getAnimations()` **without** `subtree`, which never returns a pseudo-element's animation. The `BEAM_ANIM`-prefix rule therefore only constrains animations on the element itself. Skipped under `prefers-reduced-motion` (CSS shows a static, gapless gold ring). Couples `global.js` to the button hooks — the selector `[data-wf--element-button--variant*='secondary'][data-gradient-animation='True']` (the `*=` matches every secondary flavour, e.g. `secondary` and `secondary-icon`) and the `.button_main-element` class — kept in sync with `button.css`. Buttons present at load are wired once (dynamically-injected buttons aren't).

**Tertiary-button bloom** (`initTertiaryBloom`): the tertiary variant's warm gradient orbits
inside the button as a **CSS `rotate` on a pseudo-element** — composited, so unlike the
beam's `conic-gradient` angle it doesn't repaint the box every frame (which matters here
because the gradient covers the whole button, not a 1px ring). This function owns **only the
hover speed**: it raises the orbit's `playbackRate` to `TERT_HOVER_RATE` and back, so the
bloom accelerates from its current angle instead of snapping — the same reasoning as the
beam's hover. Everything else about the hover (the colour ramp, the veil, the glow) is CSS,
because the bloom's two colours are `@property`-registered as `<color>` and therefore
interpolate on their own.

Three details keep it from colliding with the beam. It's a **separate function**: the orbit
needs no perimeter re-timing, no `ResizeObserver` and no generated keyframes, so none of that
machinery is shared. Its keyframes are named `buttonTertiaryOrbit` and **must not** start
with `BEAM_ANIM` — `retimeBeam` finds its target with `startsWith(BEAM_ANIM)` and overwrites
`animation-name`, so a shared prefix would let it hijack the orbit. And it reads the animation
with `getAnimations({ subtree: true })`, since the orbit runs on `::before` while the beam's
spin runs on the element itself. Selector kept in sync with `button.css`:
`[data-wf--element-button--variant*='tertiary'][data-gradient-animation='True']`.

### Lifecycle

- **Init**: The default function body (runs once on load, after DOMContentLoaded)
- **Resize**: Optional hook called on `window.resize` (debounced 150ms), but only when the viewport **width** changes — height-only resizes (mobile address bar show/hide) are skipped, so a `resize` hook never fires on a pure address-bar tick
- **Breakpoint**: Optional hook called when the window crosses a Webflow breakpoint. Receives `(currentBreakpoint, previousBreakpoint)` as arguments. Values: `1920` (2XL), `1440` (XL), `1280` (Large), `992` (Desktop/base), `768` (Tablet), `480` (Mobile Landscape), `0` (Mobile Portrait).

## Page Bundles (`src/pages/`)

Standalone entry points that Rollup discovers automatically. Each `.js` file becomes a separate bundle in `dist/`. Completely independent from the component system — loaded via separate `<script>` tags on specific Webflow pages.

Page bundles can import from `src/components/` if they need shared logic, but they don't participate in the `data-component` loading system.

## Configuration (`src/config.js`)

A shared config object importable by any component or page. Holds project-level values (API endpoints, feature flags, etc.). Default-exported.

## Build Pipeline

### Dev (`npm run dev`)

```
concurrently:
  → Rollup watch (rollup.config.dev.js)
    → del (clean dist/ once on first build)
    → checkGlobalJs plugin (warns if global.js missing)
    → resolve + commonjs (handle npm packages)
    → postcss (extract CSS to dist/styles.css)
  → http-server (serves dist/ on :8080)
```

### Prod (`npm run build`)

```
prebuild: eslint src/ && prettier . --write
  → rollup (rollup.config.prod.js)
    → del (clean dist/)
    → checkGlobalJs plugin
    → resolve + commonjs
    → postcss (extract + minimize CSS)
    → terser (minify JS, strip console.*, strip comments)
```

## Deployment Flow

```
Local dev → build → commit dist/ → push → re-pin the snippet to the new SHA
          → paste into Webflow head → republish
```

The Webflow site loads assets from jsDelivr at an **immutable commit SHA**
(`…/gh/wonderup-agency/eden@<sha>/dist/…`), not `@main`. During local development the
snippet in `webflow-snippet.html` points to `localhost:8080` (or a tunnel URL) with the
pinned CDN as the production fallback.

**Why pinned and not `@main`:** jsDelivr caches `@main` aggressively, so a push and the
live site drift apart for an unpredictable window — the reason `purge-cdn.yml` exists. A
SHA is immutable: jsDelivr caches it for a year, it is never stale, and there is nothing
to purge. It also means a bad push can't reach production on its own.

**The cost is a manual step, and it fails silently.** Production does not move until the
snippet is re-pinned *and* the Webflow site is republished. Forget the republish and
everything looks fine — the site just keeps serving the previous build with no error
anywhere. `/deploy` handles the re-pin (it rewrites all the URLs in
`webflow-snippet.html`, verifies both assets return 200 at the new SHA, and commits) but
it **cannot** republish Webflow for you.

`scripts/create-page.js` reads the pinned SHA out of `webflow-snippet.html` rather than
hardcoding a ref, so a page bundle can never end up on a different build than `main.js`.

`purge-cdn.yml` still runs on every push touching `dist/`. It's now a no-op for the pinned
URLs, kept only so `@main` stays usable as an escape hatch.

**CSS deployment**: component CSS **is** bundled. `src/styles.js` imports every
`styles/*.css` file and is itself imported by `main.js`; Rollup's postcss plugin extracts
them into a single `dist/styles.css` that travels through the CDN alongside the JS. The
head snippet injects `<link rel="stylesheet" href="<base>/styles.css">` from the same
dev/prod switcher as `main.js`, so a CSS edit is served from localhost in dev mode.

Two consequences worth knowing:

- **Import order in `src/styles.js` is the cascade order.** It's the only place that
  decides which rule wins a specificity tie, so keep the grouping (site-wide → components
  → blog-post modules) and add new files to the right group. One deliberate ordering inside
  the components group: `tabs-accordion.css` comes **after** the four `tabs-*.css` files,
  because it styles markup a shared util injects *into* those sections and its generic
  `[data-tabs-accordion]` rules have to win a tie against a component's own class.
- **The `<link>` is injected during head parse, so it stays render-blocking** — the browser
  won't paint before the stylesheet lands. That's deliberate: it's what makes the anti-flash
  rules (random-item's pre-JS state, the tab stacking) work without being inline. The cost
  is that first paint waits on a jsDelivr round-trip.

Two blocks of CSS deliberately stay **out** of the bundle and live in Webflow instead:

- **The anti-FOUC gate** (Project Settings → Custom Code → Head), because it pairs with the
  inline `<script>` that adds `.js-anim` and must apply at zero latency. Mirror:
  `webflow-embeds/head-custom-code.css`.
- **The arrows** — the button icon nudge, the `data-button-icon` reverse and the card arrow
  swap — in the `Global / Styles` component's **e7 (BUTTON)** HTML Embed, because the client
  retunes them directly and the pinned-SHA deploy round-trip was the wrong shape for that.
  Mirror: `webflow-embeds/arrows.html`, docs: `components/arrows.md`. Note an embed sits in
  the **body**, so it loads after the bundle's `<link>` and **wins a specificity tie** against
  `dist/styles.css`.

> Anything moved to an embed must be **removed from `src/styles.js`** in the same change.
> Shipping both copies is the failure mode this avoids: they're identical the day it's done,
> the embed copy silently wins every tie, and the next edit to the repo file does nothing.

**Webflow Designer caveat**: head custom code doesn't run in the Designer canvas, so the
bundled CSS isn't visible while designing (it is in Preview and published). If that ever
gets in the way, add a single Embed containing
`<link rel="stylesheet" href="…/dist/styles.css">` — an Embed's content *does* render in
the canvas. Note it would serve the CDN copy even in dev mode.

