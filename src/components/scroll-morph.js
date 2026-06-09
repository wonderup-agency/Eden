/*
Component: scroll-morph
Webflow attribute: data-component="scroll-morph"

Pinned, scroll-driven section. A source PNG is sampled into a sparse point cloud
(varied per-point sizes) on a <canvas> behind the text. As the section scrubs the
cloud assembles PROGRESSIVELY: fully dispersed across the section under the first
message, it coalesces one step per title change (each message de-blurs out / in),
forming the shape only by the LAST message — which it then holds, assembled and in
view, as the pin releases. A residual shimmer keeps it alive throughout. Hovering
the cloud pushes / swirls / loosens nearby points (nebula). Text uses the shared
word de-blur (src/utils/word-reveal.js), identical to hero / paradigm / title-animation.

GSAP + ScrollTrigger are expected as globals (loaded site-wide in Webflow).

Fallbacks: no GSAP/ScrollTrigger, prefers-reduced-motion, or an unsamplable
(CORS-tainted / missing) source image → no canvas / no pin; the messages show in
a readable stacked layout and the source image (if any) shows statically.

The CSS is NOT bundled here — it lives in Webflow's global head custom code.
The source of truth is ./styles/scroll-morph.css (copy/paste it into Webflow).
*/

import { REVEAL_FROM, REVEAL_TO, splitElement } from '../utils/word-reveal.js'

const { gsap } = window
const ScrollTrigger = window.ScrollTrigger

// De-blur OUT (symmetric to the shared REVEAL_TO — words blur back + rise out).
const REVEAL_OUT = {
  autoAlpha: 0,
  filter: 'blur(16px)',
  yPercent: -16,
  duration: 0.9,
  stagger: 0.06,
  ease: 'sine.in',
}

// ---- Point cloud (frozen from the playground tuning) ----
const TARGET_POINTS = 3500 // fewer points — a lighter, sparser cloud
const SAMPLE_MAX = 560 // longest edge the source PNG is sampled at
const ALPHA_MIN = 28 // min source alpha to count a pixel as "ink"
const LUMA_MAX = 245 // for opaque PNGs: count pixels darker than this
const DOT_COLOR = '125,130,140' // #7d828c
// Per-point radius (px): varied sizes, biased toward small so dots are fine and
// only a few are slightly bigger — never thick.
const DOT_MIN_R = 0.8
const DOT_MAX_R = 2.8
const DOT_SIZE_BIAS = 2.2 // exponent on a 0..1 random — higher = more tiny, fewer big
const FIT = 1.0 // fraction of the half-stage the shape fills (auto-fit; higher = wider)
const SCATTER = 1.0 // dispersed coverage (1 = fills the whole section)
const STAGGER = 0.45 // spread of per-point assemble timing (organic)
const DRIFT = 0.25 // ambient drift amplitude while dispersed
const DRIFT_SPEED = 0.6
const SHIMMER_FLOOR = 0.24 // residual drift kept even when assembled (never frozen)
const SCATTER_FADE = 0.45 // alpha multiplier when fully dispersed
// Scroll choreography — the cloud assembles PROGRESSIVELY across the messages:
// fully dispersed on the first, forming the shape only by the last.
const PIN_LEN = 6 // pin length in viewport heights — longer = each change is gentler
const SCRUB = 1.5 // ScrollTrigger catch-up lag (s) — higher = smoother, less abrupt
const HOLD = 0.6 // beat per message held
const ASSEMBLE = 1.4 // duration of each per-message assembly step
const ASSEMBLE_EASE_POW = 1.5 // >1 keeps early messages more dispersed; circle snaps in late
const END_HOLD = 1.4 // final dwell on the last message (ends assembled, in view)
// Hover nebula
const HOVER_RADIUS = 0.4
const HOVER_PUSH = 0.03
const HOVER_SWIRL = 0.06
const HOVER_EASE = 0.11
const HOVER_SCATTER = 0.18

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

// Deterministic RNG so the subsample is stable across reloads.
function mulberry32(seed) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Load an image with CORS enabled so its pixels can be read (getImageData).
function loadImage(src) {
  return new Promise((resolve) => {
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

// Sample an image's "ink" pixels into n points. Returns Float32 x/y/alpha in
// source-pixel space + bbox. Throws if the canvas is CORS-tainted (caught upstream).
function sampleImage(img, n, rng) {
  const scale = SAMPLE_MAX / Math.max(img.width, img.height)
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data // throws if tainted

  const cand = []
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = (py * w + px) * 4
      const alpha = data[i + 3]
      if (alpha < ALPHA_MIN) continue
      const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
      const isInk = alpha > 200 ? luma < LUMA_MAX : true
      if (!isInk) continue
      const intensity = Math.min(1, (alpha / 255) * (1 - luma / 255) * 2 + 0.25)
      cand.push(px, py, intensity)
    }
  }

  const x = new Float32Array(n)
  const y = new Float32Array(n)
  const a = new Float32Array(n)
  const m = cand.length / 3
  if (m === 0) return { x, y, a, bbox: { minX: 0, minY: 0, maxX: w, maxY: h } }

  const order = new Uint32Array(m)
  for (let i = 0; i < m; i++) order[i] = i
  for (let i = m - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0
    const t = order[i]
    order[i] = order[j]
    order[j] = t
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const JIT = 1.2
  for (let k = 0; k < n; k++) {
    const ci = order[k % m] * 3
    let sx = cand[ci]
    let sy = cand[ci + 1]
    if (k >= m) {
      sx += (rng() - 0.5) * 2 * JIT
      sy += (rng() - 0.5) * 2 * JIT
    }
    x[k] = sx
    y[k] = sy
    a[k] = cand[ci + 2]
    if (sx < minX) minX = sx
    if (sx > maxX) maxX = sx
    if (sy < minY) minY = sy
    if (sy > maxY) maxY = sy
  }
  return { x, y, a, bbox: { minX, minY, maxX, maxY } }
}

// Normalize a raw sample to centered, unit-ish coordinates + max half-extent.
function normalize(raw, n) {
  const cxp = (raw.bbox.minX + raw.bbox.maxX) / 2
  const cyp = (raw.bbox.minY + raw.bbox.maxY) / 2
  const half =
    Math.max(
      (raw.bbox.maxX - raw.bbox.minX) / 2,
      (raw.bbox.maxY - raw.bbox.minY) / 2
    ) || 1
  const norm = 1 / half
  const x = new Float32Array(n)
  const y = new Float32Array(n)
  let extX = 0
  let extY = 0
  for (let k = 0; k < n; k++) {
    x[k] = (raw.x[k] - cxp) * norm
    y[k] = (raw.y[k] - cyp) * norm
    if (Math.abs(x[k]) > extX) extX = Math.abs(x[k])
    if (Math.abs(y[k]) > extY) extY = Math.abs(y[k])
  }
  return { x, y, a: raw.a, extX: extX || 1, extY: extY || 1 }
}

// A soft round sprite the cloud is drawn with.
function makeSprite() {
  const s = document.createElement('canvas')
  s.width = s.height = 16
  const c = s.getContext('2d')
  const g = c.createRadialGradient(8, 8, 0, 8, 8, 8)
  g.addColorStop(0, `rgba(${DOT_COLOR},1)`)
  g.addColorStop(0.5, `rgba(${DOT_COLOR},0.8)`)
  g.addColorStop(1, `rgba(${DOT_COLOR},0)`)
  c.fillStyle = g
  c.beginPath()
  c.arc(8, 8, 8, 0, Math.PI * 2)
  c.fill()
  return s
}

// Static fallback: reveal the messages readable, show the source image. No canvas.
function setupStatic(root, messages) {
  gsap && gsap.set(messages, { clearProps: 'all' })
  root.classList.add('is-ready')
}

// Wire one section root. Returns { resize } or null (static / incomplete).
function setupRoot(root) {
  const track = root.querySelector('[data-scroll-morph-track]')
  const stage = root.querySelector('[data-scroll-morph-stage]') || track
  const source = root.querySelector('[data-scroll-morph-source]')
  const messages = gsap
    ? gsap.utils.toArray(root.querySelectorAll('[data-scroll-morph-message]'))
    : Array.from(root.querySelectorAll('[data-scroll-morph-message]'))

  if (!track || !messages.length) {
    console.warn(
      '[scroll-morph] missing [data-scroll-morph-track] or [data-scroll-morph-message]'
    )
    return null
  }

  // Split text up front (shared with hero/paradigm) so the reveal is identical.
  const wordsByMessage = messages.map((m) => splitElement(m))

  // No GSAP / ScrollTrigger / reduced motion → static, readable layout.
  if (!gsap || !ScrollTrigger || reduceMotion.matches) {
    setupStatic(root, messages)
    return null
  }

  // ---- Canvas + point-cloud engine ----
  const canvas = document.createElement('canvas')
  canvas.className = 'scroll-morph_canvas'
  canvas.setAttribute('aria-hidden', 'true')
  stage.appendChild(canvas)
  const ctx = canvas.getContext('2d')
  const sprite = makeSprite()

  let N = 0
  let shape = null
  let scatterX, scatterY, pointR, assembleDelay
  let driftPhase, driftX, driftY, offX, offY

  let cssW = 0
  let cssH = 0
  let scale = 0
  let coverX = 1
  let coverY = 1
  let dpr = 1
  const form = { t: 0 } // 0 = dispersed across the section, 1 = assembled
  let inView = false
  let looping = false
  let ready = false
  let hovActive = false
  let mx = 0
  let my = 0

  function buildPointBuffers() {
    scatterX = new Float32Array(N)
    scatterY = new Float32Array(N)
    pointR = new Float32Array(N)
    assembleDelay = new Float32Array(N)
    driftPhase = new Float32Array(N)
    driftX = new Float32Array(N)
    driftY = new Float32Array(N)
    offX = new Float32Array(N)
    offY = new Float32Array(N)
    const rng = mulberry32(7)
    for (let i = 0; i < N; i++) {
      // Uniform fractions in [-1,1] — scaled by the stage half-extent at draw
      // time so the dispersed cloud fills the WHOLE section, edge to edge.
      scatterX[i] = rng() * 2 - 1
      scatterY[i] = rng() * 2 - 1
      // Varied radius, biased toward small via the exponent (fine dots, few big).
      pointR[i] =
        DOT_MIN_R + (DOT_MAX_R - DOT_MIN_R) * Math.pow(rng(), DOT_SIZE_BIAS)
      assembleDelay[i] = rng() * STAGGER
      driftPhase[i] = rng() * Math.PI * 2
      const da = rng() * Math.PI * 2
      const dm = rng()
      driftX[i] = Math.cos(da) * dm
      driftY[i] = Math.sin(da) * dm
    }
  }

  function resize() {
    cssW = stage.clientWidth
    cssH = stage.clientHeight
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = cssW * dpr
    canvas.height = cssH * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (shape)
      scale =
        Math.min((cssW * 0.5) / shape.extX, (cssH * 0.5) / shape.extY) * FIT
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
    const sx = shape.x
    const sy = shape.y
    const sa = shape.a
    const R2 = HOVER_RADIUS * HOVER_RADIUS
    const covX = coverX * SCATTER
    const covY = coverY * SCATTER
    for (let i = 0; i < N; i++) {
      let pp = f * span - assembleDelay[i]
      pp = pp < 0 ? 0 : pp > 1 ? 1 : pp
      pp = pp * pp * (3 - 2 * pp) // smoothstep
      // Residual shimmer kept even when assembled so the cloud never freezes.
      const driftAmp = (SHIMMER_FLOOR + (1 - SHIMMER_FLOOR) * (1 - pp)) * DRIFT
      const fx =
        Math.cos(now * DRIFT_SPEED + driftPhase[i]) * driftX[i] * driftAmp
      const fy =
        Math.sin(now * DRIFT_SPEED + driftPhase[i]) * driftY[i] * driftAmp
      // Dispersed position fills the section (scatter fraction × stage extent);
      // converge to the shape as pp → 1.
      const dispX = scatterX[i] * covX
      const dispY = scatterY[i] * covY
      const bx = dispX + (sx[i] - dispX) * pp + fx
      const by = dispY + (sy[i] - dispY) * pp + fy
      // Hover nebula: dots near the cursor drift away, swirl and loosen, easing back.
      let txo = 0
      let tyo = 0
      let glow = 0
      if (hovActive) {
        const ddx = bx - mx
        const ddy = by - my
        const d2 = ddx * ddx + ddy * ddy
        if (d2 < R2) {
          const d = Math.sqrt(d2) || 1e-4
          let q = 1 - d / HOVER_RADIUS
          q = q * q * (3 - 2 * q)
          const nx = ddx / d
          const ny = ddy / d
          txo =
            (nx * HOVER_PUSH - ny * HOVER_SWIRL + driftX[i] * HOVER_SCATTER) * q
          tyo =
            (ny * HOVER_PUSH + nx * HOVER_SWIRL + driftY[i] * HOVER_SCATTER) * q
          glow = q
        }
      }
      offX[i] += (txo - offX[i]) * HOVER_EASE
      offY[i] += (tyo - offY[i]) * HOVER_EASE
      const rr = pointR[i] * (1 + glow * 0.7)
      const alpha = sa[i] * (SCATTER_FADE + (1 - SCATTER_FADE) * pp)
      ctx.globalAlpha = alpha
      ctx.drawImage(
        sprite,
        cx + (bx + offX[i]) * scale - rr,
        cy + (by + offY[i]) * scale - rr,
        rr * 2,
        rr * 2
      )
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

  // ---- Scroll timeline: pin + scrub. Assemble progressively, one step per message. ----
  let tl = null
  function buildScroll() {
    if (tl) {
      if (tl.scrollTrigger) tl.scrollTrigger.kill(true)
      tl.kill()
    }

    const allWords = wordsByMessage.flat()
    gsap.set(allWords, { clearProps: 'all' })
    gsap.set(messages, { autoAlpha: 1 })
    gsap.set(allWords, REVEAL_FROM)
    // First message pre-revealed so the scene is never blank.
    gsap.set(wordsByMessage[0], {
      autoAlpha: 1,
      filter: 'blur(0px)',
      yPercent: 0,
    })
    gsap.set(form, { t: 0 })

    const K = messages.length
    tl = gsap.timeline({ defaults: { ease: 'power2.inOut' } })

    // First message holds while the cloud is fully dispersed across the section.
    tl.to({}, { duration: HOLD })

    if (K === 1) {
      // Single message: just assemble the shape under it.
      tl.to(form, { t: 1, duration: ASSEMBLE })
    } else {
      // Each title change advances the assembly one step — fully dispersed on the
      // first message, forming the shape only by the last (eased so early
      // messages stay loose and the circle snaps together late).
      for (let i = 1; i < K; i++) {
        const assembleTo = Math.pow(i / (K - 1), ASSEMBLE_EASE_POW)
        tl.to(wordsByMessage[i - 1], REVEAL_OUT)
        tl.to(form, { t: assembleTo, duration: ASSEMBLE }, '<')
        tl.to(wordsByMessage[i], REVEAL_TO, '<')
        tl.to({}, { duration: HOLD })
      }
    }

    // End on the last message: the cloud stays assembled (no disperse) and the
    // final text is held in view as the pin releases.
    tl.to({}, { duration: END_HOLD })

    tl.scrollTrigger ||
      ScrollTrigger.create({
        trigger: track,
        start: 'top top',
        end: '+=' + PIN_LEN * 100 + '%',
        pin: true,
        scrub: SCRUB,
        animation: tl,
        onUpdate: ensureLoop,
      })
    ScrollTrigger.refresh()
  }

  // ---- Boot: sample the source image, normalize, then arm the scene ----
  async function boot() {
    resize()
    const src = source && (source.currentSrc || source.getAttribute('src'))
    const img = src ? await loadImage(src) : null
    let raw = null
    if (img) {
      try {
        raw = sampleImage(img, TARGET_POINTS, mulberry32(1000))
      } catch (err) {
        console.warn('[scroll-morph] could not sample source (CORS?)', err)
      }
    }
    if (!raw) {
      // No usable shape — degrade to a readable static layout.
      canvas.remove()
      io.disconnect()
      setupStatic(root, messages)
      return
    }

    N = TARGET_POINTS
    shape = normalize(raw, N)
    buildPointBuffers()
    ready = true
    resize()
    root.classList.add('is-canvas') // CSS hides the source <img> once sampled
    buildScroll()
    root.classList.add('is-ready') // lift the anti-FOUC gate
    ensureLoop()
  }

  // Visibility: only render while the section is on screen.
  const io = new window.IntersectionObserver(
    (entries) => {
      inView = entries[0].isIntersecting
      if (inView) ensureLoop()
    },
    { threshold: 0 }
  )
  io.observe(root)

  // Localized hover nebula over the cloud stage.
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
