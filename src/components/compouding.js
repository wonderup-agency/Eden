/*
  Component: compouding · data-component="compouding"
  Paradigm chrome (ring + underline + numbers + per-tab de-blur text + autoplay) with a
  tabs-stats-style POINT-CLOUD for the visuals: each visual PNG is sampled to ~7k points
  and the cloud morphs between states on every tab switch (intro float-in, residual
  shimmer, radial breathing, desktop hover-nebula). Falls back to an image crossfade if
  the assets can't be sampled (CORS / load error). Hooks match this section's markup
  as-is (data-paradigm-* shared with paradigm; title is data-compunding="tab-title").
  CSS → ./styles/compouding.css (paste into Webflow head) · Docs → .claude/rules/components/compouding.md
*/

import { REVEAL_FROM, REVEAL_TO, splitElement } from '../utils/word-reveal.js'

const { gsap } = window

// ---- Chrome (ring + underline + text) ----
const AUTOPLAY_DURATION = 5 // seconds per tab
const OUT_FADE = 0.3 // outgoing text fade
const TRACK_STROKE = 2.5 // grey ring baseline (viewBox 0 0 100 100)
const ARC_STROKE = 6 // gold ring fill
const GLOW_PAD = 8 // inset so the gold glow fits inside the viewBox
const RING_STEP = 0.6 // ring step transition between tabs
const GLOW_COLOR = '#f7c661' // gold arc glow (Figma F7C661)

// ---- Point cloud (visuals — sampled + morphed, same engine as tabs-stats) ----
const TARGET_POINTS = 9500 // points per state — same for all, for a 1:1 morph (denser cloud)
const SAMPLE_MAX = 560 // longest edge the source PNG is sampled at
const ALPHA_MIN = 28 // min source alpha to count a pixel as "ink"
const LUMA_MAX = 245 // opaque PNGs: count pixels darker than this
const MORPH_DURATION = 1.25
const MORPH_EASE = 'power2.inOut'
const DOT_COLOR = '140,145,152' // light slate grey (tuned for a light bg)
const FIT = 0.8 // per-state: fraction of the stage each shape fills on its limiting axis
// Varied dot sizes: mostly fine dots, a fraction a bit bigger (keep them slim).
const BIG_DOT_CHANCE = 0.15 // fraction of dots that are large
const SMALL_R = [0.35, 0.9] // small-dot radius range (px) — fine
const BIG_R = [1.1, 2.2] // big-dot radius range (px)
// Flow tab: dots circulate along the oval (tangential, shape-preserving). rad/frame.
const FLOW_SPEED = 0.005
// Hover nebula (desktop only — reads as jitter on tablet/below)
const HOVER_RADIUS = 0.4
const HOVER_PUSH = 0.03
const HOVER_SWIRL = 0.06
const HOVER_EASE = 0.11
const HOVER_SCATTER = 0.18
const HOVER_MIN_WIDTH = 992 // px — hover only at/above this (Webflow desktop base)
// Ambient drift — residual shimmer that never fully stops (assembled = DRIFT×SHIMMER_FLOOR).
const DRIFT = 0.26
const DRIFT_SPEED = 0.85
const SHIMMER_FLOOR = 0.6
// Coherent breathing — a slow radial pulse rippling out from center.
const BREATH_AMP = 0.05
const BREATH_SPEED = 1.1
const BREATH_RIPPLE = 2.2
// Intro (float in → assemble).
const INTRO_SCATTER = 1.0
const INTRO_FADE = 0.5
const INTRO_HOLD = 1.0
const INTRO_DURATION = 1.6
const INTRO_STAGGER = 0.5

const SVGNS = 'http://www.w3.org/2000/svg'
const desktopHover = window.matchMedia(`(min-width: ${HOVER_MIN_WIDTH}px)`)

// Outgoing tab: plain fade. The de-blur lives on the words, never the parent.
const REVEAL_OUT = { autoAlpha: 0, duration: OUT_FADE }

// Deterministic RNG so the subsample/ring is stable across reloads.
function mulberry32(seed) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---- Ring SVG helpers ----
function circle(cls, r, strokeWidth) {
  const c = document.createElementNS(SVGNS, 'circle')
  c.setAttribute('class', cls)
  c.setAttribute('cx', '50')
  c.setAttribute('cy', '50')
  c.setAttribute('r', String(r))
  c.setAttribute('fill', 'none')
  c.setAttribute('stroke-width', String(strokeWidth))
  return c
}
function dropShadow(blur, opacity) {
  const fe = document.createElementNS(SVGNS, 'feDropShadow')
  fe.setAttribute('dx', '0')
  fe.setAttribute('dy', '0')
  fe.setAttribute('stdDeviation', String(blur))
  fe.setAttribute('flood-color', GLOW_COLOR)
  fe.setAttribute('flood-opacity', String(opacity))
  return fe
}
function glowFilter(id) {
  const filter = document.createElementNS(SVGNS, 'filter')
  filter.setAttribute('id', id)
  filter.setAttribute('x', '-50%')
  filter.setAttribute('y', '-50%')
  filter.setAttribute('width', '200%')
  filter.setAttribute('height', '200%')
  filter.setAttribute('color-interpolation-filters', 'sRGB')
  filter.appendChild(dropShadow(2.5, 0.9))
  filter.appendChild(dropShadow(5, 0.55))
  const defs = document.createElementNS(SVGNS, 'defs')
  defs.appendChild(filter)
  return defs
}

// ---- Point-cloud sampling (verbatim from tabs-stats) ----
function loadImage(src) {
  return new Promise((resolve) => {
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

// Sample an image's "ink" pixels into n points (x/y/alpha + bbox). Throws if CORS-tainted.
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

function setupRoot(root, rootIndex) {
  const ring = root.querySelector('[data-paradigm="progress-ring"]')
  const numbers = gsap.utils.toArray(
    root.querySelectorAll('.tabs_progress-number')
  )
  const titles = gsap.utils.toArray(
    root.querySelectorAll('[data-compunding="tab-title"]')
  )
  const messages = titles.map(
    (t) => t.querySelector('[data-paradigm-message]') || t
  )
  const links = gsap.utils.toArray(
    root.querySelectorAll('[data-paradigm="tab-link"]')
  )
  const visuals = gsap.utils.toArray(
    root.querySelectorAll('[data-paradigm-visual]')
  )
  const underlineFill = root.querySelector('.tabs_number-underline-fill')
  const messagesWrap = root.querySelector('[data-paradigm-messages]')
  const visualsWrap = root.querySelector('.tabs-compouding_visual-wrapper')

  const count = Math.min(titles.length, links.length, visuals.length)
  if (count < 1) {
    console.warn(
      '[compouding] needs at least one tab-title / tab-link / visual'
    )
    return null
  }

  root.classList.add('is-enhanced')

  const wordsByTab = messages.slice(0, count).map(splitElement)

  // Inject the ring SVG (track + progress arc).
  let progressCircle = null
  let circumference = 0
  if (ring) {
    const r = (100 - ARC_STROKE) / 2 - GLOW_PAD
    circumference = 2 * Math.PI * r
    const svg = document.createElementNS(SVGNS, 'svg')
    svg.setAttribute('class', 'tabs-compouding_progress-svg')
    svg.setAttribute('viewBox', '0 0 100 100')
    svg.setAttribute('aria-hidden', 'true')
    svg.style.overflow = 'visible'
    const glowId = 'compouding-glow-' + rootIndex
    svg.appendChild(glowFilter(glowId))
    svg.appendChild(circle('tabs-compouding_progress-track', r, TRACK_STROKE))
    progressCircle = circle('tabs-compouding_progress-arc', r, ARC_STROKE)
    progressCircle.setAttribute('filter', `url(#${glowId})`)
    progressCircle.style.strokeDasharray = String(circumference)
    progressCircle.style.strokeDashoffset = String(circumference)
    svg.appendChild(progressCircle)
    ring.insertBefore(svg, ring.firstChild)
  }

  // Initial states. Visuals start hidden either way (the canvas paints them in cloud
  // mode; crossfade toggles them in fallback mode).
  gsap.set(titles, { autoAlpha: 0 })
  gsap.set(visuals, { autoAlpha: 0 })
  gsap.set(wordsByTab.flat(), REVEAL_FROM)
  if (underlineFill)
    gsap.set(underlineFill, { scaleX: 0, transformOrigin: 'left center' })

  // ===================== Point-cloud visuals (tabs-stats engine) =====================
  const cloudImgs = visuals
    .slice(0, count)
    .map((v) => v.querySelector('img') || (v.tagName === 'IMG' ? v : null))
  const cloudEnabled = !!(visualsWrap && cloudImgs.every(Boolean))
  // A visual flagged data-compouding-flow is the "loop" tab: its dots stay and
  // CIRCULATE along the oval (flow). An optional overlay element
  // ([data-compouding-overlay] — an <img> with the tags baked in, or HTML pills)
  // fades in on top of the flowing dots while that tab is active.
  const flowFlags = visuals
    .slice(0, count)
    .map((v) => v.hasAttribute('data-compouding-flow'))
  const flowIndex = flowFlags.indexOf(true)
  const overlayEl = root.querySelector('[data-compouding-overlay]')
  if (overlayEl) gsap.set(overlayEl, { autoAlpha: 0 })

  let cloudOk = false // sampling succeeded → canvas drives the visuals
  let cloudFailed = false // sampling bailed (CORS / load) → image crossfade
  let canvas = null
  let cctx = null
  let sprite = null
  const N = TARGET_POINTS
  let states = null
  const fromX = new Float32Array(N)
  const fromY = new Float32Array(N)
  const fromA = new Float32Array(N)
  let toState = null
  const morph = { t: 1 }
  let cloudReady = false
  let introduced = false
  let introActive = false
  let introTarget = 0
  let pendingGo = null
  let looping = false
  // per-point buffers
  const dispX = new Float32Array(N)
  const dispY = new Float32Array(N)
  const pointR = new Float32Array(N) // per-point dot radius (varied sizes)
  const offX = new Float32Array(N)
  const offY = new Float32Array(N)
  const startX = new Float32Array(N)
  const startY = new Float32Array(N)
  const introDelay = new Float32Array(N)
  const driftPhase = new Float32Array(N)
  const introProg = { v: 0 }
  const introFade = { v: 0 }
  let hovActive = false
  let mx = 0
  let my = 0
  let flowActive = false // on the flow tab → dots circulate along the oval
  let flowAngle = 0 // accumulated flow rotation (ellipse-space)
  let flowAX = 1 // flow state's half-extent x (ellipse semi-axis)
  let flowAY = 1
  let cssW = 0
  let cssH = 0
  let cscale = 0 // resting scale of the current state (per-state fit)
  let scaleFrom = 0 // scale at the start of the current morph (interpolated to cscale)
  let curState = 0 // index of the current cloud state
  let coverX = 1
  let coverY = 1
  let cdpr = 1
  const stateExtX = [] // per-state normalized half-width (longer axis = 1)
  const stateExtY = [] // per-state normalized half-height
  const stateScale = [] // per-state fit scale (min of width/height fit × FIT)

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

  // Point the current scale + scatter cover at a given state (no morph in flight).
  function setStateScale(idx) {
    curState = idx
    cscale = stateScale[idx] || cscale
    scaleFrom = cscale
    coverX = cscale ? (cssW * 0.5) / cscale : 1
    coverY = cscale ? (cssH * 0.5) / cscale : 1
  }

  function cloudResize() {
    if (!visualsWrap) return
    cssW = visualsWrap.clientWidth
    cssH = visualsWrap.clientHeight
    cdpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = cssW * cdpr
    canvas.height = cssH * cdpr
    cctx.setTransform(cdpr, 0, 0, cdpr, 0, 0)
    // Per-state fit: each shape gets its own scale so it fills the stage on its
    // limiting axis (wide shapes → width, the squarer circle → height). The morph
    // interpolates between the two states' scales (see drawCloud).
    for (let i = 0; i < stateExtX.length; i++) {
      stateScale[i] =
        Math.min((cssW * 0.5) / stateExtX[i], (cssH * 0.5) / stateExtY[i]) * FIT
    }
    cscale = stateScale[curState] || cssW * 0.5 * FIT
    scaleFrom = cscale
    coverX = cscale ? (cssW * 0.5) / cscale : 1
    coverY = cscale ? (cssH * 0.5) / cscale : 1
    if (cloudReady) drawCloud()
  }

  function drawCloud() {
    cctx.clearRect(0, 0, cssW, cssH)
    if (!cloudReady) return
    const cx = cssW / 2
    const cy = cssH / 2

    if (introActive) {
      const sTarget = states[introTarget]
      const p = introProg.v
      const span = 1 + INTRO_STAGGER
      const now = window.performance.now() * 0.001
      const covX = coverX * INTRO_SCATTER
      const covY = coverY * INTRO_SCATTER
      for (let i = 0; i < N; i++) {
        let pp = p * span - introDelay[i]
        pp = pp < 0 ? 0 : pp > 1 ? 1 : pp
        pp = pp * pp * (3 - 2 * pp)
        const driftAmp =
          (SHIMMER_FLOOR + (1 - SHIMMER_FLOOR) * (1 - pp)) * DRIFT
        const fx =
          Math.cos(now * DRIFT_SPEED + driftPhase[i]) * dispX[i] * driftAmp
        const fy =
          Math.sin(now * DRIFT_SPEED + driftPhase[i]) * dispY[i] * driftAmp
        const dx = startX[i] * covX
        const dy = startY[i] * covY
        const bx = dx + (sTarget.x[i] - dx) * pp + fx
        const by = dy + (sTarget.y[i] - dy) * pp + fy
        const r = pointR[i]
        cctx.globalAlpha = sTarget.a[i] * introFade.v
        cctx.drawImage(
          sprite,
          cx + bx * cscale - r,
          cy + by * cscale - r,
          r * 2,
          r * 2
        )
      }
      cctx.globalAlpha = 1
      return
    }

    const t = morph.t
    const tx = toState.x
    const ty = toState.y
    const ta = toState.a
    const rscale = scaleFrom + (cscale - scaleFrom) * t // interpolated per-state scale
    const R2 = HOVER_RADIUS * HOVER_RADIUS
    const now = window.performance.now() * 0.001
    const driftAmp = SHIMMER_FLOOR * DRIFT
    // Flow: advance the rotation once per frame; rotate each point in ellipse space
    // (normalize by the oval's semi-axes → rotate → denormalize) so points circulate
    // ALONG the oval without the shape itself spinning.
    if (flowActive) flowAngle += FLOW_SPEED
    const cosF = Math.cos(flowAngle)
    const sinF = Math.sin(flowAngle)
    for (let i = 0; i < N; i++) {
      const fx =
        Math.cos(now * DRIFT_SPEED + driftPhase[i]) * dispX[i] * driftAmp
      const fy =
        Math.sin(now * DRIFT_SPEED + driftPhase[i]) * dispY[i] * driftAmp
      let bx = fromX[i] + (tx[i] - fromX[i]) * t + fx
      let by = fromY[i] + (ty[i] - fromY[i]) * t + fy
      const dd = Math.sqrt(bx * bx + by * by)
      const breath =
        1 + Math.sin(now * BREATH_SPEED - dd * BREATH_RIPPLE) * BREATH_AMP
      bx *= breath
      by *= breath
      if (flowActive) {
        const nx = bx / flowAX
        const ny = by / flowAY
        bx = (nx * cosF - ny * sinF) * flowAX
        by = (nx * sinF + ny * cosF) * flowAY
      }
      let txo = 0
      let tyo = 0
      let glow = 0
      if (hovActive) {
        const ddx = bx - mx
        const ddy = by - my
        const d2 = ddx * ddx + ddy * ddy
        if (d2 < R2) {
          const d = Math.sqrt(d2) || 1e-4
          let f = 1 - d / HOVER_RADIUS
          f = f * f * (3 - 2 * f)
          const nx = ddx / d
          const ny = ddy / d
          txo =
            (nx * HOVER_PUSH - ny * HOVER_SWIRL + dispX[i] * HOVER_SCATTER) * f
          tyo =
            (ny * HOVER_PUSH + nx * HOVER_SWIRL + dispY[i] * HOVER_SCATTER) * f
          glow = f
        }
      }
      offX[i] += (txo - offX[i]) * HOVER_EASE
      offY[i] += (tyo - offY[i]) * HOVER_EASE
      const sx = cx + (bx + offX[i]) * rscale
      const sy = cy + (by + offY[i]) * rscale
      const r = pointR[i] * (1 + glow * 0.7)
      cctx.globalAlpha = fromA[i] + (ta[i] - fromA[i]) * t
      cctx.drawImage(sprite, sx - r, sy - r, r * 2, r * 2)
    }
    cctx.globalAlpha = 1
  }

  function cloudLoop() {
    drawCloud()
    if (onScreen) window.requestAnimationFrame(cloudLoop)
    else looping = false
  }
  function ensureCloudLoop() {
    if (!looping && onScreen && cloudReady) {
      looping = true
      window.requestAnimationFrame(cloudLoop)
    }
  }

  function morphTo(next) {
    const t = morph.t
    const tx = toState.x
    const ty = toState.y
    const ta = toState.a
    // If leaving the flow tab, bake the current flow rotation into the snapshot so the
    // morph-away starts exactly where the flowing dots are (no snap to the un-rotated oval).
    const cosF = flowActive ? Math.cos(flowAngle) : 1
    const sinF = flowActive ? Math.sin(flowAngle) : 0
    for (let i = 0; i < N; i++) {
      let sx = fromX[i] + (tx[i] - fromX[i]) * t
      let sy = fromY[i] + (ty[i] - fromY[i]) * t
      if (flowActive) {
        const nx = sx / flowAX
        const ny = sy / flowAY
        sx = (nx * cosF - ny * sinF) * flowAX
        sy = (nx * sinF + ny * cosF) * flowAY
      }
      fromX[i] = sx
      fromY[i] = sy
      fromA[i] = fromA[i] + (ta[i] - fromA[i]) * t
    }
    toState = states[next]
    // Morph the scale from the current state's fit to the next one's (interpolated in
    // drawCloud), so the circle grows/shrinks to its own size as the shape changes.
    scaleFrom = cscale
    curState = next
    cscale = stateScale[next] || cscale
    coverX = cscale ? (cssW * 0.5) / cscale : 1
    coverY = cscale ? (cssH * 0.5) / cscale : 1
    morph.t = 0
    gsap.killTweensOf(morph)
    gsap.to(morph, { t: 1, duration: MORPH_DURATION, ease: MORPH_EASE })
    ensureCloudLoop()
  }

  function runIntro(target) {
    introTarget = target
    toState = states[target]
    setStateScale(target) // intro draws at the target state's own scale
    introActive = true
    introProg.v = 0
    introFade.v = 0
    gsap.killTweensOf([introProg, introFade])
    gsap
      .timeline({ onComplete: () => finishIntro(target) })
      .to(introFade, { v: 1, duration: INTRO_FADE, ease: 'power1.out' }, 0)
      .to(
        introProg,
        { v: 1, duration: INTRO_DURATION, ease: 'power2.inOut' },
        INTRO_HOLD
      )
    ensureCloudLoop()
  }

  function finishIntro(target) {
    introActive = false
    const s = states[target]
    fromX.set(s.x)
    fromY.set(s.y)
    fromA.set(s.a)
    toState = s
    setStateScale(target)
    morph.t = 1
    drawCloud()
  }

  // Tell the cloud which tab is active. Defers until sampled; the first call plays the
  // intro converging onto that state, subsequent calls morph.
  function cloudGo(i) {
    if (!cloudOk) return
    if (!cloudReady) {
      pendingGo = i
      return
    }
    if (!introduced) {
      introduced = true
      runIntro(i)
    } else if (states[i] && toState !== states[i]) {
      morphTo(i)
    }
  }

  async function bootCloud() {
    canvas = document.createElement('canvas')
    canvas.className = 'tabs-compouding_pointcloud'
    canvas.setAttribute('aria-hidden', 'true')
    visualsWrap.appendChild(canvas)
    cctx = canvas.getContext('2d')
    sprite = makeSprite()
    cloudResize()

    const srcs = cloudImgs.map((im) => im.currentSrc || im.src)
    const loaded = await Promise.all(srcs.map(loadImage))
    const firstOk = loaded.find(Boolean)
    if (!firstOk) {
      console.warn(
        '[compouding] no visual images loaded — image crossfade fallback'
      )
      canvas.remove()
      cloudFailed = true
      crossfadeVisuals(index)
      return
    }
    for (let i = 0; i < loaded.length; i++) if (!loaded[i]) loaded[i] = firstOk

    let raw
    try {
      raw = loaded.map((im, i) => sampleImage(im, N, mulberry32(1000 + i)))
    } catch (err) {
      console.warn(
        '[compouding] could not sample visuals (CORS?) — image crossfade fallback',
        err
      )
      canvas.remove()
      cloudFailed = true
      crossfadeVisuals(index)
      return
    }

    // Per-state fit: normalize EACH state to its own max half-extent (longer axis → 1),
    // centered on its own bbox, and record its normalized half-extents. Each shape then
    // fills the stage on its limiting axis (cloudResize → stateScale): the wide shapes
    // fill the width, the squarer circle fills the height — each at its own size.
    states = raw.map((r) => {
      const cxp = (r.bbox.minX + r.bbox.maxX) / 2
      const cyp = (r.bbox.minY + r.bbox.maxY) / 2
      const hw = (r.bbox.maxX - r.bbox.minX) / 2
      const hh = (r.bbox.maxY - r.bbox.minY) / 2
      const half = Math.max(hw, hh) || 1
      const ni = 1 / half
      const x = new Float32Array(N)
      const y = new Float32Array(N)
      for (let k = 0; k < N; k++) {
        x[k] = (r.x[k] - cxp) * ni
        y[k] = (r.y[k] - cyp) * ni
      }
      stateExtX.push(hw / half || 1)
      stateExtY.push(hh / half || 1)
      return { x, y, a: r.a }
    })

    // Flow state's own semi-axes (for the ellipse-space circulation).
    if (flowIndex >= 0) {
      const s = states[flowIndex]
      let ax = 0
      let ay = 0
      for (let k = 0; k < N; k++) {
        const vx = Math.abs(s.x[k])
        const vy = Math.abs(s.y[k])
        if (vx > ax) ax = vx
        if (vy > ay) ay = vy
      }
      flowAX = ax || 1
      flowAY = ay || 1
    }
    cloudResize()

    toState = states[0]
    fromX.set(states[0].x)
    fromY.set(states[0].y)
    fromA.set(states[0].a)
    morph.t = 1

    const frng = mulberry32(7)
    for (let i = 0; i < N; i++) {
      const ang = frng() * Math.PI * 2
      const mg = frng()
      dispX[i] = Math.cos(ang) * mg
      dispY[i] = Math.sin(ang) * mg
      startX[i] = frng() * 2 - 1
      startY[i] = frng() * 2 - 1
      introDelay[i] = frng() * INTRO_STAGGER
      driftPhase[i] = frng() * Math.PI * 2
      // ~18% big dots, the rest small — varied per-point size.
      pointR[i] =
        frng() < BIG_DOT_CHANCE
          ? BIG_R[0] + frng() * (BIG_R[1] - BIG_R[0])
          : SMALL_R[0] + frng() * (SMALL_R[1] - SMALL_R[0])
    }

    cloudOk = true
    cloudReady = true
    root.classList.add('is-canvas') // CSS hides the source imgs, shows the canvas
    // Run whatever tab was requested while sampling was in flight.
    if (pendingGo != null) cloudGo(pendingGo)
    else if (onScreen) cloudGo(index)
    updateFlowTab(index) // start flow + labels if we booted onto the flow tab
  }

  // Crossfade fallback (cloud disabled / failed): the original paradigm behaviour.
  function crossfadeVisuals(i) {
    visuals.forEach((v, k) =>
      gsap.to(v, {
        autoAlpha: k === i ? 1 : 0,
        duration: 0.6,
        ease: 'sine.out',
      })
    )
  }

  // Canvas mode only. On the flow tab the dots stay and CIRCULATE along the oval,
  // and the overlay (tags image / HTML) fades in on top; off it, flow stops and the
  // overlay fades out.
  function updateFlowTab(i) {
    if (!cloudOk) return
    flowActive = i === flowIndex
    if (overlayEl) {
      gsap.to(overlayEl, {
        autoAlpha: flowActive ? 1 : 0,
        duration: flowActive ? 0.6 : 0.3,
        ease: 'sine.out',
        delay: flowActive ? 0.5 : 0, // let the oval form before the overlay lands
      })
    }
  }

  // ===================== Paradigm chrome (ring + underline + text + autoplay) =========
  let index = 0
  let started = false
  let progressTl = null
  let ringTween = null
  let onScreen = false
  let hover = false
  let docVisible = !document.hidden

  const shouldPlay = () => started && onScreen && !hover && docVisible
  const sync = () => {
    if (!progressTl) return
    shouldPlay() ? progressTl.play() : progressTl.pause()
  }

  const ringTarget = (i) => circumference * (1 - (i + 1) / count)
  const ringTo = (i, loop) => {
    if (!progressCircle) return
    ringTween && ringTween.kill()
    const target = ringTarget(i)
    if (!loop) {
      ringTween = gsap.to(progressCircle, {
        strokeDashoffset: target,
        duration: RING_STEP,
        ease: 'power2.out',
      })
      return
    }
    const current = parseFloat(progressCircle.style.strokeDashoffset) || 0
    ringTween = gsap.timeline()
    if (current > 1)
      ringTween.to(progressCircle, {
        strokeDashoffset: 0,
        duration: RING_STEP,
        ease: 'power2.in',
      })
    ringTween
      .set(progressCircle, { strokeDashoffset: circumference })
      .to(progressCircle, {
        strokeDashoffset: target,
        duration: RING_STEP,
        ease: 'power2.out',
      })
  }

  const activate = (i, loop) => {
    numbers.forEach((n, k) =>
      n.classList.toggle('is-active', k === i % numbers.length)
    )
    links.forEach((l, k) => {
      l.classList.toggle('is-active', k === i)
      l.setAttribute('aria-current', k === i ? 'true' : 'false')
    })

    titles.forEach((t, k) => {
      if (k !== i) gsap.to(t, REVEAL_OUT)
    })
    gsap.set(titles[i], { autoAlpha: 1 })
    gsap.set(wordsByTab[i], REVEAL_FROM)
    gsap.to(wordsByTab[i], REVEAL_TO)

    // Visuals: point-cloud morph if the cloud is live (or still sampling), else
    // image crossfade (cloud disabled or sampling failed). In cloud mode, the flow
    // tab also starts the circulation + fades its HTML labels in.
    if (cloudEnabled && !cloudFailed) {
      cloudGo(i)
      updateFlowTab(i)
    } else {
      crossfadeVisuals(i)
    }

    ringTo(i, loop)
  }

  // Underline = autoplay progress: a darker fill grows across the light-grey track,
  // cumulatively over the cycle (tab i runs i/count → (i+1)/count; resets on loop).
  const runProgress = () => {
    progressTl && progressTl.kill()
    progressTl = gsap.timeline({ onComplete: () => goTo((index + 1) % count) })
    if (underlineFill) {
      gsap.set(underlineFill, { scaleX: index / count })
      progressTl.to(
        underlineFill,
        {
          scaleX: (index + 1) / count,
          duration: AUTOPLAY_DURATION,
          ease: 'none',
        },
        0
      )
    }
    sync()
  }

  function goTo(i) {
    const loop = i < index
    index = i
    activate(i, loop)
    runProgress()
  }

  const start = () => {
    if (started) return
    started = true
    goTo(0)
  }

  const select = (i) => {
    started = true
    goTo(i)
  }

  const wireButton = (el, onActivate, label) => {
    el.setAttribute('role', 'button')
    el.setAttribute('tabindex', '0')
    el.setAttribute('aria-label', label)
    el.addEventListener('click', onActivate)
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onActivate()
      }
    })
  }

  if (ring) wireButton(ring, () => select((index + 1) % count), 'Next slide')
  links.forEach((l, i) =>
    wireButton(l, () => select(i), 'Go to slide ' + (i + 1))
  )

  // Visibility / hover / tab-focus gating (drives autoplay AND the cloud loop).
  const io = new window.IntersectionObserver(
    (entries) => {
      onScreen = entries[0].isIntersecting
      if (onScreen) {
        if (!started) start()
        else sync()
        ensureCloudLoop()
      } else {
        sync()
        if (cloudReady) cctx.clearRect(0, 0, cssW, cssH)
      }
    },
    { threshold: 0.35 }
  )
  io.observe(root)

  // Pause autoplay only while hovering the content (text + visual).
  ;[messagesWrap, visualsWrap].forEach((el) => {
    if (!el) return
    el.addEventListener('mouseenter', () => {
      hover = true
      sync()
    })
    el.addEventListener('mouseleave', () => {
      hover = false
      sync()
    })
  })
  document.addEventListener('visibilitychange', () => {
    docVisible = !document.hidden
    sync()
  })

  // Cloud hover-nebula over the visual stage (desktop only). Separate from the autoplay
  // pause above — hovering loosens the cloud but doesn't need to stop the morph.
  if (cloudEnabled) {
    visualsWrap.addEventListener('pointermove', (e) => {
      if (!desktopHover.matches || !cscale) return
      const rect = visualsWrap.getBoundingClientRect()
      mx = (e.clientX - rect.left - cssW / 2) / cscale
      my = (e.clientY - rect.top - cssH / 2) / cscale
      ensureCloudLoop()
    })
    visualsWrap.addEventListener('pointerenter', () => {
      if (!desktopHover.matches) return
      hovActive = true
      ensureCloudLoop()
    })
    visualsWrap.addEventListener('pointerleave', () => {
      hovActive = false
      ensureCloudLoop()
    })
    desktopHover.addEventListener('change', (e) => {
      if (!e.matches) hovActive = false
    })
    bootCloud()
  }

  return {
    resize() {
      if (cloudOk) cloudResize()
    },
  }
}

// Static fallback (no GSAP / reduced motion): show the first tab only via classes.
function staticFallback(root) {
  const first = (sel) => root.querySelector(sel)
  first('[data-compunding="tab-title"]')?.classList.add('is-active')
  first('[data-paradigm="tab-link"]')?.classList.add('is-active')
  first('[data-paradigm-visual]')?.classList.add('is-active')
  first('.tabs_progress-number')?.classList.add('is-active')
  root.classList.add('is-static')
}

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='compouding']
 */
export default function (elements) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (!gsap || reduce) {
    if (!gsap)
      console.warn('[compouding] GSAP not found on window — static fallback')
    elements.forEach(staticFallback)
    return
  }

  const instances = elements.map(setupRoot).filter(Boolean)
  if (!instances.length) return

  return {
    resize() {
      instances.forEach((inst) => inst.resize())
    },
  }
}
