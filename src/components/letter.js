/*
  Component: letter · data-component="letter"
  Manifesto entrance: the title de-blurs per word, then the letter's paragraphs one
  after another, then the signature writes itself (stroke-dashoffset, no DrawSVG).
  No CSS file · Docs → .claude/rules/components/letter.md
*/

import { REVEAL_FROM, splitWords, textTargets } from '../utils/word-reveal.js'

const { gsap } = window

// Root defaults — each overridable with data-letter-* on the section.
const DEFAULTS = {
  delay: 0,
  duration: 1.2, // per step
  words: 0.05, // gap between words inside one text
  bodyAt: 0.3, // when the first paragraph starts, behind the title
  paraStagger: 0.25, // gap between paragraphs
  signDuration: 1.8, // the whole signature, however many strokes it has
  signOverlap: 0.4, // the pen starts this early, under the body's tail
  ease: 'power2.out',
}

const WORD_TO = { autoAlpha: 1, filter: 'blur(0px)', yPercent: 0 }
const BLOCK_FROM = { autoAlpha: 0, filter: 'blur(8px)', y: 14 }
const BLOCK_TO = { autoAlpha: 1, filter: 'blur(0px)', y: 0 }
const SIGN_FROM = { autoAlpha: 0, filter: 'blur(6px)' }
const SIGN_TO = { autoAlpha: 1, filter: 'blur(0px)' }

const WORDS_CAP = 0.9 // ceiling on one text's word cascade, seconds
const BLOCK_STAGGER = 0.12
const BLOCK_LEAD = 0.25 // a block lands just before the signature
const SIGN_GAP = 0.05 // pen lift between two strokes
const DRAWABLE = 'path,line,polyline,polygon'

const IN_VIEW = '0px 0px -20% 0px' // fires once the top reaches ~80% of the viewport
const CLEAR = { clearProps: 'filter,transform,willChange' }

function num(el, attr, fallback) {
  const raw = el.getAttribute(attr)
  if (raw === null || raw.trim() === '') return fallback
  const n = parseFloat(raw)
  return Number.isFinite(n) ? n : fallback
}

function readConfig(root) {
  return {
    delay: num(root, 'data-letter-delay', DEFAULTS.delay),
    duration: num(root, 'data-letter-duration', DEFAULTS.duration),
    words: num(root, 'data-letter-words', DEFAULTS.words),
    bodyAt: num(root, 'data-letter-body-at', DEFAULTS.bodyAt),
    paraStagger: num(root, 'data-letter-para-stagger', DEFAULTS.paraStagger),
    signDuration: num(root, 'data-letter-sign-duration', DEFAULTS.signDuration),
    signOverlap: num(root, 'data-letter-sign-overlap', DEFAULTS.signOverlap),
    ease: root.getAttribute('data-letter-ease') || DEFAULTS.ease,
    trigger: root.getAttribute('data-letter-trigger') || 'auto',
  }
}

const wordStagger = (n, cfg) =>
  n < 2 ? 0 : Math.min(cfg.words, WORDS_CAP / (n - 1))

// Strokes we can actually draw along. A filled outline (text converted to shapes)
// has no stroke, and tracing its contour looks nothing like writing — so it is
// excluded here and the signature falls back to a fade.
function drawablePaths(svg) {
  return Array.from(svg.querySelectorAll(DRAWABLE))
    .map((el) => {
      if (typeof el.getTotalLength !== 'function') return null
      const { stroke, strokeWidth } = window.getComputedStyle(el)
      if (!stroke || stroke === 'none' || !parseFloat(strokeWidth)) return null
      const len = el.getTotalLength()
      return Number.isFinite(len) && len > 0 ? { el, len } : null
    })
    .filter(Boolean)
}

function resolveSign(el) {
  if (!el) return null
  const svg = el.tagName.toLowerCase() === 'svg' ? el : el.querySelector('svg')
  return svg ? { el: svg, paths: drawablePaths(svg) } : { el, paths: [] }
}

function collect(root) {
  const pick = (role) => root.querySelector(`[data-letter='${role}']`)
  const title = pick('title')
  const body = pick('letter')
  const sign = resolveSign(pick('sign'))

  if (sign && !sign.paths.length)
    console.log(
      '[letter] signature has no stroked paths — fading it in instead'
    )

  return {
    title: title ? textTargets(title).flatMap(splitWords) : [],
    paras: body
      ? textTargets(body)
          .map(splitWords)
          .filter((w) => w.length)
      : [],
    blocks: Array.from(root.querySelectorAll("[data-letter='block']")),
    sign,
  }
}

function setStart(parts) {
  ;[parts.title, ...parts.paras].forEach((words) => {
    if (words.length) gsap.set(words, REVEAL_FROM)
  })
  if (parts.blocks.length) gsap.set(parts.blocks, BLOCK_FROM)
  if (!parts.sign) return
  if (parts.sign.paths.length)
    parts.sign.paths.forEach(({ el, len }) =>
      gsap.set(el, { strokeDasharray: len, strokeDashoffset: len })
    )
  else gsap.set(parts.sign.el, SIGN_FROM)
}

function addSign(tl, sign, at, cfg) {
  if (!sign) return
  if (!sign.paths.length) {
    tl.to(sign.el, { ...SIGN_TO, duration: cfg.duration, ...CLEAR }, at)
    return
  }

  // Constant pen speed: each stroke takes a slice of the budget proportional to its
  // own length, so a long flourish can't race a short letter. `ease: 'none'` for the
  // same reason — any other ease makes the pen lag then rush at every stroke join.
  const total = sign.paths.reduce((sum, p) => sum + p.len, 0)
  const budget = Math.max(
    cfg.signDuration - SIGN_GAP * (sign.paths.length - 1),
    0.1
  )
  let cursor = at

  sign.paths.forEach(({ el, len }) => {
    const duration = budget * (len / total)
    tl.to(
      el,
      {
        strokeDashoffset: 0,
        duration,
        ease: 'none',
        clearProps: 'strokeDasharray,strokeDashoffset',
      },
      cursor
    )
    cursor += duration + SIGN_GAP
  })
}

function buildTimeline(parts, cfg) {
  const tl = gsap.timeline({ paused: true, defaults: { ease: cfg.ease } })
  const { delay, duration } = cfg
  let bodyEnd = delay

  const addText = (words, at) => {
    const stagger = wordStagger(words.length, cfg)
    tl.to(words, { ...WORD_TO, duration, stagger, ...CLEAR }, at)
    bodyEnd = Math.max(bodyEnd, at + stagger * (words.length - 1) + duration)
  }

  if (parts.title.length) addText(parts.title, delay)
  parts.paras.forEach((words, i) =>
    addText(words, delay + cfg.bodyAt + i * cfg.paraStagger)
  )

  // Anchored to when the copy actually finishes, so retuning the stagger never
  // opens a gap before the signature.
  const tailAt = Math.max(bodyEnd - cfg.signOverlap, delay)
  parts.blocks.forEach((el, i) =>
    tl.to(el, { ...BLOCK_TO, duration, ...CLEAR }, tailAt + i * BLOCK_STAGGER)
  )
  addSign(tl, parts.sign, tailAt + (parts.blocks.length ? BLOCK_LEAD : 0), cfg)

  return tl
}

function setupLetter(root) {
  const cfg = readConfig(root)
  const parts = collect(root)

  if (!parts.title.length && !parts.paras.length && !parts.sign) {
    console.warn('[letter] no [data-letter] children found — skipping', root)
    gsap.set(root, { opacity: 1 })
    return
  }

  setStart(parts)
  // Everything is hidden — lift the anti-FOUC gate now, not when the timeline ends.
  gsap.set(root, { opacity: 1 })

  const tl = buildTimeline(parts, cfg)
  if (cfg.trigger === 'load') {
    tl.play()
    return
  }

  // IntersectionObserver (not ScrollTrigger) so the component carries no plugin
  // dependency and stays out of the global refresh ordering.
  const io = new window.IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()
      tl.play()
    },
    { threshold: 0, rootMargin: IN_VIEW }
  )
  io.observe(root)
}

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='letter']
 */
export default function (elements) {
  // No GSAP: drop the shared gate rather than waiting out its 4s fail-safe.
  if (!gsap) {
    console.warn('[letter] GSAP not found on window — skipping')
    document.documentElement.classList.remove('js-anim')
    return
  }

  // Reduced motion: lift the gate, leave everything visible, no split, no draw.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    elements.forEach((root) => gsap.set(root, { opacity: 1 }))
    return
  }

  elements.forEach(setupLetter)
}
