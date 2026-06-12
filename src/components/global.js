/*
Global site-wide setup. Runs on every page (via main.js) before any component
loads. Use for analytics, global listeners and shared setup.

Smooth scroll (Lenis): enabled on DESKTOP ONLY (>= 992px). On tablet and below
the native browser scroll is left untouched. Lenis is expected on `window`
(loaded site-wide in Webflow, same as GSAP/ScrollTrigger). When GSAP/ScrollTrigger
are present, Lenis is driven by the GSAP ticker and kept in sync with
ScrollTrigger (single rAF, no scroll desync on pinned sections).

NOTE for the Webflow head: keep ONLY the Lenis library <script> tag (so
`window.Lenis` exists). REMOVE any inline `new Lenis()` / rAF init block — the
init now lives here so it can be gated by breakpoint and version-controlled.
*/

// Below this width (tablet and down) Lenis stays off — native scroll.
const SMOOTH_MIN_WIDTH = '(min-width: 992px)'

// PERF — temporary diagnostic. Logs ONLY janky frames (a frame slower than
// LONG_FRAME ms) with the scroll position and which [data-component] section was
// centered in the viewport, plus a rolling FPS once a second. Used to pinpoint
// which section drops frames on mobile. The loop does almost nothing per frame, so
// (unlike per-frame console.logs) it doesn't skew the measurement. Set false to remove.
const PERF = false
const LONG_FRAME = 50 // ms — a frame slower than this (~<20fps) is logged as a stall

export default function () {
  initSmoothScroll()
  initPerfMonitor()
}

function initPerfMonitor() {
  if (!PERF) return
  let last = window.performance.now()
  let secStart = last
  let frames = 0
  let acc = 0

  // The [data-component] section whose box straddles the vertical viewport center.
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

  // Drives Lenis from GSAP's ticker (seconds → ms) so it shares one rAF with
  // ScrollTrigger. Only used when GSAP is present.
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

  // Desktop-only, reactive: starts/stops Lenis as the viewport crosses 992px
  // without needing a reload.
  const mq = window.matchMedia(SMOOTH_MIN_WIDTH)
  if (mq.matches) start()
  mq.addEventListener('change', (e) => (e.matches ? start() : stop()))
}
