/*
  Component: compouding · data-component="compouding"
  Paradigm chrome (per-number underline + per-word de-blur + autoplay) with a PROCEDURAL
  point cloud for the visuals: one parametric shape per tab (loop / lattice / flow /
  spiral), each with its own perpetual motion, morphing along the incoming shape's own
  curve on every switch. No PNG sampling — the source <img>s are the static fallback only.
  CSS → ./styles/compouding.css (bundled via src/styles.js) · Docs → .claude/rules/components/compouding.md
*/

import { REVEAL_FROM, REVEAL_TO, splitElement } from '../utils/word-reveal.js'
import {
  SHAPE_ORDER,
  TUNING,
  makeShape,
  mulberry32,
} from '../utils/point-shapes.js'

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

// ---- Point cloud (procedural, evaluated per frame) ----
const SHAPE_ATTR = 'data-compouding-shape' // loop | lattice | flow | spiral
// Grain over weight: the reference graphics are MANY small light dots, not few heavy ones.
// Halving the dot radius and doubling the count is what makes a shape read as fine grain.
const TARGET_POINTS = 16000 // points per state — same for all, for a 1:1 morph
const POINTS_MOBILE = 9000 // fewer points below 768px (evaluating 4 shapes per frame)
const MOBILE_Q = '(max-width: 767px)'
const DOT_COLOR = '138,142,149' // light slate grey (tuned for a light bg)
// Sprite: alpha stays full out to this fraction of the radius, then falls off. Higher =
// crisper dots (a fully soft dot smears any shape made of lines into fog).
const DOT_HARD = 0.6
const FIT = 0.8 // per-state: fraction of the stage each shape fills on its limiting axis
// px kept clear on every side. The shimmer, breathing and hover push points OUTSIDE the
// fitted box (~12% of the scale), so without this the cloud reaches the stage edge and
// reads as touching whatever sits above the wrapper.
const STAGE_PAD = 32
// Varied dot sizes: mostly fine dots, a fraction a bit bigger (keep them slim).
const BIG_DOT_CHANCE = 0.12
const SMALL_R = [0.3, 0.62]
const BIG_R = [0.75, 1.3]
// Morph (the transition): per-point staggered "wave" ordered by the TARGET shape's own
// parametrization (see point-shapes.js `order`) — so each state builds along its curve.
const MORPH_DURATION = 3.5
const MORPH_EASE = 'power1.inOut'
const MORPH_SPREAD = 0.55 // how far the per-point START is staggered along the order
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
// Flow tab: gold endpoint nodes drawn on canvas + the two HTML endpoint labels.
const ENDPOINT_ATTR = 'data-compouding-endpoint' // start | end
const START_ATTR = 'data-compouding-startpoint' // accepted alias for the start label
const UNIT_SHIM = [1, 1] // fallback shimmer anisotropy
const ALPHA_SKIP = 0.015 // below this a dot is invisible — skip the draw, not the physics
const NODE_CORE_R = 4.5 // px
const NODE_GLOW_R = 15 // px (halo)
const NODE_PULSE = 1.5 // rad/s
const LABEL_GAP = 16 // px between a lens tip and its label
const LABEL_FADE = 0.75
const LABEL_STAGGER = 0.16
// The nodes + labels belong to the lens, so they must not show while the cloud is still the
// previous shape — they'd sit on top of it. Windows of the morph progress: in late, out early.
const NODE_IN = 0.55
const NODE_OUT = 0.3
const LABEL_IN = 0.6 // fraction of the morph waited before the labels fade in
// Intro (float in → assemble): gentle so the load assembly never lurches.
const INTRO_SCATTER = 0.6
const INTRO_FADE = 0.6
const INTRO_HOLD = 0.8
const INTRO_DURATION = 2.4
const INTRO_STAGGER = 0.7

const desktopHover = window.matchMedia(`(min-width: ${HOVER_MIN_WIDTH}px)`)

// Outgoing tab: plain fade. The de-blur lives on the words, never the parent.
const REVEAL_OUT = { autoAlpha: 0, duration: OUT_FADE }

// The endpoint labels are authored in Webflow, where the attribute VALUE is the easiest
// thing to get wrong (a city name instead of start/end). So: accept start|end in any case,
// accept the -startpoint alias, and fall back to DOM order for whatever is left — then
// rewrite the canonical value, since the CSS and positionEndpoints() key off it.
function resolveEndpoints(root, visualsWrap) {
  if (!visualsWrap) return []
  const found = gsap.utils.toArray(
    root.querySelectorAll(`[${ENDPOINT_ATTR}], [${START_ATTR}]`)
  )
  const sides = found.map((el) => {
    if (el.hasAttribute(START_ATTR)) return 'start'
    const v = (el.getAttribute(ENDPOINT_ATTR) || '').trim().toLowerCase()
    if (v === 'start' || v === 'from') return 'start'
    if (v === 'end' || v === 'to') return 'end'
    return null
  })
  found.forEach((el, i) => {
    if (!sides[i]) sides[i] = sides.includes('start') ? 'end' : 'start'
  })
  if (found.length > 2)
    console.warn(
      `[compouding] ${found.length} endpoint labels — only the first start + end are used`
    )
  // start first, so the fade-in stagger always runs origin → destination.
  const out = []
  ;['start', 'end'].forEach((side) => {
    const el = found[sides.indexOf(side)]
    if (!el) return
    el.setAttribute(ENDPOINT_ATTR, side)
    el.removeAttribute(START_ATTR)
    if (el.parentElement !== visualsWrap) visualsWrap.appendChild(el)
    out.push(el)
  })
  return out
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
  // Tabs are paired by index, so a leftover element (e.g. a number whose text + visual were
  // deleted in Webflow) is inert — warn, since it renders as a dead number in the menu.
  if (
    titles.length !== count ||
    links.length !== count ||
    visuals.length !== count
  ) {
    console.warn(
      `[compouding] tab counts disagree (titles ${titles.length}, links ${links.length}, visuals ${visuals.length}) — cycling the first ${count}; remove the extras in Webflow`
    )
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
  const cloudEnabled = !!visualsWrap
  // Which procedural shape each tab shows. Falls back to SHAPE_ORDER by index.
  const shapeKinds = visuals.slice(0, count).map((v, i) => {
    const raw = (v.getAttribute(SHAPE_ATTR) || '').trim()
    if (SHAPE_ORDER.includes(raw)) return raw
    const fallback = SHAPE_ORDER[i % SHAPE_ORDER.length]
    console.warn(
      `[compouding] visual ${i}: ${
        raw ? `unknown ${SHAPE_ATTR}="${raw}"` : `no ${SHAPE_ATTR}`
      } — using "${fallback}"`
    )
    return fallback
  })
  const flowIndex = shapeKinds.indexOf('flow')

  // Flow endpoint labels (São Paulo / Texas): real text in the DOM. Moved onto the visual
  // wrapper so JS can anchor them to the lens tips (and so .is-canvas can't hide them
  // along with the source visuals).
  const endpoints = resolveEndpoints(root, visualsWrap)
  if (endpoints.length) gsap.set(endpoints, { autoAlpha: 0 })

  let cloudOk = false // procedural cloud is live → canvas drives the visuals
  let canvas = null
  let cctx = null
  let sprite = null
  let nodeSprite = null
  const N = window.matchMedia(MOBILE_Q).matches ? POINTS_MOBILE : TARGET_POINTS
  let states = null
  const sbuf = new Float32Array(4) // shared sample output — no per-point allocation
  const fbuf = new Float32Array(4) // ditto, for the outgoing shape during a morph
  // Per-point residual at the instant of a switch: painted frame − the outgoing shape's LIVE
  // position. It decays as the point migrates, which is what lets the morph start
  // frame-exact without freezing the outgoing shape (see morphTo).
  const resX = new Float32Array(N)
  const resY = new Float32Array(N)
  const resA = new Float32Array(N)
  // Positions of the last painted frame — what the residual above is measured against.
  const curX = new Float32Array(N)
  const curY = new Float32Array(N)
  const curA = new Float32Array(N)
  let toState = null
  let fromState = null // the outgoing shape, sampled LIVE while a morph runs
  const morph = { t: 1 }
  let cloudReady = false
  let introduced = false
  let introActive = false
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
  const mProj = new Float32Array(N) // per-point morph order (0..1, from the target shape)
  const waveJit = new Float32Array(N) // per-point random blended into the wave delay
  const mRand = new Float32Array(N) // per-point random → morph speed variance
  const introProg = { v: 0 }
  const introFade = { v: 0 }
  let hovActive = false
  let mx = 0
  let my = 0
  let flowFrom = false // flow is the morph's source → fade its nodes OUT
  let flowTo = false // flow is the morph's target → fade them IN
  let cssW = 0
  let cssH = 0
  let cscale = 0 // resting scale of the current state (per-state fit)
  let scaleFrom = 0 // scale at the start of the current morph (interpolated to cscale)
  let curState = 0 // index of the current cloud state
  let coverX = 1
  let coverY = 1
  let cdpr = 1
  const stateScale = [] // per-state fit scale (min of width/height fit × FIT)

  function makeSprite() {
    const s = document.createElement('canvas')
    s.width = s.height = 16
    const c = s.getContext('2d')
    const g = c.createRadialGradient(8, 8, 0, 8, 8, 8)
    g.addColorStop(0, `rgba(${DOT_COLOR},1)`)
    g.addColorStop(DOT_HARD, `rgba(${DOT_COLOR},1)`)
    g.addColorStop(1, `rgba(${DOT_COLOR},0)`)
    c.fillStyle = g
    c.beginPath()
    c.arc(8, 8, 8, 0, Math.PI * 2)
    c.fill()
    return s
  }

  // Gold endpoint node: hot-white core inside a warm halo (same language as impact-map).
  function makeNodeSprite() {
    const s = document.createElement('canvas')
    s.width = s.height = 64
    const c = s.getContext('2d')
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.18, 'rgba(255,236,190,1)')
    g.addColorStop(0.42, 'rgba(230,168,74,0.55)')
    g.addColorStop(1, 'rgba(230,168,74,0)')
    c.fillStyle = g
    c.beginPath()
    c.arc(32, 32, 32, 0, Math.PI * 2)
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
    if (!visualsWrap || !canvas) return
    const w = visualsWrap.clientWidth
    const h = visualsWrap.clientHeight
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    // Assigning canvas.width re-allocates (and clears) the whole backing store, so only do
    // it when the stage really changed — the ResizeObserver fires on no-op layouts too.
    if (w !== cssW || h !== cssH || dpr !== cdpr) {
      cssW = w
      cssH = h
      cdpr = dpr
      canvas.width = cssW * cdpr
      canvas.height = cssH * cdpr
      cctx.setTransform(cdpr, 0, 0, cdpr, 0, 0)
    }
    // The flow state fits into the stage MINUS its endpoint labels + node halos, so the
    // labels can never be pushed off the stage (or over the section copy).
    const res = endpointReserve()
    for (let i = 0; i < states.length; i++) {
      const rx = i === flowIndex ? res.x : 0
      const ry = i === flowIndex ? res.y : 0
      const halfW = Math.max(cssW * 0.5 - rx - STAGE_PAD, cssW * 0.25)
      const halfH = Math.max(cssH * 0.5 - ry - STAGE_PAD, cssH * 0.25)
      stateScale[i] =
        Math.min(halfW / states[i].extX, halfH / states[i].extY) *
        FIT *
        (TUNING[states[i].kind]?.fill ?? 1) // per-shape stage fill
    }
    cscale = stateScale[curState] || cssW * 0.5 * FIT
    scaleFrom = cscale
    coverX = cscale ? (cssW * 0.5) / cscale : 1
    coverY = cscale ? (cssH * 0.5) / cscale : 1
    positionEndpoints()
    if (cloudReady) drawCloud()
  }

  // Room the flow tab needs outside the lens: the widest label + the gap + the node halo.
  function endpointReserve() {
    let x = 0
    endpoints.forEach((el) => {
      x = Math.max(x, el.offsetWidth + LABEL_GAP + NODE_GLOW_R)
    })
    return { x, y: endpoints.length ? NODE_GLOW_R : 0 }
  }

  // Anchor each label just outside its lens tip. `start` sits left of it, `end` right of it
  // (the CSS translates them off their anchor point accordingly). The gap is measured from
  // the OUTER EDGE OF THE NODE HALO, not the tip: the halo reaches NODE_GLOW_R past the tip,
  // so a gap measured from the tip alone puts the text right on top of the glow.
  function positionEndpoints() {
    if (flowIndex < 0 || !endpoints.length || !states) return
    const sc = stateScale[flowIndex] || cscale
    const off = states[flowIndex].extX * sc + NODE_GLOW_R + LABEL_GAP
    const cx = cssW / 2
    const cy = cssH / 2
    endpoints.forEach((el) => {
      const isEnd = el.getAttribute(ENDPOINT_ATTR) === 'end'
      el.style.left = (isEnd ? cx + off : cx - off) + 'px'
      el.style.top = cy + 'px'
    })
  }

  // Per-point local morph progress at global t: staggered START (target order ⊕ randomness)
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

  // Smoothstep window — 0 below a, 1 above b.
  function win(x, a, b) {
    let p = (x - a) / (b - a)
    p = p < 0 ? 0 : p > 1 ? 1 : p
    return p * p * (3 - 2 * p)
  }

  // Gold nodes at the lens tips — only on the flow tab. They fade in LATE and out EARLY
  // (NODE_IN / NODE_OUT) so they never sit on a cloud that isn't the lens yet.
  function drawNodes(now, t) {
    if (flowIndex < 0) return
    const amt = flowTo
      ? win(t, NODE_IN, 1)
      : flowFrom
        ? 1 - win(t, 0, NODE_OUT)
        : 0
    if (amt < 0.002) return
    // Pinned to the LENS's own scale, not the interpolated one: the endpoint labels are
    // positioned at that scale, so anything else drifts the node off its label mid-morph.
    const hw = states[flowIndex].extX * (stateScale[flowIndex] || cscale)
    const cy = cssH / 2
    const cx = cssW / 2
    const pulse = 0.86 + 0.14 * Math.sin(now * NODE_PULSE)
    const glow = NODE_GLOW_R * (0.9 + 0.1 * pulse)
    cctx.globalAlpha = amt * pulse
    for (let k = 0; k < 2; k++) {
      const sx = k ? cx + hw : cx - hw
      cctx.drawImage(nodeSprite, sx - glow, cy - glow, glow * 2, glow * 2)
      cctx.drawImage(
        nodeSprite,
        sx - NODE_CORE_R,
        cy - NODE_CORE_R,
        NODE_CORE_R * 2,
        NODE_CORE_R * 2
      )
    }
    cctx.globalAlpha = 1
  }

  function drawCloud() {
    cctx.clearRect(0, 0, cssW, cssH)
    if (!cloudReady) return
    const cx = cssW / 2
    const cy = cssH / 2
    const now = window.performance.now() * 0.001
    // Intro / morph / idle share ONE loop on purpose: anything a phase doesn't share becomes
    // a snap when the phase flips (the shimmer anisotropy and the breathing used to appear
    // out of nowhere the instant the intro ended).
    const t = introActive ? 1 : morph.t
    const morphing = !introActive && t < 1
    const rscale = introActive ? cscale : scaleFrom + (cscale - scaleFrom) * t // interpolated per-state scale
    const R2 = HOVER_RADIUS * HOVER_RADIUS
    // Per-shape, per-axis shimmer: on the line-based shapes it runs ALONG the line, so it
    // can't smear two streamlines into one another. Interpolated across a morph so neither
    // shape's grain snaps in. Read once per frame, not per point.
    const shTo = TUNING[toState.kind]?.shim || UNIT_SHIM
    const shFrom = morphing ? TUNING[fromState.kind]?.shim || UNIT_SHIM : shTo
    // Interpolated PER POINT below (by its own migration progress, not the global t): a point
    // that already reached the lens has to shimmer along the lens, or the arrived lines read
    // smeared while the rest of the cloud is still in transit.
    const driftAmpX = SHIMMER_FLOOR * DRIFT * shFrom[0]
    const driftAmpY = SHIMMER_FLOOR * DRIFT * shFrom[1]
    const driftDX = SHIMMER_FLOOR * DRIFT * (shTo[0] - shFrom[0])
    const driftDY = SHIMMER_FLOOR * DRIFT * (shTo[1] - shFrom[1])
    // Radial breathing is per shape (`pulse`): flow keeps it at 0 because its lens is pinned
    // to two labelled endpoints, and a pulse there reads as the cities drifting.
    const puTo = BREATH_AMP * (TUNING[toState.kind]?.pulse ?? 1)
    const puFrom = morphing
      ? BREATH_AMP * (TUNING[fromState.kind]?.pulse ?? 1)
      : puTo
    const puDelta = puTo - puFrom
    const fade = introActive ? introFade.v : 1
    const ispan = 1 + INTRO_STAGGER
    const icovX = coverX * INTRO_SCATTER
    const icovY = coverY * INTRO_SCATTER

    for (let i = 0; i < N; i++) {
      // The target is evaluated LIVE, so the incoming shape is already in motion while it
      // assembles — nothing jumps when the morph lands.
      toState.sample(i, now, sbuf)
      let bx = sbuf[0]
      let by = sbuf[1]
      let al = sbuf[2]
      let rm = sbuf[3]
      let amp = 1 // shimmer multiplier — wider while the intro cloud is still dispersed
      let lpv = 1 // this point's migration progress (1 = fully on the target shape)
      if (introActive) {
        let pp = introProg.v * ispan - introDelay[i]
        pp = pp < 0 ? 0 : pp > 1 ? 1 : pp
        pp = pp * pp * (3 - 2 * pp)
        const dx = startX[i] * icovX
        const dy = startY[i] * icovY
        bx = dx + (bx - dx) * pp
        by = dy + (by - dy) * pp
        amp = 1 + (1 / SHIMMER_FLOOR - 1) * (1 - pp)
      } else if (morphing) {
        const lp = waveLP(i, t)
        lpv = lp
        // The OUTGOING shape is sampled live too. Baking it as a frozen snapshot left every
        // point that hadn't started its migration standing still — up to MORPH_SPREAD of the
        // duration — which read as the section pausing on every switch. The residual keeps
        // the hand-off frame-exact even when a switch interrupts another morph.
        fromState.sample(i, now, fbuf)
        const k = 1 - lp
        const fx = fbuf[0] + resX[i] * k
        const fy = fbuf[1] + resY[i] * k
        const fa = fbuf[2] + resA[i] * k
        bx = fx + (bx - fx) * lp
        by = fy + (by - fy) * lp
        al = fa + (al - fa) * lp
        rm = fbuf[3] + (rm - fbuf[3]) * lp
      }
      curX[i] = bx
      curY[i] = by
      curA[i] = al
      const ph = now * DRIFT_SPEED * driftFreq[i] + driftPhase[i]
      bx += Math.cos(ph) * dispX[i] * (driftAmpX + driftDX * lpv) * amp
      by += Math.sin(ph) * dispY[i] * (driftAmpY + driftDY * lpv) * amp
      const pu = puFrom + puDelta * lpv
      if (pu !== 0) {
        const dd = Math.sqrt(bx * bx + by * by)
        const breath =
          1 + Math.sin(now * BREATH_SPEED - dd * BREATH_RIPPLE) * pu
        bx *= breath
        by *= breath
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
      al *= fade
      if (al < ALPHA_SKIP) continue // invisible: the draw is the expensive half of the frame
      const sx = cx + (bx + offX[i]) * rscale
      const sy = cy + (by + offY[i]) * rscale
      const r = pointR[i] * rm * (1 + glow * 0.7)
      cctx.globalAlpha = al > 1 ? 1 : al
      cctx.drawImage(sprite, sx - r, sy - r, r * 2, r * 2)
    }
    cctx.globalAlpha = 1
    drawNodes(now, t)
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
    // A switch during the intro cuts it short: cur* already holds the frame on screen, so
    // the morph picks up from there (letting the intro finish would reset toState).
    if (introActive) {
      gsap.killTweensOf([introProg, introFade])
      introActive = false
      introFade.v = 1
    }
    // Keep the outgoing shape LIVE as the morph's origin and store only the difference from
    // the frame on screen. That way leaving a moving state neither rewinds (the residual is
    // frame-exact) nor freezes (the shape keeps flowing under the migration).
    const now = window.performance.now() * 0.001
    fromState = toState
    for (let i = 0; i < N; i++) {
      fromState.sample(i, now, fbuf)
      resX[i] = curX[i] - fbuf[0]
      resY[i] = curY[i] - fbuf[1]
      resA[i] = curA[i] - fbuf[2]
    }
    scaleFrom = scaleFrom + (cscale - scaleFrom) * morph.t
    flowFrom = curState === flowIndex
    flowTo = next === flowIndex
    toState = states[next]
    curState = next
    // Morph the scale from the current state's fit to the next one's (interpolated in
    // drawCloud), so the shape grows/shrinks to its own size as it changes.
    cscale = stateScale[next] || cscale
    coverX = cscale ? (cssW * 0.5) / cscale : 1
    coverY = cscale ? (cssH * 0.5) / cscale : 1
    mProj.set(states[next].order) // the target's own parametric order drives the sweep
    morph.t = 0
    gsap.killTweensOf(morph)
    gsap.to(morph, { t: 1, duration: MORPH_DURATION, ease: MORPH_EASE })
    ensureCloudLoop()
  }

  function runIntro(target) {
    toState = states[target]
    fromState = states[target]
    setStateScale(target) // intro draws at the target state's own scale
    mProj.set(states[target].order)
    flowTo = target === flowIndex
    flowFrom = false
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
    toState = states[target]
    setStateScale(target)
    morph.t = 1 // lp = 1 everywhere → the next frame bakes the shape into cur*
    drawCloud()
  }

  // Tell the cloud which tab is active. The first call plays the intro converging onto
  // that state, subsequent calls morph.
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

  function bootCloud() {
    canvas = document.createElement('canvas')
    canvas.className = 'tabs-compouding_pointcloud'
    canvas.setAttribute('aria-hidden', 'true')
    visualsWrap.appendChild(canvas)
    cctx = canvas.getContext('2d')
    sprite = makeSprite()
    nodeSprite = makeNodeSprite()

    states = shapeKinds.map((kind, i) =>
      makeShape(kind, N, mulberry32(1000 + i))
    )
    toState = states[0]
    morph.t = 1
    mProj.set(states[0].order)

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
      pointR[i] =
        frng() < BIG_DOT_CHANCE
          ? BIG_R[0] + frng() * (BIG_R[1] - BIG_R[0])
          : SMALL_R[0] + frng() * (SMALL_R[1] - SMALL_R[0])
    }

    // .is-canvas BEFORE the first measure: it makes the endpoint labels absolute, and
    // cloudResize() reserves room for them from their offsetWidth — measured in normal flow
    // a label reports the whole stage width, so the flow lens got fitted into a quarter of
    // the stage and then jumped to its real size on the first resize.
    root.classList.add('is-canvas') // CSS hides the source imgs, shows the canvas
    cloudResize()
    // Re-measure on ANY wrapper size change (not just width) so the canvas buffer
    // keeps the stage's aspect — otherwise it stretches and the shapes skew.
    if (window.ResizeObserver) {
      new window.ResizeObserver(() => cloudResize()).observe(visualsWrap)
    }

    fromState = states[0]
    for (let i = 0; i < N; i++) {
      states[0].sample(i, 0, sbuf)
      curX[i] = sbuf[0]
      curY[i] = sbuf[1]
      curA[i] = sbuf[2]
    }

    cloudOk = true
    cloudReady = true
    if (pendingGo != null) cloudGo(pendingGo)
    else if (onScreen) cloudGo(index)
    updateFlowLabels(index) // show the labels if we booted onto the flow tab
  }

  // Crossfade fallback (no visual wrapper → no canvas): the original paradigm behaviour.
  function crossfadeVisuals(i) {
    visuals.forEach((v, k) =>
      gsap.to(v, {
        autoAlpha: k === i ? 1 : 0,
        duration: 0.6,
        ease: 'sine.out',
      })
    )
  }

  // Endpoint labels fade in only on the flow tab, each at its own speed (staggered) — and
  // only once the cloud has become the lens (they're anchored to its tips, so showing them
  // earlier parks them on whatever shape is still morphing away).
  function updateFlowLabels(i) {
    if (!cloudOk || flowIndex < 0 || !endpoints.length) return
    gsap.killTweensOf(endpoints)
    if (i === flowIndex) {
      positionEndpoints()
      const wait = introActive
        ? INTRO_HOLD + INTRO_DURATION * 0.8
        : MORPH_DURATION * LABEL_IN
      endpoints.forEach((el, k) =>
        gsap.to(el, {
          autoAlpha: 1,
          duration: LABEL_FADE * (0.85 + k * 0.35),
          ease: 'power2.out',
          delay: wait + k * LABEL_STAGGER,
        })
      )
    } else {
      gsap.to(endpoints, { autoAlpha: 0, duration: 0.3, ease: 'sine.out' })
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

    // Visuals: point-cloud morph when the canvas is live, else image crossfade.
    if (cloudEnabled) {
      cloudGo(i)
      updateFlowLabels(i)
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

  // The messages column keeps its natural height (the tallest tab). It used to be tweened
  // down to the active tab on every switch; the extra whitespace on the short tabs is
  // accepted, and a stable column means no per-switch reflow of the section.
  function goTo(i) {
    index = i
    activate(i)
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

  // Clicking a number in the menu jumps to that tab. Clamped to `count` — a number with no
  // paired title/visual stays unwired instead of switching to a tab that doesn't exist.
  links
    .slice(0, count)
    .forEach((l, i) => wireButton(l, () => select(i), 'Go to slide ' + (i + 1)))

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
