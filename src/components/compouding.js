/*
  Component: compouding · data-component="compouding"
  Paradigm chrome (underline + per-tab de-blur text + autoplay) with a tabs-stats-style
  POINT-CLOUD for the visuals: each visual PNG is sampled to ~9.5k points and the cloud
  WAVE-MORPHS between states on every switch (per-point staggered timing + a L→R sweep;
  the oval draws AROUND as a loop). Special per-shape motion: the flow tab circulates
  (loop), the bar tab slowly rotates around its long axis (diffuse-DNA). Plus intro
  float-in, desynced shimmer, radial breathing, desktop hover-nebula. Falls back to an
  image crossfade if the assets can't be sampled (CORS / load error).
  CSS → ./styles/compouding.css (bundled via src/styles.js) · Docs → .claude/rules/components/compouding.md
*/

import { REVEAL_FROM, REVEAL_TO, splitElement } from '../utils/word-reveal.js'

const { gsap } = window

// ---- Chrome (underline + text) ----
const OUT_FADE = 0.3 // outgoing text fade
// Autoplay dwell scales with the tab's text length (more words → longer).
const AUTOPLAY_BASE = 3.5 // seconds baseline per tab
const AUTOPLAY_PER_WORD = 0.35 // extra seconds per word of the tab's message
const AUTOPLAY_MIN = 4 // floor (also keeps it ≥ the morph)
const AUTOPLAY_MAX = 11 // ceiling

// Per-tab autoplay seconds from its message word count.
function autoplayDuration(el) {
  const words = (el?.textContent || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
  const d = AUTOPLAY_BASE + words * AUTOPLAY_PER_WORD
  return Math.min(AUTOPLAY_MAX, Math.max(AUTOPLAY_MIN, d))
}

// ---- Point cloud (visuals — sampled + wave-morphed) ----
const TARGET_POINTS = 9500 // points per state — same for all, for a 1:1 morph
const SAMPLE_MAX = 560 // longest edge the source PNG is sampled at
const ALPHA_MIN = 28 // min source alpha to count a pixel as "ink"
const LUMA_MAX = 245 // opaque PNGs: count pixels darker than this
const DOT_COLOR = '140,145,152' // light slate grey (tuned for a light bg)
const FIT = 0.8 // per-state: fraction of the stage each shape fills on its limiting axis
// Varied dot sizes: mostly fine dots, a fraction a bit bigger (keep them slim).
const BIG_DOT_CHANCE = 0.15
const SMALL_R = [0.35, 0.9]
const BIG_R = [1.1, 2.2]
// Morph (the transition): per-point staggered "wave" — some particles arrive faster.
const MORPH_DURATION = 3.5
const MORPH_EASE = 'power1.inOut'
const MORPH_SPREAD = 0.55 // how far the per-point START is staggered along the sweep
const MORPH_SPEED_VAR = 0.5 // per-point DURATION variance (faster/slower particles)
const WAVE_RANDOM = 0.4 // blend the ordered sweep with per-point randomness (softer)
// Hover nebula (desktop only — reads as jitter on tablet/below)
const HOVER_RADIUS = 0.4
const HOVER_PUSH = 0.03
const HOVER_SWIRL = 0.06
const HOVER_EASE = 0.11
const HOVER_SCATTER = 0.18
const HOVER_MIN_WIDTH = 992 // px — hover only at/above this (Webflow desktop base)
// Ambient shimmer — residual drift that never fully stops (assembled = DRIFT×SHIMMER_FLOOR).
const DRIFT = 0.16
const DRIFT_SPEED = 1.2 // shimmer oscillation rate
const SHIMMER_FLOOR = 0.5
const DRIFT_FREQ_VAR = 0.4 // per-point drift-frequency variation → desynced shimmer
// Coherent breathing — a slow radial pulse rippling out from center.
const BREATH_AMP = 0.03
const BREATH_SPEED = 1.65
const BREATH_RIPPLE = 2.2
// Flow tab (oval): dots circulate along the ring (loop). Decoupled, slow. rad/frame.
const FLOW_SPEED = 0.003
// The oval PNG has the tag pills baked in → generate a clean dot ring procedurally for
// the flow state instead of sampling it (the tags come from the HTML overlay). Set false
// once a tags-free oval PNG is provided.
const OVAL_PROCEDURAL = true
// Flow tab overlay (tags): each fades at its own speed (desfasado) + staggered start.
const TAG_FADE = 0.9
const TAG_STAGGER = 0.18
// Pills sit OUTSIDE the ring with this clearance (px) — centred on the perimeter they were
// crossed by the dots. The oval's fit reserves the pill box + this gap (see cloudResize).
const TAG_GAP = 14
// Bar tab: the band slowly rotates around its long axis (diffuse-DNA).
const BAR_HEIGHT = 0.32 // bar half-height = rotation radius (subtle)
const BAR_TWIST = 0.4 // turns of twist across the bar (low = subtle, not literal DNA)
const BAR_SPEED = 0.12 // rotation speed (decoupled → stays slow)
// Intro (float in → assemble): gentle so the load assembly never lurches.
const INTRO_SCATTER = 0.6
const INTRO_FADE = 0.6
const INTRO_HOLD = 0.8
const INTRO_DURATION = 2.4
const INTRO_STAGGER = 0.7

// Tuning — messages column fits the active tab
// Every tab-title shares grid cell 1/1, so the column would otherwise always be as tall as
// the LONGEST tab, leaving the shorter ones trailing that leftover height before the
// figures. The column height is tweened to the active tab instead, in step with the text.
const FIT_TWEEN = { duration: 1, ease: 'sine.out' } // matches REVEAL_TO so it reads as one motion

const desktopHover = window.matchMedia(`(min-width: ${HOVER_MIN_WIDTH}px)`)

// Outgoing tab: plain fade. The de-blur lives on the words, never the parent.
const REVEAL_OUT = { autoAlpha: 0, duration: OUT_FADE }

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

// Clean elliptical dot ring for the flow/oval state — used instead of sampling the
// oval PNG (which has the tag pills baked in). Same {x,y,a,bbox} contract as sampleImage.
function proceduralRing(n, rng) {
  const S = SAMPLE_MAX
  const cx = S / 2
  const cy = S / 2
  const RX = S * 0.46
  const RY = S * 0.3
  const band = S * 0.035 // ring thickness
  const x = new Float32Array(n)
  const y = new Float32Array(n)
  const a = new Float32Array(n)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < n; i++) {
    const ang = rng() * Math.PI * 2
    const o = (rng() - 0.5) * 2 * band
    const sx = cx + Math.cos(ang) * (RX + o)
    const sy = cy + Math.sin(ang) * (RY + o)
    x[i] = sx
    y[i] = sy
    a[i] = 0.55 + 0.45 * rng()
    if (sx < minX) minX = sx
    if (sx > maxX) maxX = sx
    if (sy < minY) minY = sy
    if (sy > maxY) maxY = sy
  }
  return { x, y, a, bbox: { minX, minY, maxX, maxY } }
}

// Flow-tab labels — injected as HTML pills when no [data-compouding-overlay] exists.
const TAGS = [
  { label: 'Feedback →', pos: 'top' },
  { label: 'Deployment ↑', pos: 'left' },
  { label: 'Research ↓', pos: 'right' },
  { label: '← Model', pos: 'bottom' },
]

// Append a pill per TAG into a container (positioned later on the oval ring by JS).
function fillTags(container) {
  TAGS.forEach((t) => {
    const el = document.createElement('span')
    el.className = 'tabs-compouding_tag'
    el.dataset.pos = t.pos
    el.textContent = t.label
    container.appendChild(el)
  })
}

// Build the flow-tab tags overlay (a pill per TAG).
function injectTags(parent) {
  const wrap = document.createElement('div')
  wrap.className = 'tabs-compouding_tags'
  wrap.setAttribute('data-compouding-overlay', '')
  wrap.setAttribute('aria-hidden', 'true')
  fillTags(wrap)
  parent.appendChild(wrap)
  return wrap
}

function setupRoot(root) {
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

  // Per-number underline (active-only): inject a grey track + black fill into each number.
  // Only the active number's fill grows 0→1; the rest stay empty (inactive). Replaces the
  // single full-width .tabs_number-underline (hidden via CSS).
  const bars = links.slice(0, count).map((link) => {
    const track = document.createElement('span')
    track.className = 'tabs-compouding_tab-link-underline is-track'
    const fill = document.createElement('span')
    fill.className = 'tabs-compouding_tab-link-fill'
    track.appendChild(fill)
    link.appendChild(track)
    return fill
  })

  const wordsByTab = messages.slice(0, count).map(splitElement)

  // Initial states. Visuals start hidden either way (the canvas paints them in cloud
  // mode; crossfade toggles them in fallback mode).
  gsap.set(titles, { autoAlpha: 0 })
  gsap.set(visuals, { autoAlpha: 0 })
  gsap.set(wordsByTab.flat(), REVEAL_FROM)
  gsap.set(bars, { scaleX: 0, transformOrigin: 'left center' })

  // ===================== Point-cloud visuals =====================
  const cloudImgs = visuals
    .slice(0, count)
    .map((v) => v.querySelector('img') || (v.tagName === 'IMG' ? v : null))
  const cloudEnabled = !!(visualsWrap && cloudImgs.every(Boolean))
  // data-compouding-flow → the "loop" tab: its dots CIRCULATE along the oval, and an
  // optional [data-compouding-overlay] (an <img> with tags, or HTML pills) fades in.
  // data-compouding-bar → the "bar" tab: the band slowly rotates around its long axis.
  const flowIndex = visuals
    .slice(0, count)
    .findIndex((v) => v.hasAttribute('data-compouding-flow'))
  const barIndex = visuals
    .slice(0, count)
    .findIndex((v) => v.hasAttribute('data-compouding-bar'))
  // Flow-tab overlay (canvas mode + a flow tab only). Inject the TAGS pills when there's
  // no author overlay; if an author overlay exists but is EMPTY, fill it with the pills
  // (so a leftover empty [data-compouding-overlay] div doesn't silently suppress them).
  let overlayEl = root.querySelector('[data-compouding-overlay]')
  if (cloudEnabled && flowIndex >= 0 && visualsWrap) {
    if (!overlayEl) overlayEl = injectTags(visualsWrap)
    else if (!overlayEl.children.length) fillTags(overlayEl)
  }
  // Tag items: the overlay's element children if any (stagger them), else the element.
  const overlayItems = overlayEl
    ? overlayEl.children.length
      ? Array.from(overlayEl.children)
      : [overlayEl]
    : []
  if (overlayItems.length) gsap.set(overlayItems, { autoAlpha: 0 })

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
  let morphing = false
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
  const driftFreq = new Float32Array(N) // per-point shimmer frequency → desynced
  const mProj = new Float32Array(N) // per-point sweep projection (0..1, per target)
  const waveJit = new Float32Array(N) // per-point random blended into the wave delay
  const mRand = new Float32Array(N) // per-point random → morph speed variance
  const barCross = new Float32Array(N) // per-point cross coord in the bar (-1..1)
  const introProg = { v: 0 }
  const introFade = { v: 0 }
  let hovActive = false
  let mx = 0
  let my = 0
  let flowActive = false // on the flow tab → dots circulate along the oval
  let flowAngle = 0 // accumulated flow rotation (ellipse-space)
  let flowAX = 1 // flow state's half-extent x (ellipse semi-axis)
  let flowAY = 1
  let barFrom = false // bar is the morph's source → ease its rotation OUT
  let barTo = false // bar is the morph's target → ease it IN
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
    // The flow state fits into the stage MINUS the pill boxes, so the tags clear the ring
    // (and the section text) instead of straddling it.
    const res = tagReserve()
    for (let i = 0; i < stateExtX.length; i++) {
      const rx = i === flowIndex ? res.x : 0
      const ry = i === flowIndex ? res.y : 0
      const halfW = Math.max(cssW * 0.5 - rx, cssW * 0.25)
      const halfH = Math.max(cssH * 0.5 - ry, cssH * 0.25)
      stateScale[i] =
        Math.min(halfW / stateExtX[i], halfH / stateExtY[i]) *
        (i === flowIndex ? 1 : FIT)
    }
    cscale = stateScale[curState] || cssW * 0.5 * FIT
    scaleFrom = cscale
    coverX = cscale ? (cssW * 0.5) / cscale : 1
    coverY = cscale ? (cssH * 0.5) / cscale : 1
    positionTags()
    if (cloudReady) drawCloud()
  }

  // Room the pills need outside the ring (half the biggest box per axis + the gap), so
  // cloudResize can shrink the oval by exactly that much. 0 when there are no data-pos
  // pills (an author-positioned overlay keeps the full stage).
  function tagReserve() {
    let x = 0
    let y = 0
    overlayItems.forEach((el) => {
      const pos = el.dataset && el.dataset.pos
      if (!pos) return
      if (pos === 'left' || pos === 'right')
        x = Math.max(x, el.offsetWidth + TAG_GAP)
      else y = Math.max(y, el.offsetHeight + TAG_GAP)
    })
    return { x, y }
  }

  // Anchor the injected tag pills just OUTSIDE the oval's real perimeter (its own
  // semi-axes × fit scale), clear of the dots by TAG_GAP. Only items carrying data-pos
  // are moved — an author-positioned overlay (no data-pos) is left where the Designer
  // placed it. Pills are centred on the point set here (CSS translate(-50%, -50%)), so
  // each offset is the gap plus half the pill's own box.
  function positionTags() {
    if (flowIndex < 0 || !stateScale.length) return
    const ex = stateExtX[flowIndex] || 1
    const ey = stateExtY[flowIndex] || 1
    const sc = stateScale[flowIndex] || cscale
    const cx = cssW / 2
    const cy = cssH / 2
    const hw = ex * sc
    const hh = ey * sc
    overlayItems.forEach((el) => {
      const pos = el.dataset && el.dataset.pos
      if (!pos) return
      const offX = hw + TAG_GAP + el.offsetWidth / 2
      const offY = hh + TAG_GAP + el.offsetHeight / 2
      const x = pos === 'left' ? cx - offX : pos === 'right' ? cx + offX : cx
      const y = pos === 'top' ? cy - offY : pos === 'bottom' ? cy + offY : cy
      el.style.left = x + 'px'
      el.style.top = y + 'px'
    })
  }

  // Principal axis (largest covariance eigenvector) → the shape's long axis.
  function principalAxis(s) {
    let mxx = 0
    let myy = 0
    let mxy = 0
    for (let i = 0; i < N; i++) {
      const x = s.x[i]
      const y = s.y[i]
      mxx += x * x
      myy += y * y
      mxy += x * y
    }
    const tr = mxx + myy
    const det = mxx * myy - mxy * mxy
    const l = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det))
    let ax = l - myy
    let ay = mxy
    if (Math.abs(ax) + Math.abs(ay) < 1e-6) {
      ax = 1
      ay = 0
    }
    const nrm = Math.hypot(ax, ay)
    return [ax / nrm, ay / nrm]
  }

  // Per-point sweep projection for the wave morph. Oval: sweep AROUND the ring (by
  // angle) so it "draws the loop". Others: project onto the principal axis oriented
  // rightward (and down) → every morph reads as a L→R cascade.
  function computeWave(next) {
    const s = states[next]
    if (next === flowIndex) {
      for (let i = 0; i < N; i++)
        mProj[i] = (Math.atan2(s.y[i], s.x[i]) + Math.PI) / (2 * Math.PI)
      return
    }
    let [ax, ay] = principalAxis(s)
    if (ax < 0 || (Math.abs(ax) < 1e-6 && ay < 0)) {
      ax = -ax
      ay = -ay
    }
    let min = Infinity
    let max = -Infinity
    for (let i = 0; i < N; i++) {
      const p = s.x[i] * ax + s.y[i] * ay
      if (p < min) min = p
      if (p > max) max = p
    }
    const span = max - min || 1
    for (let i = 0; i < N; i++)
      mProj[i] = (s.x[i] * ax + s.y[i] * ay - min) / span
  }

  // Per-point local morph progress at global t: staggered START (sweep ⊕ randomness)
  // + per-point DURATION (speed variance). All points reach 1 by t = 1. Smoothstepped.
  function waveLP(i, t) {
    const spreadClamp = MORPH_SPREAD < 0.9 ? MORPH_SPREAD : 0.9
    const delay = (1 - WAVE_RANDOM) * mProj[i] + WAVE_RANDOM * waveJit[i]
    const start = delay * spreadClamp
    let dur = (1 - start) * (1 - mRand[i] * MORPH_SPEED_VAR)
    if (dur < 1e-3) dur = 1e-3
    let lp = (t - start) / dur
    lp = lp < 0 ? 0 : lp > 1 ? 1 : lp
    return lp * lp * (3 - 2 * lp)
  }

  function drawCloud() {
    cctx.clearRect(0, 0, cssW, cssH)
    if (!cloudReady) return
    const cx = cssW / 2
    const cy = cssH / 2
    const now = window.performance.now() * 0.001

    if (introActive) {
      const sTarget = states[introTarget]
      const p = introProg.v
      const span = 1 + INTRO_STAGGER
      const covX = coverX * INTRO_SCATTER
      const covY = coverY * INTRO_SCATTER
      for (let i = 0; i < N; i++) {
        let pp = p * span - introDelay[i]
        pp = pp < 0 ? 0 : pp > 1 ? 1 : pp
        pp = pp * pp * (3 - 2 * pp)
        const driftAmp =
          (SHIMMER_FLOOR + (1 - SHIMMER_FLOOR) * (1 - pp)) * DRIFT
        const ph = now * DRIFT_SPEED * driftFreq[i] + driftPhase[i]
        const fx = Math.cos(ph) * dispX[i] * driftAmp
        const fy = Math.sin(ph) * dispY[i] * driftAmp
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
    const driftAmp = SHIMMER_FLOOR * DRIFT
    // Flow circulation starts only once the loop has formed (after the morph settles).
    if (flowActive && !morphing) flowAngle += FLOW_SPEED
    const cosF = Math.cos(flowAngle)
    const sinF = Math.sin(flowAngle)
    const barTwist = BAR_TWIST * Math.PI
    const barRot = now * BAR_SPEED
    // Bar envelope: eases the rotation+shading IN (target) / OUT (source) → no flash.
    const barAmt = barTo ? t : barFrom ? 1 - t : 0

    for (let i = 0; i < N; i++) {
      const lp = waveLP(i, t)
      const ph = now * DRIFT_SPEED * driftFreq[i] + driftPhase[i]
      const fx = Math.cos(ph) * dispX[i] * driftAmp
      const fy = Math.sin(ph) * dispY[i] * driftAmp
      let bx = fromX[i] + (tx[i] - fromX[i]) * lp + fx
      let by = fromY[i] + (ty[i] - fromY[i]) * lp + fy
      const dd = Math.sqrt(bx * bx + by * by)
      const breath =
        1 + Math.sin(now * BREATH_SPEED - dd * BREATH_RIPPLE) * BREATH_AMP
      bx *= breath
      by *= breath
      let depthA = 1
      let depthR = 1
      if (barAmt > 0) {
        // band rotates around its long axis: cross coord → cos(angle) on screen,
        // sin(angle) as depth (front brighter/bigger). barTwist adds a gentle ribbon.
        const angle = barRot + bx * barTwist
        const yb = barCross[i] * BAR_HEIGHT * Math.cos(angle)
        by += (yb - by) * barAmt
        const dn = barCross[i] * Math.sin(angle) * 0.5 + 0.5
        depthA = 1 + (0.4 + 0.6 * dn - 1) * barAmt
        depthR = 1 + (0.7 + 0.5 * dn - 1) * barAmt
      }
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
      const r = pointR[i] * (1 + glow * 0.7) * depthR
      cctx.globalAlpha = (fromA[i] + (ta[i] - fromA[i]) * lp) * depthA
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
    // Leaving the flow tab: bake the current circulation so it doesn't snap back.
    const cosF = flowActive ? Math.cos(flowAngle) : 1
    const sinF = flowActive ? Math.sin(flowAngle) : 0
    for (let i = 0; i < N; i++) {
      const lp = waveLP(i, t)
      let sx = fromX[i] + (tx[i] - fromX[i]) * lp
      let sy = fromY[i] + (ty[i] - fromY[i]) * lp
      if (flowActive) {
        const nx = sx / flowAX
        const ny = sy / flowAY
        sx = (nx * cosF - ny * sinF) * flowAX
        sy = (nx * sinF + ny * cosF) * flowAY
      }
      fromX[i] = sx
      fromY[i] = sy
      fromA[i] = fromA[i] + (ta[i] - fromA[i]) * lp
    }
    barFrom = curState === barIndex // ease the bar rotation OUT as we leave it
    barTo = next === barIndex // ease it IN as we arrive
    toState = states[next]
    // Morph the scale from the current state's fit to the next one's (interpolated in
    // drawCloud), so the shape grows/shrinks to its own size as it changes.
    scaleFrom = cscale
    curState = next
    cscale = stateScale[next] || cscale
    coverX = cscale ? (cssW * 0.5) / cscale : 1
    coverY = cscale ? (cssH * 0.5) / cscale : 1
    computeWave(next)
    morph.t = 0
    morphing = true
    gsap.killTweensOf(morph)
    gsap.to(morph, {
      t: 1,
      duration: MORPH_DURATION,
      ease: MORPH_EASE,
      onComplete: () => {
        morphing = false
      },
    })
    ensureCloudLoop()
  }

  function runIntro(target) {
    introTarget = target
    toState = states[target]
    setStateScale(target) // intro draws at the target state's own scale
    computeWave(target)
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
    // Re-measure on ANY wrapper size change (not just width) so the canvas buffer
    // keeps the stage's aspect — otherwise it stretches and the circle reads as an oval.
    if (window.ResizeObserver) {
      new window.ResizeObserver(() => cloudResize()).observe(visualsWrap)
    }

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

    // The oval PNG has tags baked in → swap a clean procedural ring for the flow state.
    if (OVAL_PROCEDURAL && flowIndex >= 0)
      raw[flowIndex] = proceduralRing(N, mulberry32(1000 + flowIndex))

    // Per-state fit: normalize EACH state to its own max half-extent (longer axis → 1),
    // centered on its own bbox, and record its normalized half-extents.
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

    const barExtY = barIndex >= 0 ? stateExtY[barIndex] || 1 : 1
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
      driftFreq[i] = 1 + (frng() - 0.5) * 2 * DRIFT_FREQ_VAR
      waveJit[i] = frng()
      mRand[i] = frng()
      // bar rotation radius = the point's normalized cross position within the bar
      const bc = barIndex >= 0 ? states[barIndex].y[i] / barExtY : 0
      barCross[i] = bc < -1 ? -1 : bc > 1 ? 1 : bc
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
    updateFlowTab(index) // start flow + overlay if we booted onto the flow tab
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

  // Canvas mode only. On the flow tab the dots circulate along the oval and the overlay
  // tags fade in (slower, each at its own speed). Off it, flow stops + overlay fades out.
  function updateFlowTab(i) {
    if (!cloudOk) return
    const wasFlow = flowActive
    flowActive = i === flowIndex
    if (flowActive && !wasFlow) flowAngle = 0 // start the loop fresh → no spin during the morph
    if (!overlayItems.length) return
    gsap.killTweensOf(overlayItems)
    if (flowActive) {
      // each tag fades at its OWN speed (desfasado) + staggered start
      overlayItems.forEach((el, k) =>
        gsap.to(el, {
          autoAlpha: 1,
          duration: TAG_FADE * (0.7 + k * 0.45),
          ease: 'power2.out',
          delay: 0.5 + k * TAG_STAGGER,
        })
      )
    } else {
      gsap.to(overlayItems, { autoAlpha: 0, duration: 0.3, ease: 'sine.out' })
    }
  }

  // ===================== Paradigm chrome (underline + text + autoplay) =========
  let index = 0
  let started = false
  let progressTl = null
  let onScreen = false
  let hover = false
  let docVisible = !document.hidden

  const shouldPlay = () => started && onScreen && !hover && docVisible
  const sync = () => {
    if (!progressTl) return
    shouldPlay() ? progressTl.play() : progressTl.pause()
  }

  const activate = (i) => {
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

    // Visuals: point-cloud morph if the cloud is live (or still sampling), else image
    // crossfade. cloudGo runs BEFORE updateFlowTab so the morph snapshot reads the
    // OUTGOING tab's flow flag (bakes its circulation, no jump).
    if (cloudEnabled && !cloudFailed) {
      cloudGo(i)
      updateFlowTab(i)
    } else {
      crossfadeVisuals(i)
    }
  }

  // Every non-active number's fill stays empty (inactive).
  const setStaticFills = (i) => {
    bars.forEach((bar, k) => {
      if (k === i) return
      gsap.set(bar, { scaleX: 0, transformOrigin: 'left center' })
    })
  }

  // Underline = autoplay progress, active-only: only the active number's fill grows
  // 0→1 over its text-scaled dwell; the others stay empty. Advances on complete.
  const runProgress = () => {
    progressTl && progressTl.kill()
    setStaticFills(index)
    progressTl = gsap.timeline({ onComplete: () => goTo((index + 1) % count) })
    const bar = bars[index]
    gsap.set(bar, { scaleX: 0, transformOrigin: 'left center' })
    progressTl.to(
      bar,
      {
        scaleX: 1,
        duration: autoplayDuration(messages[index]),
        ease: 'none',
      },
      0
    )
    sync()
  }

  // Collapse the messages column onto the active tab, so a short tab doesn't drag the
  // longest tab's leftover height around with it. Measured off the DOM (the CSS
  // `align-items: start` keeps each stacked title at its own content height, so a stretched
  // grid item can't report the row height back) rather than counting lines — line-height
  // math is unreliable in rich text (mixed sizes, margins, wrapped inline markup).
  // `immediate` skips the tween on load and on resize, where there is no switch to ride.
  const fitMessages = (i, immediate) => {
    if (!messagesWrap) return
    const h = titles[i].offsetHeight
    if (immediate) gsap.set(messagesWrap, { height: h })
    else gsap.to(messagesWrap, { height: h, ...FIT_TWEEN })
  }

  fitMessages(0, true) // no collapse animation on load
  // Webfonts land after init and reflow the copy — re-measure once they're in.
  document.fonts?.ready.then(() => fitMessages(index, true))

  function goTo(i) {
    index = i
    activate(i)
    fitMessages(i)
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

  // Clicking a number in the menu jumps to that tab.
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
    {
      // threshold stays 0 + a negative rootMargin: intersectionRatio is capped at
      // viewportHeight/elementHeight, so a section taller than ~2.5x the viewport
      // (routine on mobile) never reaches a 0.4 threshold and this never fires.
      threshold: 0,
      rootMargin: '-25% 0px -25% 0px',
    }
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
      // Column width drives how the copy wraps, so the active tab's height changes with it.
      fitMessages(index, true)
    },
  }
}

// Static fallback (no GSAP / reduced motion): show the first tab only via classes.
function staticFallback(root) {
  const first = (sel) => root.querySelector(sel)
  first('[data-compunding="tab-title"]')?.classList.add('is-active')
  first('[data-paradigm="tab-link"]')?.classList.add('is-active')
  first('[data-paradigm-visual]')?.classList.add('is-active')
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
