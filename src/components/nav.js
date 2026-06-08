/*
Component: nav
Webflow attribute: data-component="nav"

On scroll the nav bar morphs into a centered frosted-glass pill (1rem off the
top) and reverts at the top of the page. GSAP Flip owns the position; the glass
fades via CSS opacity and the logo shrinks via transform — the bar's size and
padding stay constant so Flip only ever translates (no flush-left, no jump).

GSAP + the Flip plugin are expected as globals (loaded site-wide in Webflow).
Desktop-only (>= 992px); below that, Webflow's native nav is left untouched.

The CSS is NOT bundled here — it lives in Webflow's global head custom code.
The source of truth is ./styles/nav.css (copy/paste it into Webflow). Keep
--nav-morph (CSS) in sync with FLIP_DURATION below.
*/

const { gsap, Flip } = window

// Keep FLIP_DURATION in sync with --nav-morph in nav.css.
const SCROLL_THRESHOLD = 0 // floats as soon as the page scrolls at all
const FLIP_DURATION = 1
const FLIP_EASE = 'power2.inOut'

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

  const setFloating = (floating, animate) => {
    if (floating === isFloating) return
    isFloating = floating

    // No-anim path: initial sync + reduced motion (toggle the state, don't move).
    if (!animate || reduceMotion.matches) {
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

  // rAF-throttled scroll read — only acts when crossing the threshold.
  let ticking = false
  const onScroll = () => {
    if (ticking) return
    ticking = true
    window.requestAnimationFrame(() => {
      setFloating(window.scrollY > SCROLL_THRESHOLD, true)
      ticking = false
    })
  }

  return {
    enable() {
      // Measure nav_component's real padding-top and feed it to the CSS so the
      // floating bar lands at exactly --nav-float-top, regardless of how the nav
      // is padded in Webflow (no manual token ↔ padding coupling to keep in sync).
      root.style.setProperty(
        '--nav-rest-top',
        window.getComputedStyle(root).paddingTop
      )
      window.addEventListener('scroll', onScroll, { passive: true })
      setFloating(window.scrollY > SCROLL_THRESHOLD, false) // sync without animating (handles reload mid-page)
      logCss(isFloating ? 'init → FLOATING' : 'init → REST')
    },
    disable() {
      window.removeEventListener('scroll', onScroll)
      flip && flip.kill()
      inner.classList.remove('is-floating')
      isFloating = null
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

  // Desktop only — the morph targets the full inline nav. On tablet/mobile the
  // native Webflow nav (hamburger + overlay) is left as-is. matchMedia handles
  // enabling above 992px and cleaning up when crossing back down.
  const mm = gsap.matchMedia()
  mm.add('(min-width: 992px)', () => {
    navs.forEach((n) => n.enable())
    return () => navs.forEach((n) => n.disable())
  })
}
