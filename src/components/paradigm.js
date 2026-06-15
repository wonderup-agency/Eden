/*
  Component: paradigm · data-component="paradigm"
  Autoplay tabs (3): a circular ring (grey→gold) and an underline (grey→black) fill in
  sync per tab; the active text de-blurs per word and the visual crossfades on each switch.
  CSS → ./styles/paradigm.css (paste into Webflow head) · Docs → .claude/rules/components/paradigm.md
*/

import { REVEAL_FROM, REVEAL_TO, splitElement } from '../utils/word-reveal.js'

const { gsap } = window

// Tuning
const AUTOPLAY_DURATION = 5 // seconds per tab
const CROSSFADE = 0.6 // visual crossfade
const OUT_FADE = 0.3 // outgoing text fade
// Stroke widths in viewBox units (svg is 0 0 100 100). Thin grey track, thicker gold arc.
const TRACK_STROKE = 2.5 // grey baseline (~1px on a 44px ring)
const ARC_STROKE = 6 // gold fill — chunkier than the track
const GLOW_PAD = 8 // inset the ring so the gold glow has room inside the viewBox
const RING_STEP = 0.6 // ring step transition between tabs
const GLOW_COLOR = '#f7c661' // gold arc glow (Figma F7C661)

const SVGNS = 'http://www.w3.org/2000/svg'

// Outgoing tab: plain fade only. The de-blur lives on the words, never the parent —
// a filter on the title element would linger and blur the words on re-entry.
const REVEAL_OUT = { autoAlpha: 0, duration: OUT_FADE }

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

// Soft gold glow via an SVG <filter> with an explicit (oversized) region — a CSS
// drop-shadow on an SVG element clips to a tight filter region, cropping the halo.
function glowFilter(id) {
  const filter = document.createElementNS(SVGNS, 'filter')
  filter.setAttribute('id', id)
  filter.setAttribute('x', '-50%')
  filter.setAttribute('y', '-50%')
  filter.setAttribute('width', '200%')
  filter.setAttribute('height', '200%')
  filter.setAttribute('color-interpolation-filters', 'sRGB')
  filter.appendChild(dropShadow(2.5, 0.9)) // tight inner glow
  filter.appendChild(dropShadow(5, 0.55)) // wider soft halo
  const defs = document.createElementNS(SVGNS, 'defs')
  defs.appendChild(filter)
  return defs
}

function setupRoot(root, rootIndex) {
  const ring = root.querySelector('[data-paradigm="progress-ring"]')
  const numbers = gsap.utils.toArray(
    root.querySelectorAll('.tabs-paradigm_progress-number')
  )
  const titles = gsap.utils.toArray(
    root.querySelectorAll('[data-paradigm="tab-title"]')
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
  const underlineFill = root.querySelector('.tabs-paradigm_underline-fill')
  const messagesWrap = root.querySelector('[data-paradigm-messages]')
  const visualsWrap = root.querySelector('.tabs-paradigm_visual-wrapper')

  const count = Math.min(titles.length, links.length, visuals.length)
  if (count < 1) {
    console.warn('[paradigm] needs at least one tab-title / tab-link / visual')
    return null
  }

  root.classList.add('is-enhanced')

  const wordsByTab = messages.slice(0, count).map(splitElement)

  // Inject the ring SVG (track + progress) — viewBox is resolution-independent,
  // so it scales with the ring box and never needs rebuilding on resize.
  let progressCircle = null
  let circumference = 0
  if (ring) {
    // Inset by the thicker stroke + glow padding so the halo fits inside the viewBox.
    const r = (100 - ARC_STROKE) / 2 - GLOW_PAD
    circumference = 2 * Math.PI * r
    const svg = document.createElementNS(SVGNS, 'svg')
    svg.setAttribute('class', 'tabs-paradigm_progress-svg')
    svg.setAttribute('viewBox', '0 0 100 100')
    svg.setAttribute('aria-hidden', 'true')
    svg.style.overflow = 'visible' // guarantee the glow isn't clipped (independent of head CSS)
    const glowId = 'paradigm-glow-' + rootIndex
    svg.appendChild(glowFilter(glowId))
    svg.appendChild(circle('tabs-paradigm_progress-track', r, TRACK_STROKE))
    progressCircle = circle('tabs-paradigm_progress-arc', r, ARC_STROKE)
    progressCircle.setAttribute('filter', `url(#${glowId})`)
    progressCircle.style.strokeDasharray = String(circumference)
    progressCircle.style.strokeDashoffset = String(circumference)
    svg.appendChild(progressCircle)
    ring.insertBefore(svg, ring.firstChild)
  }

  // Initial states (before autoplay starts)
  gsap.set(titles, { autoAlpha: 0 })
  gsap.set(visuals, { autoAlpha: 0 })
  gsap.set(wordsByTab.flat(), REVEAL_FROM)
  if (underlineFill)
    gsap.set(underlineFill, { scaleX: 0, transformOrigin: 'left center' })

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

  // Ring = global stepped progress: holds during a tab, steps to (i+1)/count on switch.
  // On a loop-back (last → first, or any backward jump) it sweeps FORWARD — completes
  // to 100%, resets to 0%, then fills to the new step — so it never animates backward.
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
        strokeDashoffset: 0, // complete to 100%
        duration: RING_STEP,
        ease: 'power2.in',
      })
    ringTween
      .set(progressCircle, { strokeDashoffset: circumference }) // reset to 0%
      .to(progressCircle, {
        strokeDashoffset: target, // fill to the new step
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

    visuals.forEach((v, k) =>
      gsap.to(v, {
        autoAlpha: k === i ? 1 : 0,
        duration: CROSSFADE,
        ease: 'sine.out',
      })
    )

    ringTo(i, loop)
  }

  // Underline = global continuous progress: fills across the whole cycle, second by
  // second (tab i runs i/count → (i+1)/count over the tab duration; resets on loop).
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
    const loop = i < index // wrapping back (last → first) → ring sweeps forward, not back
    index = i
    activate(i, loop)
    runProgress()
  }

  const start = () => {
    if (started) return
    started = true
    goTo(0)
  }

  // User-driven switch (click / keyboard) — also kicks off autoplay if not started yet.
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

  // Both progress indicators switch tabs on click: the ring advances, each number jumps.
  if (ring) wireButton(ring, () => select((index + 1) % count), 'Next slide')
  links.forEach((l, i) =>
    wireButton(l, () => select(i), 'Go to slide ' + (i + 1))
  )

  // Visibility / hover / tab-focus gating
  const io = new window.IntersectionObserver(
    (entries) => {
      onScreen = entries[0].isIntersecting
      if (onScreen && !started) start()
      else sync()
    },
    { threshold: 0.35 }
  )
  io.observe(root)

  // Pause only while hovering the content (text + visual) — not the whole section.
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
}

// Static fallback (no GSAP / reduced motion): show the first tab only via classes.
function staticFallback(root) {
  const first = (sel) => root.querySelector(sel)
  first('[data-paradigm="tab-title"]')?.classList.add('is-active')
  first('[data-paradigm="tab-link"]')?.classList.add('is-active')
  first('[data-paradigm-visual]')?.classList.add('is-active')
  first('.tabs-paradigm_progress-number')?.classList.add('is-active')
  root.classList.add('is-static')
}

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='paradigm']
 */
export default function (elements) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (!gsap || reduce) {
    if (!gsap)
      console.warn('[paradigm] GSAP not found on window — static fallback')
    elements.forEach(staticFallback)
    return
  }

  elements.forEach(setupRoot)
}
