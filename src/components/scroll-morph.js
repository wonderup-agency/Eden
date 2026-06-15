/*
  Component: scroll-morph · data-component="scroll-morph"
  Procedural dot-ring that assembles on scroll behind a single held line of text.
  Canvas 2D, no image sampled. Fallback (no GSAP / reduced motion): static stacked text.
  CSS → ./styles/scroll-morph.css (paste into Webflow head) · Docs → .claude/rules/components/scroll-morph.md
*/

const { gsap } = window
const ScrollTrigger = window.ScrollTrigger

// ---- Point cloud (procedural ring) ----
const TARGET_POINTS = 2500 // dot count
const DOT_COLOR = '180,185,190' // light slate grey (tuned for a light bg)
const BIG_DOT_CHANCE = 0.15 // fraction of dots that are slightly bigger
const SMALL_R = [0.5, 1.7] // small-dot radius range (CSS px)
const BIG_R = [1.5, 3.0] // big-dot radius range (CSS px)
const RING_THICKNESS = 0.1 // gaussian band width (fraction of radius)
const FIT = 1 // half-stage fraction the ring fills (auto-fit)
const ALPHA_MIN = 0.15 // dispersed/idle alpha range
const ALPHA_MAX = 0.4
const ALPHA_PEAK = 0.55 // alpha when assembled
const SCATTER = 1.0 // dispersed coverage (1 = fills the section)
const SCATTER_DRIFT = 0.0015 // slow edge-bouncing drift speed
const STAGGER = 0.45 // per-point assemble timing spread
// Breathing of the assembled ring (never freezes) — raise AMPs for more motion.
const RING_WAVE_AMP = 0.05 // radial wobble amplitude
const RING_WAVE_SPEED = 1.5 // radial wave speed (rad/s)
const RING_WOBBLE_AMP = 0.05 // tangential angle wobble (rad)
const RING_WOBBLE_SPEED = 0.95 // tangential wobble speed (rad/s)
// Reveal choreography (timed — fires once on scroll into view, NOT tied to scroll).
const REVEAL_START = 'top 70%' // ScrollTrigger start — when the section enters view
const HOLD = 0.3 // beat held dispersed before forming (s)
const ASSEMBLE = 2.5 // dispersed → ring duration (s)
// Hover push (px feel — converted to normalized units via `scale`).
const HOVER_RADIUS_PX = 110 // cursor influence radius
const HOVER_PUSH_PX = 26 // push distance
const HOVER_EASE_IN = 0.15 // ease toward pushed position
const HOVER_EASE_OUT = 0.06 // ease back to rest

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

// Deterministic RNG so the ring is stable across reloads.
function mulberry32(seed) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Standard-normal sample (Box–Muller) for the soft ring-band thickness.
function gaussian(rng) {
  const u = Math.max(rng(), 1e-6)
  const v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

// Static fallback: reveal the single text readable. No canvas.
function setupStatic(root, message) {
  gsap && gsap.set(message, { clearProps: 'all' })
  root.classList.add('is-ready')
}

// Wire one section root. Returns { resize } or null (static / incomplete).
function setupRoot(root) {
  const track = root.querySelector('[data-scroll-morph-track]')
  const stage = root.querySelector('[data-scroll-morph-stage]') || track
  const messages = Array.from(
    root.querySelectorAll('[data-scroll-morph-message]')
  )

  if (!track || !messages.length) {
    console.warn(
      '[scroll-morph] missing [data-scroll-morph-track] or [data-scroll-morph-message]'
    )
    return null
  }

  // Single-text section: only the first message is used. Any extra message
  // elements left in the markup are hidden so they can't stack on top.
  const message = messages[0]
  messages.slice(1).forEach((m) => (m.style.display = 'none'))

  // No GSAP / ScrollTrigger / reduced motion → static, readable layout.
  if (!gsap || !ScrollTrigger || reduceMotion.matches) {
    setupStatic(root, message)
    return null
  }

  // ---- Canvas + procedural-ring engine ----
  const canvas = document.createElement('canvas')
  canvas.className = 'scroll-morph_canvas'
  canvas.setAttribute('aria-hidden', 'true')
  stage.appendChild(canvas)
  const ctx = canvas.getContext('2d')

  const N = TARGET_POINTS
  // Per-point buffers.
  const angle = new Float32Array(N) // base angle on the ring
  const baseR = new Float32Array(N) // ring radius incl. gaussian thickness
  const speedMod = new Float32Array(N) // per-point breathing speed multiplier
  const pointR = new Float32Array(N) // dot radius (CSS px)
  const baseAlpha = new Float32Array(N) // dispersed/idle alpha
  const scatterX = new Float32Array(N) // dispersed position, unit space [-1,1]
  const scatterY = new Float32Array(N)
  const velX = new Float32Array(N) // dispersed drift velocity (unit/frame)
  const velY = new Float32Array(N)
  const offX = new Float32Array(N) // eased hover push offset (normalized)
  const offY = new Float32Array(N)
  const assembleDelay = new Float32Array(N)
  let ringExt = 1 // max |coord| of the static ring (for auto-fit)

  let cssW = 0
  let cssH = 0
  let scale = 0
  let coverX = 1
  let coverY = 1
  let dpr = 1
  const form = { t: 0 } // 0 = dispersed across the section, 1 = assembled ring
  let inView = false
  let looping = false
  let ready = false
  let hovActive = false
  let mx = 0
  let my = 0

  function buildPointBuffers() {
    const rng = mulberry32(7)
    ringExt = 0
    for (let i = 0; i < N; i++) {
      const a = rng() * Math.PI * 2
      const r = 1 + gaussian(rng) * RING_THICKNESS
      angle[i] = a
      baseR[i] = r
      speedMod[i] = 0.5 + rng() * 0.5
      // Varied dot size: ~15% slightly bigger, the rest fine.
      pointR[i] =
        rng() < BIG_DOT_CHANCE
          ? BIG_R[0] + rng() * (BIG_R[1] - BIG_R[0])
          : SMALL_R[0] + rng() * (SMALL_R[1] - SMALL_R[0])
      baseAlpha[i] = ALPHA_MIN + rng() * (ALPHA_MAX - ALPHA_MIN)
      // Dispersed start: random across the section, slow drifting velocity.
      scatterX[i] = rng() * 2 - 1
      scatterY[i] = rng() * 2 - 1
      const da = rng() * Math.PI * 2
      velX[i] = Math.cos(da) * SCATTER_DRIFT
      velY[i] = Math.sin(da) * SCATTER_DRIFT
      assembleDelay[i] = rng() * STAGGER
      const ax = Math.abs(Math.cos(a) * r)
      const ay = Math.abs(Math.sin(a) * r)
      if (ax > ringExt) ringExt = ax
      if (ay > ringExt) ringExt = ay
    }
    // Leave headroom for the radial breathing so it never clips at the edge.
    ringExt += RING_WAVE_AMP
  }

  function resize() {
    cssW = stage.clientWidth
    cssH = stage.clientHeight
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = cssW * dpr
    canvas.height = cssH * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // Auto-fit the ring to the smaller half-extent so it never clips.
    scale = (Math.min(cssW * 0.5, cssH * 0.5) / ringExt) * FIT
    coverX = scale ? (cssW * 0.5) / scale : 1
    coverY = scale ? (cssH * 0.5) / scale : 1
    if (ready) draw()
  }

  function draw() {
    ctx.clearRect(0, 0, cssW, cssH)
    if (!ready) return
    const cx = cssW / 2
    const cy = cssH / 2
    const f = form.t
    const span = 1 + STAGGER
    const now = window.performance.now() * 0.001
    const covX = coverX * SCATTER
    const covY = coverY * SCATTER
    // Hover influence expressed in normalized units (keeps the px feel at any scale).
    const hr = scale ? HOVER_RADIUS_PX / scale : 0
    const hr2 = hr * hr
    const hpush = scale ? HOVER_PUSH_PX / scale : 0
    ctx.fillStyle = `rgb(${DOT_COLOR})`
    for (let i = 0; i < N; i++) {
      // Slow drifting scatter that bounces off the section edges.
      let sxu = scatterX[i] + velX[i]
      let syu = scatterY[i] + velY[i]
      if (sxu < -1 || sxu > 1) {
        velX[i] = -velX[i]
        sxu = sxu < -1 ? -1 : 1
      }
      if (syu < -1 || syu > 1) {
        velY[i] = -velY[i]
        syu = syu < -1 ? -1 : 1
      }
      scatterX[i] = sxu
      scatterY[i] = syu

      // Per-point assembly progress (staggered, smoothstepped).
      let pp = f * span - assembleDelay[i]
      pp = pp < 0 ? 0 : pp > 1 ? 1 : pp
      pp = pp * pp * (3 - 2 * pp)

      // Ring position breathes radially + wobbles tangentially (never freezes).
      const wave =
        Math.sin(now * RING_WAVE_SPEED * speedMod[i] + angle[i] * 5) *
        RING_WAVE_AMP
      const aa =
        angle[i] +
        Math.cos(now * RING_WOBBLE_SPEED * speedMod[i]) * RING_WOBBLE_AMP
      const rr = baseR[i] + wave
      const ringX = Math.cos(aa) * rr
      const ringY = Math.sin(aa) * rr

      // Dispersed position fills the section; converge to the ring as pp → 1.
      const dispX = sxu * covX
      const dispY = syu * covY
      const bx = dispX + (ringX - dispX) * pp
      const by = dispY + (ringY - dispY) * pp

      // Hover push: dots within the cursor radius are pushed away, eased back.
      let txo = 0
      let tyo = 0
      if (hovActive) {
        const ddx = bx - mx
        const ddy = by - my
        const d2 = ddx * ddx + ddy * ddy
        if (d2 < hr2) {
          const d = Math.sqrt(d2) || 1e-4
          const force = (hr - d) / hr
          txo = (ddx / d) * force * hpush
          tyo = (ddy / d) * force * hpush
        }
      }
      const ease = txo || tyo ? HOVER_EASE_IN : HOVER_EASE_OUT
      offX[i] += (txo - offX[i]) * ease
      offY[i] += (tyo - offY[i]) * ease

      const alpha = baseAlpha[i] + (ALPHA_PEAK - baseAlpha[i]) * pp
      ctx.globalAlpha = alpha
      ctx.beginPath()
      ctx.arc(
        cx + (bx + offX[i]) * scale,
        cy + (by + offY[i]) * scale,
        pointR[i],
        0,
        Math.PI * 2
      )
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  function loop() {
    draw()
    if (inView) window.requestAnimationFrame(loop)
    else looping = false
  }
  function ensureLoop() {
    if (!looping && inView) {
      looping = true
      window.requestAnimationFrame(loop)
    }
  }

  // ---- Reveal: assemble the ring ONCE when the section scrolls into view. ----
  // Timed, NOT scrubbed — the animation isn't tied to scroll position. The text
  // stays revealed and held; only the ring animates.
  let tl = null
  function buildReveal() {
    gsap.set(message, { autoAlpha: 1 })
    gsap.set(form, { t: 0 }) // dispersed start

    tl = gsap.timeline({ paused: true, defaults: { ease: 'power2.inOut' } })
    tl.to({}, { duration: HOLD }) // brief dispersed beat
    tl.to(form, { t: 1, duration: ASSEMBLE }) // assemble the ring, then hold (breathing)

    ScrollTrigger.create({
      trigger: root,
      start: REVEAL_START,
      once: true,
      onEnter: () => {
        tl.play()
        ensureLoop()
      },
    })
  }

  // ---- Boot: build the ring, then arm the scene ----
  function boot() {
    buildPointBuffers()
    ready = true
    // Add .is-canvas (sizes the stage to the viewport) BEFORE measuring — measure
    // first and the canvas sizes against the collapsed track → ring renders as an ellipse.
    root.classList.add('is-canvas')
    resize()
    buildReveal()
    root.classList.add('is-ready') // lift the anti-FOUC gate
    ensureLoop()
  }

  // Visibility: render only on screen. On exit, clear the canvas + flag .is-offscreen
  // (CSS hides the messages) so nothing bleeds into other sections; redraw on re-entry.
  const io = new window.IntersectionObserver(
    (entries) => {
      inView = entries[0].isIntersecting
      root.classList.toggle('is-offscreen', !inView)
      if (inView) {
        ensureLoop()
      } else if (ready) {
        ctx.clearRect(0, 0, cssW, cssH)
      }
    },
    { threshold: 0 }
  )
  io.observe(root)

  // Localized hover push over the cloud stage.
  stage.addEventListener('pointermove', (e) => {
    const rect = stage.getBoundingClientRect()
    mx = (e.clientX - rect.left - cssW / 2) / scale
    my = (e.clientY - rect.top - cssH / 2) / scale
  })
  stage.addEventListener('pointerenter', () => {
    hovActive = true
  })
  stage.addEventListener('pointerleave', () => {
    hovActive = false
  })

  boot()

  return {
    resize() {
      if (!ready) return
      resize()
      ScrollTrigger.refresh()
    },
  }
}

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='scroll-morph']
 */
export default function (elements) {
  if (!gsap || !ScrollTrigger) {
    console.warn(
      '[scroll-morph] GSAP / ScrollTrigger not found on window — static fallback'
    )
  } else {
    gsap.registerPlugin(ScrollTrigger)
  }

  const instances = elements.map(setupRoot).filter(Boolean)
  if (!instances.length) return

  return {
    resize() {
      instances.forEach((inst) => inst.resize())
    },
  }
}
