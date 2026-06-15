/*
  Component: nav · data-component="nav"
  On scroll the bar morphs into a centred frosted-glass pill (GSAP Flip on desktop,
  CSS-only glass on mobile) and reverts at the top. Runs on all breakpoints.
  CSS → ./styles/nav.css (paste into Webflow head; keep --nav-morph in sync with
  FLIP_DURATION) · Docs → .claude/rules/components/nav.md
*/

const { gsap, Flip } = window

// Hysteresis deadzone: float past *_ON, revert below *_OFF. Mobile ON is much higher
// because the address bar swings the viewport over the first scroll (morphing mid-swing read as jumpy).
const FLOAT_ON_DESKTOP = 24 // px scrolled before the bar floats (desktop)
const FLOAT_OFF_DESKTOP = 4 // px — revert near the very top (desktop)
const FLOAT_ON_MOBILE = 80 // px — clear the address-bar-collapse zone first
const FLOAT_OFF_MOBILE = 8 // px — a touch higher to absorb top overscroll
const FLIP_DURATION = 1
const FLIP_EASE = 'power2.inOut'

// DEBUG — on-screen HUD + logs to chase the mobile scroll "jump". Off (the HUD loop
// is itself overhead, and the HUD is real DOM so Terser can't strip it).
const DEBUG = false

// Load entrance — the nav drops in from above the viewport.
const ENTRANCE = {
  yPercent: -100,
  duration: 0.9,
  ease: 'power3.out',
  delay: 0.1,
}

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

// Wire one nav root. Returns { enable, disable } for gsap.matchMedia to switch per breakpoint.
function setupNav(root) {
  const inner = root.querySelector('[data-nav-inner]')
  if (!inner) {
    console.warn('[nav] missing [data-nav-inner] — skipping')
    return null
  }

  const logo = inner.querySelector('[data-nav-logo]')

  // DEBUG — dump the computed CSS applied to root/bar/glass/logo + the bar's real top.
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
  let useFlip = true // desktop morphs with Flip; mobile uses CSS-only glass

  // DEBUG — fixed on-screen readout + per-frame jump detector (flags the bar moving
  // more than the scroll delta — i.e. shoved by the address bar / Flip).
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
    // Bar is fixed → flag frames where its top moves more than the scroll did.
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
    // Only log a big one-shot vh change (address-bar swings are expected on mobile).
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

    // Class-only path: initial sync, reduced motion, AND mobile/tablet. Mobile morph
    // is pure CSS (no Flip getState/re-measure for the address-bar resize to corrupt).
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

  // rAF-throttled scroll read — hysteresis flips state only when leaving the deadzone.
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
      // Feed nav_component's real padding-top to the CSS so the floating bar lands
      // at --nav-float-top whatever the Webflow padding (no token ↔ padding coupling).
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

  // Load entrance: drop the nav in from above (gate lifted first). clearProps drops
  // the leftover transform so it can't break the floating glass backdrop-filter.
  gsap.set(elements, { autoAlpha: 1 })
  if (!reduceMotion.matches) {
    gsap.from(elements, { ...ENTRANCE, clearProps: 'transform' })
  }

  // Two matchMedia branches run the same enable/disable, split at 992px so crossing
  // re-runs enable() + re-measures --nav-rest-top. Geometry differs purely in CSS.
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
