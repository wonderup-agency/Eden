/*
Component: nav
Webflow attribute: data-component="nav"

On scroll the nav bar morphs into a centered frosted-glass pill (1rem off the
top) and reverts at the top of the page. GSAP Flip owns the position; the glass
fades via CSS opacity and the logo shrinks via transform — the bar's size and
padding stay constant so Flip only ever translates (no flush-left, no jump).

GSAP + the Flip plugin are expected as globals (loaded site-wide in Webflow).
Runs on all breakpoints: desktop hugs content edge-left and slides to centre;
mobile keeps the bar full width and contracts it to a centred glass pill.

The CSS is NOT bundled here — it lives in Webflow's global head custom code.
The source of truth is ./styles/nav.css (copy/paste it into Webflow). Keep
--nav-morph (CSS) in sync with FLIP_DURATION below.
*/

const { gsap, Flip } = window

// Keep FLIP_DURATION in sync with --nav-morph in nav.css.
// Hysteresis (deadzone): float once scrolled past *_ON, revert only below *_OFF.
// Mobile/tablet uses a much higher ON: there Lenis is off and the browser's
// address bar shows/hides over the first scroll, swinging the viewport height by
// ~40-56px. Triggering the 1s morph mid-collapse made the nav read as "jumpy", so
// we wait until well past that zone (the chrome has settled, scrollY is stable).
// Desktop (Lenis, no browser chrome) can trigger early.
const FLOAT_ON_DESKTOP = 24 // px scrolled before the bar floats (desktop)
const FLOAT_OFF_DESKTOP = 4 // px — revert near the very top (desktop)
const FLOAT_ON_MOBILE = 80 // px — clear the address-bar-collapse zone first
const FLOAT_OFF_MOBILE = 8 // px — a touch higher to absorb top overscroll
const FLIP_DURATION = 1
const FLIP_EASE = 'power2.inOut'

// DEBUG — on-screen HUD + console logs to chase the mobile scroll "jump".
// Shows live scrollY, viewport height (address-bar show/hide), the bar's real
// top, and flags any frame where the bar moves while it shouldn't (red ⚠).
// Off now that the jump is diagnosed — the per-frame HUD loop is itself overhead.
// (Prod strips console.* anyway, but the HUD is real DOM, so this flag gates it.)
const DEBUG = false

// Load entrance — the nav drops in from above the viewport.
const ENTRANCE = {
  yPercent: -100,
  duration: 0.9,
  ease: 'power3.out',
  delay: 0.1,
}

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

// Wire one nav root. Returns { enable, disable } so gsap.matchMedia can switch
// the behavior on/off across the desktop breakpoint (with proper cleanup).
function setupNav(root) {
  const inner = root.querySelector('[data-nav-inner]')
  if (!inner) {
    console.warn('[nav] missing [data-nav-inner] — skipping')
    return null
  }

  const logo = inner.querySelector('[data-nav-logo]')

  // DEBUG — dump the computed CSS actually applied (from Webflow's head) for the
  // root, the bar, its ::before glass, and the logo, plus the bar's real top.
  // Stripped from prod by Terser (drop_console). Remove once positioning is dialed.
  const logCss = (label) => {
    const r = window.getComputedStyle(root)
    const i = window.getComputedStyle(inner)
    const b = window.getComputedStyle(inner, '::before')
    const l = logo ? window.getComputedStyle(logo) : null
    const rect = inner.getBoundingClientRect()
    console.log(`%c[nav] ${label}`, 'color:#a78bfa;font-weight:bold')
    console.table({
      'root.position': r.position,
      'root.width': r.width,
      'root.paddingTop': r.paddingTop,
      'root.paddingBottom': r.paddingBottom,
      'token --nav-rest-top':
        r.getPropertyValue('--nav-rest-top').trim() || '(unset)',
      'token --nav-float-top':
        r.getPropertyValue('--nav-float-top').trim() || '(unset)',
      'inner.position': i.position,
      'inner.display': i.display,
      'inner.width': i.width,
      'inner.margin': i.margin,
      'inner.padding': i.padding,
      'inner.top (px from viewport)': Math.round(rect.top),
      'inner.left (px)': Math.round(rect.left),
      'glass.opacity': b.opacity,
      'glass.borderRadius': b.borderRadius,
      'logo.transform': l ? l.transform : '—',
    })
  }

  let isFloating = null // null until first sync
  let flip = null // current Flip tween, so a fast reverse can interrupt it
  let floatOn = FLOAT_ON_DESKTOP // set per breakpoint in enable()
  let floatOff = FLOAT_OFF_DESKTOP
  let useFlip = true // desktop morphs with Flip; mobile uses a CSS-only transform

  // DEBUG — fixed on-screen readout + per-frame jump detector. The nav root is
  // fixed, so the bar's top should stay constant as you scroll; if it moves more
  // than the scroll delta, something else is shoving it (address bar / Flip).
  let hud = null
  let rafId = null
  let prev = null // { y, h, top }
  const buildHud = () => {
    if (!DEBUG || hud) return
    hud = document.createElement('div')
    hud.style.cssText =
      'position:fixed;left:8px;bottom:8px;z-index:2147483647;max-width:calc(100vw - 16px);' +
      'background:rgba(0,0,0,0.82);color:#9ae6b4;font:600 11px/1.4 monospace;' +
      'padding:8px 10px;border-radius:6px;white-space:pre;pointer-events:none;' +
      'box-shadow:0 2px 10px rgba(0,0,0,0.4)'
    document.body.appendChild(hud)
  }
  const sampleHud = () => {
    if (!DEBUG) return
    const y = Math.round(window.scrollY)
    const h = window.innerHeight
    const r = window.getComputedStyle(root).position
    const top = Math.round(inner.getBoundingClientRect().top)
    const dY = prev ? y - prev.y : 0
    const dH = prev ? h - prev.h : 0
    const dTop = prev ? top - prev.top : 0
    // The bar is fixed → top should barely move. Flag frames where it jumps more
    // than the scroll moved (i.e. not explained by normal scrolling).
    const jump = Math.abs(dTop) > 1 && Math.abs(dTop) > Math.abs(dY) + 1
    if (hud) {
      hud.style.color = jump || dH !== 0 ? '#feb2b2' : '#9ae6b4'
      hud.textContent =
        `nav  pos:${r}\n` +
        `scrollY ${y}  Δ${dY}\n` +
        `vh ${h}  Δ${dH}${dH !== 0 ? '  ⚠ address-bar' : ''}\n` +
        `bar.top ${top}  Δ${dTop}${jump ? '  ⚠ JUMP' : ''}\n` +
        `floating ${isFloating}  flip ${flip && flip.isActive() ? 'active' : '—'}`
    }
    if (jump)
      console.log(
        `%c[nav] ⚠ bar jumped ${dTop}px (scroll moved ${dY}px) vh=${h} floating=${isFloating}`,
        'color:#e53e3e;font-weight:bold'
      )
    // Address-bar vh swings are expected on mobile (shown live in the HUD); only
    // log a big one-shot change so the console isn't flooded.
    if (Math.abs(dH) >= 12)
      console.log(
        `%c[nav] viewport height jumped ${dH}px → ${h}`,
        'color:#dd6b20'
      )
    prev = { y, h, top }
  }
  const startDebug = () => {
    if (!DEBUG || rafId) return
    buildHud()
    const loop = () => {
      sampleHud()
      rafId = window.requestAnimationFrame(loop)
    }
    rafId = window.requestAnimationFrame(loop)
  }
  const stopDebug = () => {
    if (rafId) window.cancelAnimationFrame(rafId)
    rafId = null
  }

  const setFloating = (floating, animate) => {
    if (floating === isFloating) return
    if (DEBUG)
      console.log(
        `%c[nav] setFloating ${isFloating} → ${floating} (animate=${animate}, scrollY=${Math.round(window.scrollY)})`,
        'color:#a78bfa;font-weight:bold'
      )
    isFloating = floating

    // Class-only path: initial sync, reduced motion, AND mobile/tablet. On mobile
    // the morph is pure CSS (a transform float — see nav.css): no Flip means no
    // getState/absolute re-measure, which the address-bar viewport resize would
    // otherwise corrupt mid-tween (the abrupt jump near the top). Just toggle the
    // class and let the CSS transition animate it.
    if (!animate || reduceMotion.matches || !useFlip) {
      inner.classList.toggle('is-floating', floating)
      return
    }

    const state = Flip.getState(inner)
    inner.classList.toggle('is-floating', floating)
    flip && flip.kill()
    flip = Flip.from(state, {
      duration: FLIP_DURATION,
      ease: FLIP_EASE,
      absolute: true,
      onComplete: () =>
        logCss(floating ? 'settled → FLOATING' : 'settled → REST'),
    })
  }

  // rAF-throttled scroll read — hysteresis keeps it from toggling near the top
  // (mobile overscroll thrash). Only flips state when leaving the deadzone.
  let ticking = false
  const onScroll = () => {
    if (ticking) return
    ticking = true
    window.requestAnimationFrame(() => {
      const y = window.scrollY
      let next = isFloating
      if (!isFloating && y > floatOn) next = true
      else if (isFloating && y < floatOff) next = false
      setFloating(next, true)
      ticking = false
    })
  }

  return {
    enable(opts = {}) {
      floatOn = opts.floatOn ?? FLOAT_ON_DESKTOP
      floatOff = opts.floatOff ?? FLOAT_OFF_DESKTOP
      useFlip = opts.useFlip ?? true
      // Measure nav_component's real padding-top and feed it to the CSS so the
      // floating bar lands at exactly --nav-float-top, regardless of how the nav
      // is padded in Webflow (no manual token ↔ padding coupling to keep in sync).
      root.style.setProperty(
        '--nav-rest-top',
        window.getComputedStyle(root).paddingTop
      )
      window.addEventListener('scroll', onScroll, { passive: true })
      setFloating(window.scrollY > floatOff, false) // sync without animating (handles reload mid-page)
      logCss(isFloating ? 'init → FLOATING' : 'init → REST')
      startDebug() // DEBUG — remove with the DEBUG flag once the jump is diagnosed
    },
    disable() {
      window.removeEventListener('scroll', onScroll)
      flip && flip.kill()
      inner.classList.remove('is-floating')
      isFloating = null
      stopDebug() // DEBUG
    },
  }
}

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='nav']
 */
export default function (elements) {
  if (!gsap || !Flip) {
    console.warn('[nav] GSAP / Flip not found on window — skipping')
    return
  }
  gsap.registerPlugin(Flip)

  const navs = elements.map(setupNav).filter(Boolean)
  if (!navs.length) return

  // Load entrance (all breakpoints): drop the nav in from above. Lift the
  // anti-FOUC gate first; reduced motion just shows it in place. clearProps drops
  // the transform on finish so it can't break the floating glass backdrop-filter.
  gsap.set(elements, { autoAlpha: 1 })
  if (!reduceMotion.matches) {
    gsap.from(elements, { ...ENTRANCE, clearProps: 'transform' })
  }

  // All breakpoints — the morph targets the inline nav bar (logo + links on
  // desktop, logo + hamburger on mobile). Two matchMedia branches run the SAME
  // enable/disable, split at 992px only so crossing the boundary re-runs enable()
  // and re-measures --nav-rest-top per breakpoint (rest padding can differ).
  // Geometry differs purely in CSS: desktop edge-left → centre; mobile full width
  // → centred pill.
  const activate = (opts) => {
    navs.forEach((n) => n.enable(opts))
    return () => navs.forEach((n) => n.disable())
  }
  const mm = gsap.matchMedia()
  mm.add('(min-width: 992px)', () =>
    activate({
      floatOn: FLOAT_ON_DESKTOP,
      floatOff: FLOAT_OFF_DESKTOP,
      useFlip: true, // desktop: Flip handles the edge-left → centre slide
    })
  )
  mm.add('(max-width: 991px)', () =>
    activate({
      floatOn: FLOAT_ON_MOBILE,
      floatOff: FLOAT_OFF_MOBILE,
      useFlip: false, // mobile: CSS-only transform morph (robust to address-bar resize)
    })
  )
}
