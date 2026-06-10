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

export default function () {
  initSmoothScroll()
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
