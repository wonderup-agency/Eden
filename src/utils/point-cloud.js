/*
  Shared 2D point-cloud pieces: the image sampler both cloud users need, plus `createStillCloud`
  — ONE image's ink on its own canvas, floating in on scroll-in and then shimmering + breathing
  forever. No morph, no hover: that's tabs-stats' tab engine, which imports the sampler from
  here so there is a single copy of the thresholds.
  Docs → .claude/rules/components/tabs-stats.md (Stacked mobile layout)
*/

const { gsap } = window

// Sampling thresholds — shared, so the two callers can't drift apart.
const SAMPLE_MAX = 560 // longest edge the source image is sampled at
const ALPHA_MIN = 28 // min source alpha to count a pixel as "ink"
const LUMA_MAX = 245 // opaque images: count pixels darker than this

// Deterministic RNG so a subsample is stable across reloads.
export function mulberry32(seed) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Load an image with CORS enabled so its pixels can be read (getImageData).
export function loadImage(src) {
  return new Promise((resolve) => {
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

// Sample an image's "ink" pixels into n points (x/y/alpha + bbox). Throws if CORS-tainted.
export function sampleImage(img, n, rng) {
  const scale = SAMPLE_MAX / Math.max(img.width, img.height)
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data // throws if tainted

  const cand = [] // [x, y, intensity, ...]
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = (py * w + px) * 4
      const alpha = data[i + 3]
      if (alpha < ALPHA_MIN) continue
      const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
      // transparent PNG: alpha is the ink. opaque PNG: dark pixels are ink.
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

  // Deterministic shuffle, then take n (with jittered duplicates if ink is scarce).
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

// The dot: a soft radial sprite, drawn once and blitted per point.
export function makeSprite(color) {
  const s = document.createElement('canvas')
  s.width = s.height = 16
  const c = s.getContext('2d')
  const g = c.createRadialGradient(8, 8, 0, 8, 8, 8)
  g.addColorStop(0, `rgba(${color},1)`)
  g.addColorStop(0.5, `rgba(${color},0.8)`)
  g.addColorStop(1, `rgba(${color},0)`)
  c.fillStyle = g
  c.beginPath()
  c.arc(8, 8, 8, 0, Math.PI * 2)
  c.fill()
  return s
}

// Centre a sampled state on its own ink bbox and normalise it so its largest half-extent is 1.
function normalise(raw, n) {
  const cx = (raw.bbox.minX + raw.bbox.maxX) / 2
  const cy = (raw.bbox.minY + raw.bbox.maxY) / 2
  const maxHalf =
    Math.max(
      (raw.bbox.maxX - raw.bbox.minX) / 2,
      (raw.bbox.maxY - raw.bbox.minY) / 2
    ) || 1
  const x = new Float32Array(n)
  const y = new Float32Array(n)
  let extX = 0
  let extY = 0
  for (let i = 0; i < n; i++) {
    x[i] = (raw.x[i] - cx) / maxHalf
    y[i] = (raw.y[i] - cy) / maxHalf
    const ax = Math.abs(x[i])
    const ay = Math.abs(y[i])
    if (ax > extX) extX = ax
    if (ay > extY) extY = ay
  }
  return { x, y, a: raw.a, extX: extX || 1, extY: extY || 1 }
}

/**
 * One image → one always-alive cloud on its own canvas.
 *
 * Async: resolves once the image is sampled, with `null` if it never loaded or its pixels
 * couldn't be read (CORS-tainted) — the caller then leaves the static <img> in place.
 * The loop runs ONLY while the stage is in view, so a page holding several of these costs one
 * cloud's worth of frame time, not N.
 *
 * @param {object} o
 * @param {HTMLElement} o.stage   Positioned box the canvas is injected into (fills it)
 * @param {string} o.src          Image URL, CORS-enabled
 * @param {number} o.points       Points sampled
 * @param {number} o.fit          Fraction of the stage half-extent the ink fills
 * @param {object} o.look         { radius, color } — the dot
 * @param {object} o.motion       { drift, driftSpeed, shimmerFloor, breathAmp, breathSpeed, breathRipple }
 * @param {object} o.intro        { scatter, fade, hold, duration, stagger }
 * @param {number} [o.seed]       RNG seed (vary it so sibling clouds don't scatter identically)
 */
export async function createStillCloud({
  stage,
  src,
  points,
  fit,
  look,
  motion,
  intro,
  seed = 1000,
}) {
  if (!gsap || !stage || !src) return null
  const img = await loadImage(src)
  if (!img) return null

  const N = points
  let state
  try {
    state = normalise(sampleImage(img, N, mulberry32(seed)), N)
  } catch {
    return null // CORS-tainted canvas — getImageData is blocked
  }

  const canvas = document.createElement('canvas')
  canvas.className = 'tabs-stats_pointcloud'
  canvas.setAttribute('aria-hidden', 'true')
  stage.appendChild(canvas)
  const ctx = canvas.getContext('2d')
  const sprite = makeSprite(look.color)

  // Per-point scatter direction + float phase + intro delay (stable across reloads).
  const dispX = new Float32Array(N)
  const dispY = new Float32Array(N)
  const startX = new Float32Array(N)
  const startY = new Float32Array(N)
  const introDelay = new Float32Array(N)
  const driftPhase = new Float32Array(N)
  {
    const rng = mulberry32(seed + 7)
    for (let i = 0; i < N; i++) {
      const ang = rng() * Math.PI * 2
      const mg = rng()
      dispX[i] = Math.cos(ang) * mg
      dispY[i] = Math.sin(ang) * mg
      startX[i] = rng() * 2 - 1
      startY[i] = rng() * 2 - 1
      introDelay[i] = rng() * intro.stagger
      driftPhase[i] = rng() * Math.PI * 2
    }
  }

  let cssW = 0
  let cssH = 0
  let scale = 0
  let coverX = 1
  let coverY = 1
  let dpr = 1
  let inView = false
  let looping = false
  let introActive = false
  let assembled = false
  const introProg = { v: 0 }
  const introFade = { v: 0 }

  function resize() {
    cssW = stage.clientWidth
    cssH = stage.clientHeight
    if (!cssW || !cssH) return
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = cssW * dpr
    canvas.height = cssH * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // Auto-fit on the limiting axis, so the ink never clips whatever the box's ratio is.
    scale = Math.min((cssW * 0.5) / state.extX, (cssH * 0.5) / state.extY) * fit
    coverX = scale ? (cssW * 0.5) / scale : 1
    coverY = scale ? (cssH * 0.5) / scale : 1
    draw()
  }

  function draw() {
    if (!cssW || !cssH) return
    ctx.clearRect(0, 0, cssW, cssH)
    const cx = cssW / 2
    const cy = cssH / 2
    const now = window.performance.now() * 0.001
    const r = look.radius
    const {
      drift,
      driftSpeed,
      shimmerFloor,
      breathAmp,
      breathSpeed,
      breathRipple,
    } = motion

    // Intro: a cloud dispersed across the box drifts, then converges into the shape.
    if (introActive) {
      const p = introProg.v
      const span = 1 + intro.stagger
      const covX = coverX * intro.scatter
      const covY = coverY * intro.scatter
      for (let i = 0; i < N; i++) {
        let pp = p * span - introDelay[i]
        pp = pp < 0 ? 0 : pp > 1 ? 1 : pp
        pp = pp * pp * (3 - 2 * pp)
        // Drift fades from full (dispersed) to the residual shimmer (assembled).
        const amp = (shimmerFloor + (1 - shimmerFloor) * (1 - pp)) * drift
        const fx = Math.cos(now * driftSpeed + driftPhase[i]) * dispX[i] * amp
        const fy = Math.sin(now * driftSpeed + driftPhase[i]) * dispY[i] * amp
        const dx = startX[i] * covX
        const dy = startY[i] * covY
        const bx = dx + (state.x[i] - dx) * pp + fx
        const by = dy + (state.y[i] - dy) * pp + fy
        ctx.globalAlpha = state.a[i] * introFade.v
        ctx.drawImage(
          sprite,
          cx + bx * scale - r,
          cy + by * scale - r,
          r * 2,
          r * 2
        )
      }
      ctx.globalAlpha = 1
      return
    }

    // Assembled: the residual shimmer never stops, and a slow radial ripple breathes.
    const amp = shimmerFloor * drift
    const alpha = assembled ? 1 : 0
    for (let i = 0; i < N; i++) {
      const fx = Math.cos(now * driftSpeed + driftPhase[i]) * dispX[i] * amp
      const fy = Math.sin(now * driftSpeed + driftPhase[i]) * dispY[i] * amp
      let bx = state.x[i] + fx
      let by = state.y[i] + fy
      const dd = Math.sqrt(bx * bx + by * by)
      const breath =
        1 + Math.sin(now * breathSpeed - dd * breathRipple) * breathAmp
      bx *= breath
      by *= breath
      ctx.globalAlpha = state.a[i] * alpha
      ctx.drawImage(
        sprite,
        cx + bx * scale - r,
        cy + by * scale - r,
        r * 2,
        r * 2
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
    if (looping || !inView) return
    looping = true
    window.requestAnimationFrame(loop)
  }

  function runIntro() {
    introActive = true
    introProg.v = 0
    introFade.v = 0
    gsap.killTweensOf([introProg, introFade])
    gsap
      .timeline({
        onComplete: () => {
          introActive = false
          assembled = true
        },
      })
      .to(introFade, { v: 1, duration: intro.fade, ease: 'power1.out' }, 0)
      .to(
        introProg,
        { v: 1, duration: intro.duration, ease: 'power2.inOut' },
        intro.hold
      )
    ensureLoop()
  }

  // The loop is gated on being on screen — that's what makes several of these affordable.
  const io = new window.IntersectionObserver(
    (entries) => {
      inView = entries[0].isIntersecting
      if (!inView) return
      if (!assembled && !introActive) runIntro()
      ensureLoop()
    },
    { threshold: 0.05 }
  )
  io.observe(stage)

  // The box grows when the (still-hidden) <img> beside the canvas finishes loading, and that
  // is not a window resize — so watch the stage rather than waiting to be told.
  const ro = new window.ResizeObserver(() => resize())
  ro.observe(stage)

  resize()

  return {
    resize,
    destroy() {
      io.disconnect()
      ro.disconnect()
      gsap.killTweensOf([introProg, introFade])
      inView = false
      canvas.remove()
    },
  }
}
