/*
  Component: tabs-stats · data-component="tabs-stats"
  Stats tabs with a PNG-sampled 2D point cloud (~7k points) that morphs between states
  on switch. Intro: dispersed cloud floats in → converges. Residual shimmer keeps it
  alive when idle; hover loosens it (desktop only). No autoplay — click / hover / keyboard
  switch, and the active tab's underline snaps to full as a state indicator.
  Canvas 2D, no 3D lib. Fallback (no GSAP / reduced motion / CORS-tainted): static image.
  Below 767px it isn't tabs at all — the stats stack as text → graphic pairs, each with its own
  always-alive cloud that only ticks while it's on screen (setupStacked).
  CSS → ./styles/tabs-stats.css (bundled via src/styles.js) · Docs → .claude/rules/components/tabs-stats.md
*/

import { fadeOutFill, fillFull } from '../utils/tab-underline.js'
import { MOBILE_Q } from '../utils/tabs-accordion.js'
import {
  createStillCloud,
  loadImage,
  makeSprite,
  mulberry32,
  sampleImage,
} from '../utils/point-cloud.js'

const { gsap } = window

const ACTIVE_CLASS = 'is-active'

// ---- Point cloud ----
const TARGET_POINTS = 7000 // points per state — same for all, for a 1:1 morph
// Stacked mobile: one cloud per stat, so the budget is per cloud — and only the one on screen
// runs, which keeps the frame cheaper than the single desktop cloud.
// Scaled with `--stats-stacked-graphic` (tabs-stats.css, 72% of the row): the dot radius is in
// px and doesn't shrink with the box, so the same count in a smaller box reads denser. Keep the
// two moving together.
const STACKED_POINTS = 1800
const STACKED_FIT = 0.94 // the canvas IS the image's box, so the ink can fill more of it
const MORPH_DURATION = 1.25
const MORPH_EASE = 'power2.inOut'
// Active-tab underline: the incoming bar appears FULL immediately (nothing is being timed
// here — sliding it in read as a progress bar that isn't one); the outgoing one fades out
// at its current width (`fadeOutFill`) instead of retracting.
const DOT_COLOR = '125,130,140' // #7d828c
const FIT = 0.82 // half-stage fraction the cloud fills (1 = touches the edges)
const DOT_RADIUS = 1.4
// Hover nebula (desktop only — reads as jitter on tablet/below)
const HOVER_RADIUS = 0.4
const HOVER_PUSH = 0.03
const HOVER_SWIRL = 0.06
const HOVER_EASE = 0.11
const HOVER_SCATTER = 0.18
const HOVER_MIN_WIDTH = 992 // px — hover only at/above this (Webflow desktop base)
// Ambient drift — residual shimmer that never fully stops (assembled = DRIFT×SHIMMER_FLOOR).
const DRIFT = 0.26 // drift amplitude while dispersed
const DRIFT_SPEED = 0.85
const SHIMMER_FLOOR = 0.6 // fraction of DRIFT kept once assembled (never frozen)
// Coherent breathing — a slow radial pulse rippling out from center. Pull BREATH_AMP back if it smears.
const BREATH_AMP = 0.05 // radial pulse amplitude
const BREATH_SPEED = 1.1 // pulse speed (rad/s)
const BREATH_RIPPLE = 2.2 // spatial frequency — 0 = uniform pulse, >0 = outward ripple
// Intro (float in → assemble).
const INTRO_SCATTER = 1.0 // dispersed coverage (1 = fills the stage)
const INTRO_FADE = 0.5 // fade-in (s)
const INTRO_HOLD = 1.0 // float ~1s before converging (s)
const INTRO_DURATION = 1.6 // convergence (s)
const INTRO_STAGGER = 0.5 // per-point convergence-start spread

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
// Hover nebula is desktop-only (reactive gate, no re-binding).
const desktopHover = window.matchMedia(`(min-width: ${HOVER_MIN_WIDTH}px)`)

// mulberry32 / loadImage / sampleImage / makeSprite live in ../utils/point-cloud.js — the
// stacked mobile clouds sample the same way, and one copy of the thresholds is the point.

// Static fallback (no GSAP / reduced motion / tainted assets): toggle the active
// tab-item image on click + keyboard (underline state is CSS).
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

// Stacked mobile layout (≤ MOBILE_Q): not tabs at all — each stat's text is followed by its
// own graphic, one pair under the other, all three on screen. Interleaves the existing
// elements (no clone), then gives each graphic its own cloud (see setupStackedClouds).
function setupStacked(root, links, tabItems) {
  const box = document.createElement('div')
  box.className = 'tabs-stats_stack'
  links.forEach((link, i) => {
    const item = document.createElement('div')
    item.className = 'tabs-stats_stack-item'
    // Every pair IS active here — which is also what makes the existing `.is-active` rules
    // do the whole job: the gradient on the stat text, and opacity 1 on its graphic.
    link.classList.add(ACTIVE_CLASS)
    item.appendChild(link)
    if (tabItems[i]) {
      tabItems[i].classList.add(ACTIVE_CLASS)
      item.appendChild(tabItems[i])
    }
    box.appendChild(item)
  })
  const anchor = root.querySelector('.tabs-stats_tabs-links')
  if (anchor?.parentElement) anchor.parentElement.insertBefore(box, anchor)
  else root.appendChild(box)
  root.classList.add('is-stacked')

  const clouds = setupStackedClouds(tabItems)
  return {
    resize() {
      clouds.forEach((cloud) => cloud.resize())
    },
  }
}

// One always-alive cloud per stacked graphic. There is no morph here — nothing to switch
// between — so each cloud just assembles its own shape on scroll-in and then shimmers and
// breathes, and its loop runs ONLY while it is on screen. On a phone that means one or two
// clouds ticking at STACKED_POINTS each: cheaper per frame than the single desktop cloud at
// TARGET_POINTS, which is what makes three of them affordable.
// The <img> stays in the DOM behind it — it reserves the box the canvas fills (nothing else
// gives the row its height) and it is what shows if a cloud can't be built.
function setupStackedClouds(tabItems) {
  const clouds = []
  if (!gsap || reduceMotion.matches) return clouds
  tabItems.forEach((item, i) => {
    const img = item?.querySelector('img')
    const stage =
      img?.closest('[tabs-architected="image"]') || img?.parentElement
    if (!img || !stage) return
    createStillCloud({
      stage,
      src: img.currentSrc || img.src,
      points: STACKED_POINTS,
      fit: STACKED_FIT,
      look: { radius: DOT_RADIUS, color: DOT_COLOR },
      motion: {
        drift: DRIFT,
        driftSpeed: DRIFT_SPEED,
        shimmerFloor: SHIMMER_FLOOR,
        breathAmp: BREATH_AMP,
        breathSpeed: BREATH_SPEED,
        breathRipple: BREATH_RIPPLE,
      },
      intro: {
        scatter: INTRO_SCATTER,
        fade: INTRO_FADE,
        hold: INTRO_HOLD,
        duration: INTRO_DURATION,
        stagger: INTRO_STAGGER,
      },
      seed: 1000 + i, // so the three don't scatter in identical patterns
    })
      .then((cloud) => {
        if (!cloud) return // never loaded, or CORS-tainted → the static image stays
        clouds.push(cloud)
        item.classList.add('is-cloud') // hides the <img> but keeps its box (CSS)
      })
      // Nothing downstream awaits this, so an unhandled rejection would be silent — and the
      // static image is a perfectly good outcome.
      .catch((err) => console.warn('[tabs-stats] stacked cloud failed', err))
  })
  return clouds
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
  const tabItems = imgs.map(
    (img) => img.closest('.tabs-stats_tab-item') || img.parentElement
  )

  // Mobile: a stack, not tabs — so no tab engine and no ARIA tab scaffolding, just one cloud
  // per graphic. Decided ONCE at init (same call as impact-map's density budget): the tab
  // engine is never booted, so a device rotated across 767px keeps the layout it loaded with.
  if (window.matchMedia(MOBILE_Q).matches)
    return setupStacked(root, links, tabItems)

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

  // Expand each underline rail (is-track) + inject a black fill child. The fill is the
  // active-tab indicator (setActiveUnderline): only the active tab's fill shows, every
  // other tab stays empty (inactive). `bars` = the fill children.
  const bars = links.map((link) => {
    const track = link.querySelector('.tabs-architected_tab-link-underline')
    if (!track) return null
    const fill = document.createElement('span')
    fill.className = 'tabs-architected_tab-link-fill'
    track.appendChild(fill)
    track.classList.add('is-track')
    return fill
  })
  gsap.set(bars.filter(Boolean), { scaleX: 0, transformOrigin: 'left center' })

  // ---- Canvas + point-cloud engine ----
  const canvas = document.createElement('canvas')
  canvas.className = 'tabs-stats_pointcloud'
  canvas.setAttribute('aria-hidden', 'true')
  stage.appendChild(canvas)
  const ctx = canvas.getContext('2d')

  const N = TARGET_POINTS
  const sprite = makeSprite(DOT_COLOR)

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
  let looping = false
  let ready = false
  let started = false // intro done → switching allowed

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

    // Intro: scattered floating cloud drifts, then converges into state 0 (staggered).
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
        // Drift fades from full (dispersed) to the residual shimmer (assembled).
        const driftAmp =
          (SHIMMER_FLOOR + (1 - SHIMMER_FLOOR) * (1 - pp)) * DRIFT
        const fx =
          Math.cos(now * DRIFT_SPEED + driftPhase[i]) * dispX[i] * driftAmp
        const fy =
          Math.sin(now * DRIFT_SPEED + driftPhase[i]) * dispY[i] * driftAmp
        // Dispersed fills the stage; converge to state 0 as pp → 1.
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
      // Coherent radial breathing — a slow ripple out from center scales each point
      // toward/away, keeping the assembled shape alive (not just shimmering).
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

  // Runs continuously while on screen (the shimmer always has something to draw).
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
    gsap.killTweensOf(morph)
    gsap.to(morph, { t: 1, duration: MORPH_DURATION, ease: MORPH_EASE })
    setActiveUnderline(cur)
    ensureLoop()
  }

  // Active-only fills: the active tab's bar snaps to full, every other one fades out where
  // it stands. State indicator, not a progress bar — there is no autoplay to time.
  function setActiveUnderline(index) {
    bars.forEach((bar, k) => (k === index ? fillFull(bar) : fadeOutFill(bar)))
  }

  function select(i) {
    if (i === cur || !ready || introActive) return
    setActiveTab(i)
    morphTo(i)
  }

  // ---- Events ----
  // Click or HOVER a stat link to switch to its state — the only way tabs change.
  links.forEach((link, i) => {
    link.addEventListener('click', () => {
      if (i !== cur) select(i)
    })
    link.addEventListener('mouseenter', () => {
      if (i !== cur) select(i)
    })
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

  // Visibility: fire the intro on first enter; resume the shimmer loop on re-entry.
  const io = new window.IntersectionObserver(
    (entries) => {
      inView = entries[0].isIntersecting
      if (inView) {
        if (ready && !started && !introActive) runIntro()
        ensureLoop()
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
    draw()
  }

  // ---- Boot: sample source images, normalize to a common centered scale ----
  async function boot() {
    setActiveTab(0)
    setActiveUnderline(0) // first tab reads active from load (no autoplay to start it)
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

    // Scatter every point across the stage for the intro (fractions in [-1,1] scaled
    // by coverX/coverY at draw time).
    const frng = mulberry32(7)
    for (let i = 0; i < N; i++) {
      startX[i] = frng() * 2 - 1
      startY[i] = frng() * 2 - 1
      introDelay[i] = frng() * INTRO_STAGGER
      driftPhase[i] = frng() * Math.PI * 2
    }
    // Intro fires on first view (IntersectionObserver); run now if already in view.
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
