/*
  Global site-wide setup — runs on every page before any component (via main.js).
  Smooth scroll (Lenis): desktop-only (≥ 992px), driven by the GSAP ticker + synced
  to ScrollTrigger. Webflow head keeps only the Lenis <script>; the init lives here.
  Docs → .claude/rules/ARCHITECTURE.md (global.js section)
*/

// Below this width (tablet and down) Lenis stays off — native scroll.
const SMOOTH_MIN_WIDTH = '(min-width: 992px)'

// PERF — temporary diagnostic. Logs only janky frames (slower than LONG_FRAME)
// with scrollY + the centered section, plus a rolling FPS. Set false to remove.
const PERF = false
const LONG_FRAME = 50 // ms — a slower frame (~<20fps) is logged as a stall

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

  // Desktop-only, reactive: start/stop Lenis as the viewport crosses 992px (no reload).
  const mq = window.matchMedia(SMOOTH_MIN_WIDTH)
  if (mq.matches) start()
  mq.addEventListener('change', (e) => (e.matches ? start() : stop()))
}
