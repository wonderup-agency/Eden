/*
Component: tabs-stats
Webflow attribute: data-component="tabs-stats"

Stats tabs with a PNG-sampled 2D point-cloud graphic that morphs between states.
Each stat link is a tab; the matching tab-item image is sampled into ~7k points
and the cloud lerps (position + alpha) from one state to the next on switch. On
first scroll into view the points start as a soft cloud dispersed across the
stage, float for ~1s, then converge into the first state (intro). A residual
shimmer keeps the cloud gently drifting even when assembled and idle (Stripe-like,
never frozen). Hovering the stage loosens nearby points like a nebula — desktop
only (disabled on tablet/below). The active link's underline fills left→right as
an autoplay progress bar; when full it advances to the next tab.

Ported from playground/diagnostic-tabs-pointcloud.html. Canvas 2D only — no 3D
library. GSAP is expected as a global (loaded site-wide in Webflow); the cloud is
static between morphs so rAF only runs while something is moving.

Fallbacks: if GSAP is missing, prefers-reduced-motion is set, or the source
images can't be sampled (CORS-tainted canvas), the component shows the active
tab-item image statically and just toggles tabs on click/keyboard.

The CSS is NOT bundled here — it lives in Webflow's global head custom code.
The source of truth is ./styles/tabs-stats.css (copy/paste it into Webflow).
*/

const { gsap } = window

const ACTIVE_CLASS = 'is-active'
const AUTOPLAY_DURATION = 5 // seconds the underline takes to fill before advancing

// ---- Point cloud (tuned defaults from the playground) ----
const TARGET_POINTS = 7000 // points per state — same for all, for a 1:1 morph
const SAMPLE_MAX = 560 // longest edge the source PNG is sampled at
const ALPHA_MIN = 28 // min source alpha to count a pixel as "ink"
const LUMA_MAX = 245 // for opaque PNGs: count pixels darker than this
const MORPH_DURATION = 1.25
const MORPH_EASE = 'power2.inOut'
const DOT_COLOR = '125,130,140' // #7d828c
const FIT = 0.82 // fraction of the available half-stage the cloud fills (1 = touches the edges)
const DOT_RADIUS = 1.4
// Hover nebula (desktop only — disabled on tablet/below, where it reads as jitter)
const HOVER_RADIUS = 0.4
const HOVER_PUSH = 0.03
const HOVER_SWIRL = 0.06
const HOVER_EASE = 0.11
const HOVER_SCATTER = 0.18
const HOVER_MIN_WIDTH = 992 // px — hover nebula only at/above this (Webflow desktop base)
// Ambient drift — a residual shimmer that NEVER fully stops, so the cloud keeps
// breathing even when assembled and idle (Stripe-like). Same model as scroll-morph.
const DRIFT = 0.2 // drift amplitude while dispersed (normalized units)
const DRIFT_SPEED = 0.85 // drift speed
const SHIMMER_FLOOR = 0.4 // fraction of DRIFT kept once assembled (never frozen)
// Coherent breathing of the assembled cloud — a slow radial pulse rippling out
// from the cloud center, the same "living" quality as scroll-morph's ring. Kept
// small so the sampled graphic stays legible while it breathes.
const BREATH_AMP = 0.03 // radial pulse amplitude (fraction of each point's distance from center)
const BREATH_SPEED = 0.9 // pulse speed (rad/s)
const BREATH_RIPPLE = 2.2 // spatial frequency — >0 ripples outward instead of pulsing uniformly
// Intro (float in → assemble): points appear as a soft cloud dispersed across the
// stage, drift gently, then converge into the first state (staggered).
const INTRO_SCATTER = 1.0 // dispersed coverage (1 = fills the stage, like scroll-morph)
const INTRO_FADE = 0.5 // fade-in (s)
const INTRO_HOLD = 1.0 // float in place ~1s before converging (s)
const INTRO_DURATION = 1.6 // convergence (s)
const INTRO_STAGGER = 0.5 // spread of per-point convergence start (organic)

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
// Hover nebula is desktop-only — on tablet/below the cursor-driven scatter reads
// as random jitter, so it's gated behind this query (reactive, no re-binding).
const desktopHover = window.matchMedia(`(min-width: ${HOVER_MIN_WIDTH}px)`)

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

// Static fallback (no GSAP / reduced motion / tainted assets): just toggle which
// tab-item image shows on click + keyboard. Underline state is handled by CSS.
function setupFallback(root, links, tabItems, count) {
  let active = -1
  const setActive = (i) => {
    if (i === active) return
    links.forEach((l, idx) => {
      const on = idx === i
      l.classList.toggle(ACTIVE_CLASS, on)
      l.setAttribute('aria-selected', on ? 'true' : 'false')
      l.setAttribute('tabindex', on ? '0' : '-1')
    })
    tabItems.forEach((p, idx) => p?.classList.toggle(ACTIVE_CLASS, idx === i))
    active = i
  }
  setActive(0)
  links.forEach((link, i) => link.addEventListener('click', () => setActive(i)))
  ;(links[0].parentElement || root).addEventListener('keydown', (e) => {
    let next = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown')
      next = (active + 1) % count
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = (active - 1 + count) % count
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = count - 1
    else return
    e.preventDefault()
    links[next].focus()
    setActive(next)
  })
}

// Wire one stats-tabs root. Returns { resize } or null if the markup is incomplete.
function setupTabs(root) {
  const links = Array.from(root.querySelectorAll('[tabs-architected="link"]'))
  const imgs = Array.from(
    root.querySelectorAll('[tabs-architected="image"] img')
  )
  const stage =
    root.querySelector('[tabs-architected="stage"]') ||
    root.querySelector('.tabs-stats_tabs-content')

  if (links.length < 2 || !stage) {
    console.warn('[tabs-stats] need >= 2 links and a stage — skipping')
    return null
  }

  const count = Math.min(links.length, imgs.length || links.length)
  const bars = links.map((link) =>
    link.querySelector('.tabs-architected_tab-link-underline')
  )
  const tabItems = imgs.map(
    (img) => img.closest('.tabs-stats_tab-item') || img.parentElement
  )

  // ARIA scaffolding — tablist / tab / tabpanel with roving tabindex.
  const tablist = links[0].parentElement || root
  tablist.setAttribute('role', 'tablist')
  const stageId = stage.id || 'tabs-stats-stage'
  stage.id = stageId
  stage.setAttribute('role', 'tabpanel')
  links.forEach((link, i) => {
    const linkId = link.id || `tabs-stats-tab-${i}`
    link.id = linkId
    link.setAttribute('role', 'tab')
    link.setAttribute('aria-controls', stageId)
    link.setAttribute('tabindex', '-1')
  })

  // No GSAP or reduced motion → static fallback, no canvas.
  if (!gsap || reduceMotion.matches) {
    setupFallback(root, links, tabItems, count)
    return null
  }

  // ---- Canvas + point-cloud engine ----
  const canvas = document.createElement('canvas')
  canvas.className = 'tabs-stats_pointcloud'
  canvas.setAttribute('aria-hidden', 'true')
  stage.appendChild(canvas)
  const ctx = canvas.getContext('2d')

  const N = TARGET_POINTS
  const sprite = makeSprite()

  // Per-point random directions for the hover scatter (stable across states).
  const dispX = new Float32Array(N)
  const dispY = new Float32Array(N)
  {
    const drng = mulberry32(99)
    for (let i = 0; i < N; i++) {
      const ang = drng() * Math.PI * 2
      const mg = drng()
      dispX[i] = Math.cos(ang) * mg
      dispY[i] = Math.sin(ang) * mg
    }
  }

  let cur = 0
  let states = null // [{x,y,a}] normalized + centered to a common scale
  const fromX = new Float32Array(N)
  const fromY = new Float32Array(N)
  const fromA = new Float32Array(N)
  let toState = null
  const morph = { t: 1 }
  let morphing = false
  let looping = false
  let ready = false
  let started = false // intro done + autoplay armed

  // Hover state (eased per-point offsets → laggy nebula motion)
  let hovActive = false
  const offX = new Float32Array(N)
  const offY = new Float32Array(N)
  let mx = 0
  let my = 0

  // Intro state
  let introActive = false
  const introProg = { v: 0 }
  const introFade = { v: 0 }
  const startX = new Float32Array(N) // initial scattered (floating) positions
  const startY = new Float32Array(N)
  const introDelay = new Float32Array(N)
  const driftPhase = new Float32Array(N) // per-point ambient float phase

  let cssW = 0
  let cssH = 0
  let scale = 0
  let coverX = 1 // stage half-width in normalized units (for the section-filling scatter)
  let coverY = 1 // stage half-height in normalized units
  let extX = 1 // largest normalized half-width across states (for auto-fit)
  let extY = 1 // largest normalized half-height across states
  let dpr = 1
  let inView = false
  let hovered = false
  let focused = false
  let progressTween = null

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

  function setActiveTab(i) {
    links.forEach((l, idx) => {
      const on = idx === i
      l.classList.toggle(ACTIVE_CLASS, on)
      l.setAttribute('aria-selected', on ? 'true' : 'false')
      l.setAttribute('tabindex', on ? '0' : '-1')
    })
    stage.setAttribute('aria-labelledby', links[i].id)
  }

  function resize() {
    cssW = stage.clientWidth
    cssH = stage.clientHeight
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = cssW * dpr
    canvas.height = cssH * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // Auto-fit: scale so the largest state fits the stage on both axes, with the
    // FIT margin. Guarantees the cloud never clips, whatever the stage's ratio is.
    scale = Math.min((cssW * 0.5) / extX, (cssH * 0.5) / extY) * FIT
    // Stage half-extent in normalized units, so the dispersed intro cloud fills it.
    coverX = scale ? (cssW * 0.5) / scale : 1
    coverY = scale ? (cssH * 0.5) / scale : 1
    if (ready) draw()
  }

  // Render one frame; ease each point toward its hover target. Returns true while
  // points are still in motion (so the loop keeps running).
  function draw() {
    ctx.clearRect(0, 0, cssW, cssH)
    if (!ready) return false
    const cx = cssW / 2
    const cy = cssH * 0.5

    // Intro: points appear scattered in a floating cloud, drift gently, then
    // converge into state 0 (staggered). The drift fades as each point locks in.
    if (introActive) {
      const s0 = states[0]
      const p = introProg.v
      const span = 1 + INTRO_STAGGER
      const r = DOT_RADIUS
      const now = window.performance.now() * 0.001
      const covX = coverX * INTRO_SCATTER
      const covY = coverY * INTRO_SCATTER
      for (let i = 0; i < N; i++) {
        let pp = p * span - introDelay[i]
        pp = pp < 0 ? 0 : pp > 1 ? 1 : pp
        pp = pp * pp * (3 - 2 * pp)
        // Drift fades from full (dispersed) to the residual shimmer (assembled),
        // matching the persistent drift below so the hand-off is seamless.
        const driftAmp =
          (SHIMMER_FLOOR + (1 - SHIMMER_FLOOR) * (1 - pp)) * DRIFT
        const fx =
          Math.cos(now * DRIFT_SPEED + driftPhase[i]) * dispX[i] * driftAmp
        const fy =
          Math.sin(now * DRIFT_SPEED + driftPhase[i]) * dispY[i] * driftAmp
        // Dispersed position fills the stage (scatter fraction × stage extent);
        // converge to state 0 as pp → 1.
        const dx = startX[i] * covX
        const dy = startY[i] * covY
        const bx = dx + (s0.x[i] - dx) * pp + fx
        const by = dy + (s0.y[i] - dy) * pp + fy
        ctx.globalAlpha = s0.a[i] * introFade.v
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

    const t = morph.t
    const tx = toState.x
    const ty = toState.y
    const ta = toState.a
    const baseR = DOT_RADIUS
    const R2 = HOVER_RADIUS * HOVER_RADIUS
    const now = window.performance.now() * 0.001
    const driftAmp = SHIMMER_FLOOR * DRIFT // residual shimmer — the cloud never freezes
    for (let i = 0; i < N; i++) {
      const fx =
        Math.cos(now * DRIFT_SPEED + driftPhase[i]) * dispX[i] * driftAmp
      const fy =
        Math.sin(now * DRIFT_SPEED + driftPhase[i]) * dispY[i] * driftAmp
      let bx = fromX[i] + (tx[i] - fromX[i]) * t + fx
      let by = fromY[i] + (ty[i] - fromY[i]) * t + fy
      // Coherent radial breathing (morph-section feel): a slow ripple out from
      // the cloud center (origin in normalized space) keeps the assembled shape
      // alive, not just shimmering. Scales each point toward/away from center.
      const dd = Math.sqrt(bx * bx + by * by)
      const breath =
        1 + Math.sin(now * BREATH_SPEED - dd * BREATH_RIPPLE) * BREATH_AMP
      bx *= breath
      by *= breath
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
      const sx = cx + (bx + offX[i]) * scale
      const sy = cy + (by + offY[i]) * scale
      const r = baseR * (1 + glow * 0.7)
      ctx.globalAlpha = fromA[i] + (ta[i] - fromA[i]) * t
      ctx.drawImage(sprite, sx - r, sy - r, r * 2, r * 2)
    }
    ctx.globalAlpha = 1
  }

  // The loop runs continuously while the section is on screen — the residual
  // shimmer means there's always something to draw. It stops when off-screen.
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

  function morphTo(next) {
    const t = morph.t
    const tx = toState.x
    const ty = toState.y
    const ta = toState.a
    for (let i = 0; i < N; i++) {
      fromX[i] = fromX[i] + (tx[i] - fromX[i]) * t // snapshot current position
      fromY[i] = fromY[i] + (ty[i] - fromY[i]) * t
      fromA[i] = fromA[i] + (ta[i] - fromA[i]) * t
    }
    toState = states[next]
    cur = next
    morph.t = 0
    morphing = true
    gsap.killTweensOf(morph)
    gsap.to(morph, {
      t: 1,
      duration: MORPH_DURATION,
      ease: MORPH_EASE,
      onComplete: () => {
        morphing = false
        if (started && !paused()) startProgress(cur)
      },
    })
    ensureLoop()
  }

  // Autoplay = the active link's underline fills over AUTOPLAY_DURATION, then
  // advances. Paused while hovered / focused / off-screen / mid-morph.
  const paused = () => hovered || focused || !inView
  function startProgress(index) {
    if (progressTween) progressTween.kill()
    const bar = bars[index]
    if (!bar) return
    gsap.set(bar, { scaleX: 0, transformOrigin: 'left center' })
    progressTween = gsap.to(bar, {
      scaleX: 1,
      duration: AUTOPLAY_DURATION,
      ease: 'none',
      onComplete: () => {
        if (!morphing && !paused()) select((cur + 1) % count)
      },
    })
  }
  function stopProgress() {
    if (progressTween) progressTween.pause()
  }
  function resumeProgress() {
    if (started && !morphing && !paused()) {
      if (progressTween && progressTween.progress() < 1) progressTween.resume()
      else startProgress(cur)
    }
  }

  function select(i) {
    if (i === cur || !ready || introActive) return
    setActiveTab(i)
    if (bars[cur]) gsap.set(bars[cur], { scaleX: 0 }) // reset the outgoing bar
    if (progressTween) progressTween.kill()
    morphTo(i)
  }

  // ---- Events ----
  // Switch on click AND on hover (desktop) — hovering a tab morphs to its state.
  links.forEach((link, i) => {
    const go = () => {
      if (i !== cur) select(i)
    }
    link.addEventListener('click', go)
    link.addEventListener('mouseenter', go)
  })
  tablist.addEventListener('keydown', (e) => {
    let next = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown')
      next = (cur + 1) % count
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = (cur - 1 + count) % count
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = count - 1
    else return
    e.preventDefault()
    links[next].focus()
    select(next)
  })

  root.addEventListener('pointerenter', () => {
    hovered = true
    stopProgress()
  })
  root.addEventListener('pointerleave', () => {
    hovered = false
    resumeProgress()
  })
  root.addEventListener('focusin', () => {
    focused = true
    stopProgress()
  })
  root.addEventListener('focusout', () => {
    focused = false
    resumeProgress()
  })

  // Localized hover nebula over the graphic stage — desktop only.
  stage.addEventListener('pointermove', (e) => {
    if (!desktopHover.matches) return
    const rect = stage.getBoundingClientRect()
    mx = (e.clientX - rect.left - cssW / 2) / scale
    my = (e.clientY - rect.top - cssH * 0.5) / scale
    ensureLoop()
  })
  stage.addEventListener('pointerenter', () => {
    if (!desktopHover.matches) return
    hovActive = true
    ensureLoop()
  })
  stage.addEventListener('pointerleave', () => {
    hovActive = false
    ensureLoop()
  })
  // If the viewport drops below desktop mid-hover, release the nebula.
  desktopHover.addEventListener('change', (e) => {
    if (!e.matches) hovActive = false
  })

  // Visibility: arm autoplay + fire the intro on first enter; pause when hidden.
  const io = new window.IntersectionObserver(
    (entries) => {
      inView = entries[0].isIntersecting
      if (inView) {
        if (ready && !started && !introActive) runIntro()
        else resumeProgress()
        ensureLoop() // resume the shimmer loop on re-entry
      } else {
        stopProgress()
      }
    },
    { threshold: 0.05 }
  )
  io.observe(root)

  function runIntro() {
    introActive = true
    introProg.v = 0
    introFade.v = 0
    gsap.killTweensOf([introProg, introFade])
    gsap
      .timeline({ onComplete: finishIntro })
      .to(introFade, { v: 1, duration: INTRO_FADE, ease: 'power1.out' }, 0)
      .to(
        introProg,
        { v: 1, duration: INTRO_DURATION, ease: 'power2.inOut' },
        INTRO_HOLD
      )
    ensureLoop()
  }

  function finishIntro() {
    introActive = false
    const s0 = states[0]
    fromX.set(s0.x)
    fromY.set(s0.y)
    fromA.set(s0.a)
    toState = states[0]
    morph.t = 1
    cur = 0
    started = true
    if (!paused()) startProgress(0)
    draw()
  }

  // ---- Boot: sample the source images, normalize to a common centered scale ----
  async function boot() {
    setActiveTab(0)
    resize()
    const srcs = imgs.slice(0, count).map((im) => im.currentSrc || im.src)
    const loaded = await Promise.all(srcs.map(loadImage))
    const firstOk = loaded.find(Boolean)
    if (!firstOk) {
      console.warn(
        '[tabs-stats] no source images loaded — falling back to static'
      )
      teardownCanvas()
      setupFallback(root, links, tabItems, count)
      return
    }
    for (let i = 0; i < loaded.length; i++) if (!loaded[i]) loaded[i] = firstOk

    let raw
    try {
      raw = loaded.map((im, i) => sampleImage(im, N, mulberry32(1000 + i)))
    } catch (err) {
      // CORS-tainted canvas (getImageData blocked) — degrade to static images.
      console.warn(
        '[tabs-stats] could not sample images (CORS?) — falling back to static',
        err
      )
      teardownCanvas()
      setupFallback(root, links, tabItems, count)
      return
    }

    let maxHalf = 0
    const centers = raw.map((r) => {
      const cxp = (r.bbox.minX + r.bbox.maxX) / 2
      const cyp = (r.bbox.minY + r.bbox.maxY) / 2
      maxHalf = Math.max(
        maxHalf,
        (r.bbox.maxX - r.bbox.minX) / 2,
        (r.bbox.maxY - r.bbox.minY) / 2
      )
      return [cxp, cyp]
    })
    const norm = 1 / (maxHalf || 1)
    states = raw.map((r, i) => {
      const [cxp, cyp] = centers[i]
      const x = new Float32Array(N)
      const y = new Float32Array(N)
      for (let k = 0; k < N; k++) {
        x[k] = (r.x[k] - cxp) * norm
        y[k] = (r.y[k] - cyp) * norm
      }
      return { x, y, a: r.a }
    })

    // Measure the largest half-extent across all states so resize() can auto-fit.
    extX = 0
    extY = 0
    for (const s of states) {
      for (let k = 0; k < N; k++) {
        const ax = Math.abs(s.x[k])
        const ay = Math.abs(s.y[k])
        if (ax > extX) extX = ax
        if (ay > extY) extY = ay
      }
    }
    if (!extX) extX = 1
    if (!extY) extY = 1
    resize() // recompute scale now that the real extent is known

    toState = states[0]
    fromX.set(states[0].x)
    fromY.set(states[0].y)
    fromA.set(states[0].a)
    morph.t = 1
    ready = true

    // Source images are now sampled — hand the stage over to the canvas.
    root.classList.add('is-canvas')

    // Scatter every point into a soft cloud dispersed across the whole stage
    // (computed once) for the intro. Fractions in [-1,1] are scaled by the stage
    // half-extent (coverX/coverY) at draw time, like scroll-morph.
    const frng = mulberry32(7)
    for (let i = 0; i < N; i++) {
      startX[i] = frng() * 2 - 1
      startY[i] = frng() * 2 - 1
      introDelay[i] = frng() * INTRO_STAGGER
      driftPhase[i] = frng() * Math.PI * 2
    }
    // The intro (fired by the IntersectionObserver on first view) renders the
    // rise-in; if already in view it runs now. Nothing is drawn before then.
    if (inView) runIntro()
  }

  function teardownCanvas() {
    io.disconnect()
    canvas.remove()
  }

  boot()

  return {
    resize() {
      resize()
    },
  }
}

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='tabs-stats']
 */
export default function (elements) {
  if (!gsap) {
    console.warn('[tabs-stats] GSAP not found on window — static fallback only')
  }
  const instances = elements.map(setupTabs).filter(Boolean)
  if (!instances.length) return

  return {
    resize() {
      instances.forEach((inst) => inst.resize())
    },
  }
}
