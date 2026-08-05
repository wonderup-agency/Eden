/*
  Global site-wide setup — runs on every page before any component (via main.js).
  Smooth scroll (Lenis): desktop-only (≥ 992px), driven by the GSAP ticker + synced
  to ScrollTrigger. Webflow head keeps only the Lenis <script>; the init lives here.
  Also routes anchor links (incl. Finsweet TOC) through lenis.scrollTo(), and owns the
  secondary-button gold beam's speed: the hover rate + the constant-speed re-timing of
  its spin (button.css declares the spin, this file re-times it per button box), plus the
  tertiary button's hover acceleration (playbackRate only — no re-timing needed there).
  Docs → .claude/rules/ARCHITECTURE.md (global.js section)
*/

import { beamAngleStops } from '../utils/beam-path.js'

// Below this width (tablet and down) Lenis stays off — native scroll.
const SMOOTH_MIN_WIDTH = '(min-width: 992px)'

// Extra gap above an anchor target so the fixed nav doesn't cover it (px).
const ANCHOR_GAP = 16

// Secondary-button beam: hover playbackRate multiplier over the idle spin
// (idle lap = --btn-beam-speed in button.css). Above 1 = faster on hover (1.8 → a 5s lap
// against the 9s idle). The idle pace is the CSS duration alone — deliberately not a
// second "idle rate" here, or a lap time would be the product of two numbers in two files.
// Keep this JS-owned so the speed change preserves the beam's position — no jump/reset.
// Matched to TERT_HOVER_RATE on purpose (2026-08-05): one rhythm for both animated
// variants. They stay separate constants so each variant can still be tuned alone, but
// move them together unless the two tempos are meant to diverge.
const BEAM_HOVER_RATE = 1.8

// Samples around the perimeter for the constant-speed re-timing. Higher = finer, longer rule.
const BEAM_STEPS = 96
// Prefix of both the CSS fallback keyframes and every generated one (matched with startsWith).
const BEAM_ANIM = 'buttonBeamSpin'

// Tertiary-button bloom: hover playbackRate multiplier over the idle orbit
// (idle lap = --btn-tert-speed in button.css, 9s — the same idle as the beam). Same
// reasoning as BEAM_HOVER_RATE, whose value is matched to this one — the idle
// pace stays the CSS duration alone, and changing playbackRate preserves the current angle
// so the bloom accelerates from where it is instead of snapping to the new clock.
const TERT_HOVER_RATE = 1.8
// Name of the tertiary orbit keyframes. Deliberately NOT the BEAM_ANIM prefix: retimeBeam
// matches with startsWith and would inject perimeter-sampled keyframes over it.
const TERT_ANIM = 'buttonTertiaryOrbit'

// PERF — temporary diagnostic. Logs only janky frames (slower than LONG_FRAME)
// with scrollY + the centered section, plus a rolling FPS. Set false to remove.
const PERF = false
const LONG_FRAME = 50 // ms — a slower frame (~<20fps) is logged as a stall

export default function () {
  initSmoothScroll()
  initButtonBeams()
  initTertiaryBloom()
  initPerfMonitor()
}

// The running spin on an element (the CSS fallback or a generated constant-speed one).
const findBeam = (el) =>
  el.getAnimations().find((a) => a.animationName?.startsWith(BEAM_ANIM))

// One generated @keyframes per box SHAPE, not per button — the angle mapping depends only
// on w/h and r/h, so every button of the same proportions shares a rule.
let beamSheet = null
const beamRules = new Map()

function beamRuleFor(w, h, r, arc) {
  const key = `${Math.round((w / h) * 20)}:${Math.round((r / h) * 20)}:${arc}`
  if (beamRules.has(key)) return beamRules.get(key)

  const stops = beamAngleStops(w, h, r, BEAM_STEPS, arc)
  if (!stops) return null

  const name = `${BEAM_ANIM}-${beamRules.size}`
  const frames = stops
    .map(
      (s) =>
        `${(s.offset * 100).toFixed(3)}%{--btn-angle:${s.deg.toFixed(2)}deg` +
        (s.arc ? `;--btn-beam-arc:${s.arc.toFixed(2)}deg` : '') +
        '}'
    )
    .join('')
  if (!beamSheet) {
    beamSheet = document.createElement('style')
    beamSheet.id = 'button-beam-keyframes'
    document.head.appendChild(beamSheet)
  }
  // insertRule, not textContent — rewriting the sheet would restart every running beam.
  beamSheet.sheet.insertRule(
    `@keyframes ${name}{${frames}}`,
    beamSheet.sheet.cssRules.length
  )
  beamRules.set(key, name)
  return name
}

// Swap in the rule for this button's current box, carrying the spin's time + rate over so
// a breakpoint change can't snap the beam back to the top of the lap.
function retimeBeam(el) {
  const { width, height } = el.getBoundingClientRect()
  const style = getComputedStyle(el)
  const radius = parseFloat(style.borderTopLeftRadius) || 0
  // The authored average — read from CSS so the token stays the one place it's tuned.
  const arc = parseFloat(style.getPropertyValue('--btn-beam-arc')) || 0
  const name = beamRuleFor(width, height, radius, arc)
  if (!name || el.style.animationName === name) return

  const prev = findBeam(el)
  const time = prev ? prev.currentTime : null
  const rate = prev ? prev.playbackRate : 1
  el.style.animationName = name
  const next = findBeam(el)
  if (next && time !== null) {
    next.currentTime = time
    next.playbackRate = rate
  }
}

// Secondary buttons spin a gold beam via a CSS animation on .button_main-element.
// Three JS-owned things, all because CSS can't express them. The first two are the same
// defect — a conic-gradient works in ANGLE, and equal angles cover very unequal amounts of
// a non-square border — showing up once as speed and once as length:
//   1. Constant SPEED around the contour. Unfixed, the light crawls along the middle of the
//      long edges and whips around the corners. retimeBeam replaces the linear 0->360
//      keyframes with ones sampled at equal PERIMETER steps, measured per button.
//   2. Constant LENGTH of the lit wedge (beam-path.js widens/narrows --btn-beam-arc in the
//      same keyframes). Unfixed it breathes 2.6x at 120deg on a 200x48 box, and gets worse
//      the shorter the arc — so this is what lets the arc be tuned freely.
//   3. Hover speed. Changing playbackRate keeps the current time, so the beam accelerates
//      from where it is and eases back down in place — never snapping to the idle clock.
function initButtonBeams() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  // Only the beam variant spins — plain secondary buttons have a static ring, no JS.
  const wraps = document.querySelectorAll(
    "[data-wf--element-button--variant*='secondary'][data-gradient-animation='True']"
  )
  if (!wraps.length) return

  // A button's proportions change with the breakpoint (and with a webfont landing), and
  // the mapping is proportion-dependent — so re-measure rather than trusting init.
  const observer = window.ResizeObserver
    ? new window.ResizeObserver((entries) =>
        entries.forEach((entry) => retimeBeam(entry.target))
      )
    : null

  wraps.forEach((wrap) => {
    const el = wrap.querySelector('.button_main-element')
    if (!el) return

    retimeBeam(el)
    observer?.observe(el)

    const setRate = (rate) => {
      const beam = findBeam(el)
      if (beam) beam.playbackRate = rate
    }
    wrap.addEventListener('mouseenter', () => setRate(BEAM_HOVER_RATE))
    wrap.addEventListener('mouseleave', () => setRate(1))
    wrap.addEventListener('focusin', () => setRate(BEAM_HOVER_RATE))
    wrap.addEventListener('focusout', () => setRate(1))
  })
}

// Tertiary's ONE JS-owned thing: the hover speed-up. Everything else about the variant is
// CSS — the colour ramp, the veil and the glow all interpolate on their own, because the
// bloom colours are @property-registered. Only the acceleration can't be CSS: a :hover
// duration swap would snap the bloom to the new clock's angle instead of speeding up from
// where it is. Kept out of initButtonBeams so the beam's re-timing, ResizeObserver and
// generated keyframes stay untouched — the orbit needs none of them (a transform rotation
// is already uniform, and it isn't following a rounded-rect perimeter).
function initTertiaryBloom() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const wraps = document.querySelectorAll(
    "[data-wf--element-button--variant*='tertiary'][data-gradient-animation='True']"
  )
  if (!wraps.length) return

  wraps.forEach((wrap) => {
    const el = wrap.querySelector('.button_main-element')
    if (!el) return

    // subtree: the orbit runs on ::before, not on the element itself.
    const setRate = (rate) => {
      const orbit = el
        .getAnimations({ subtree: true })
        .find((a) => a.animationName === TERT_ANIM)
      if (orbit) orbit.playbackRate = rate
    }
    wrap.addEventListener('mouseenter', () => setRate(TERT_HOVER_RATE))
    wrap.addEventListener('mouseleave', () => setRate(1))
    wrap.addEventListener('focusin', () => setRate(TERT_HOVER_RATE))
    wrap.addEventListener('focusout', () => setRate(1))
  })
}

function initPerfMonitor() {
  if (!PERF) return
  let last = window.performance.now()
  let secStart = last
  let frames = 0
  let acc = 0

  // The [data-component] section straddling the vertical viewport center.
  const centeredSection = () => {
    const cy = window.innerHeight / 2
    for (const el of document.querySelectorAll('[data-component]')) {
      const r = el.getBoundingClientRect()
      if (r.top <= cy && r.bottom >= cy)
        return el.getAttribute('data-component')
    }
    return '(none)'
  }

  const loop = (now) => {
    const dt = now - last
    last = now
    frames++
    acc += dt
    if (dt > LONG_FRAME)
      console.log(
        `%c[perf] ⚠ stall ${Math.round(dt)}ms — section "${centeredSection()}" scrollY=${Math.round(window.scrollY)}`,
        'color:#e53e3e;font-weight:bold'
      )
    if (now - secStart >= 1000) {
      console.log(`[perf] ~${Math.round((frames * 1000) / acc)} fps`)
      frames = 0
      acc = 0
      secStart = now
    }
    window.requestAnimationFrame(loop)
  }
  window.requestAnimationFrame(loop)
  console.log('%c[perf] monitor on', 'color:#22c55e;font-weight:bold')
}

function initSmoothScroll() {
  const { Lenis, gsap } = window
  const ScrollTrigger = window.ScrollTrigger

  if (!Lenis) {
    console.warn('[global] Lenis not found on window — native scroll only')
    return
  }
  // Respect reduced-motion: never hijack the scroll.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  let lenis = null

  // Drive Lenis from GSAP's ticker (shares one rAF with ScrollTrigger).
  function tick(time) {
    if (lenis) lenis.raf(time * 1000)
  }

  // Standalone rAF fallback when GSAP isn't on the page.
  function rafLoop(time) {
    if (!lenis) return
    lenis.raf(time)
    window.requestAnimationFrame(rafLoop)
  }

  function start() {
    if (lenis) return
    lenis = new Lenis()

    if (gsap) {
      gsap.ticker.add(tick)
      gsap.ticker.lagSmoothing(0)
    } else {
      window.requestAnimationFrame(rafLoop)
    }

    // Keep ScrollTrigger's scroll position in sync with Lenis.
    if (ScrollTrigger) lenis.on('scroll', ScrollTrigger.update)

    window.lenis = lenis // expose for anchor scrolling / debugging
  }

  function stop() {
    if (!lenis) return
    if (gsap) gsap.ticker.remove(tick)
    lenis.destroy()
    lenis = null
    window.lenis = null
  }

  // Anchor links (incl. Finsweet-generated TOC) → route through Lenis so the jump
  // is smooth and stays in sync. Delegated on document so anchors injected later
  // (Finsweet runs async) are covered without awaiting it; capture phase + stopPropagation
  // pre-empts any click handler the anchor carries (e.g. Finsweet's native jump).
  document.addEventListener(
    'click',
    (e) => {
      if (!lenis) return // Lenis off (mobile / reduced-motion) → native anchor jump
      const link = e.target.closest('a[href^="#"]')
      if (!link) return
      const hash = link.getAttribute('href')
      if (hash.length < 2) return // bare "#" — ignore
      const target = document.querySelector(hash)
      if (!target) return // unknown id → let the browser handle it
      e.preventDefault()
      e.stopPropagation()
      const nav = document.querySelector('[data-component="nav"]')
      const offset = -((nav?.getBoundingClientRect().height || 0) + ANCHOR_GAP)
      lenis.scrollTo(target, { offset })
      window.history.pushState(null, '', hash) // shareable URL + back button
    },
    true // capture: beat the anchor's own handler regardless of load order
  )

  // Desktop-only, reactive: start/stop Lenis as the viewport crosses 992px (no reload).
  const mq = window.matchMedia(SMOOTH_MIN_WIDTH)
  if (mq.matches) start()
  mq.addEventListener('change', (e) => (e.matches ? start() : stop()))
}
