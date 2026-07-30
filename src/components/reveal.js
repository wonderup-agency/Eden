/*
  Component: reveal · data-component="reveal"
  Section entrance: one timeline de-blurs the marked children — per word on text,
  per block on everything else — on load or on scroll-in. Tuned with data-reveal-*.
  No CSS file (word spans styled inline) · Docs → .claude/rules/components/reveal.md
*/

import { REVEAL_FROM, splitElement } from '../utils/word-reveal.js'

const { gsap } = window

// Wrapper defaults — each overridable with data-reveal-* on the root.
const DEFAULTS = {
  delay: 0,
  duration: 1.45,
  stagger: 0.12,
  words: 0.06,
  ease: 'power2.out',
}

const WORD_TO = { autoAlpha: 1, filter: 'blur(0px)', yPercent: 0 }
const BLOCK_FROM = { autoAlpha: 0, filter: 'blur(8px)', y: 14 }
const BLOCK_TO = { autoAlpha: 1, filter: 'blur(0px)', y: 0 }
const HALO_DUR = 3 // × duration — the backdrop eases in well behind the copy

// Ceiling on the whole word cascade, seconds. Without it the per-word gap is
// multiplied by the word count, so a 33-word paragraph runs 3x longer than a
// 7-word heading and the reveal reads differently in every section it's reused in.
// The gap shrinks to fit instead.
const WORDS_CAP = 0.9

const IN_VIEW = '0px 0px -20% 0px' // fires once the top reaches ~80% of the viewport
const CLEAR = { clearProps: 'filter,transform,willChange' }

// Roles: `split` = per-word; `at: 0` pins to the timeline start (no stagger slot).
const ROLES = {
  title: { split: true },
  text: { split: true },
  block: {},
  button: {},
  visual: {},
  halo: { at: 0, durMult: HALO_DUR, opacityOnly: true },
}

function num(el, attr, fallback) {
  const raw = el.getAttribute(attr)
  if (raw === null || raw.trim() === '') return fallback
  const n = parseFloat(raw)
  return Number.isFinite(n) ? n : fallback
}

function readConfig(root) {
  return {
    delay: num(root, 'data-reveal-delay', DEFAULTS.delay),
    duration: num(root, 'data-reveal-duration', DEFAULTS.duration),
    stagger: num(root, 'data-reveal-stagger', DEFAULTS.stagger),
    words: num(root, 'data-reveal-words', DEFAULTS.words),
    ease: root.getAttribute('data-reveal-ease') || DEFAULTS.ease,
    trigger: root.getAttribute('data-reveal-trigger') || 'auto',
  }
}

const wordStagger = (n, cfg) =>
  n < 2 ? 0 : Math.min(cfg.words, WORDS_CAP / (n - 1))

function collect(root) {
  return Array.from(root.querySelectorAll('[data-reveal]')).map((el) => {
    const name = el.getAttribute('data-reveal')
    const role = ROLES[name] || ROLES.block
    if (!ROLES[name])
      console.warn(`[reveal] unknown role "${name}" — treated as block`)
    return { el, role, words: role.split ? splitElement(el) : null }
  })
}

function setStart(items) {
  items.forEach(({ el, role, words }) => {
    if (words && words.length) gsap.set(words, REVEAL_FROM)
    else gsap.set(el, role.opacityOnly ? { autoAlpha: 0 } : BLOCK_FROM)
  })
}

function buildTimeline(items, cfg) {
  const tl = gsap.timeline({ paused: true, defaults: { ease: cfg.ease } })
  let slot = 0

  items.forEach(({ el, role, words }) => {
    const override = el.getAttribute('data-reveal-delay')
    const at =
      override !== null && override.trim() !== ''
        ? parseFloat(override)
        : role.at === 0
          ? cfg.delay
          : cfg.delay + slot++ * cfg.stagger

    const duration = num(
      el,
      'data-reveal-duration',
      cfg.duration * (role.durMult || 1)
    )

    if (words && words.length)
      tl.to(
        words,
        {
          ...WORD_TO,
          duration,
          stagger: wordStagger(words.length, cfg),
          ...CLEAR,
        },
        at
      )
    else if (role.opacityOnly) tl.to(el, { autoAlpha: 1, duration }, at)
    else tl.to(el, { ...BLOCK_TO, duration, ...CLEAR }, at)
  })

  return tl
}

function setupReveal(root) {
  const cfg = readConfig(root)
  const items = collect(root)
  if (!items.length) {
    console.warn('[reveal] no [data-reveal] children found — skipping', root)
    gsap.set(root, { opacity: 1 })
    return
  }

  setStart(items)
  // Everything is hidden — lift the anti-FOUC gate now, not when the timeline ends.
  // The heading is usually the page's LCP element; gating it any longer costs LCP.
  gsap.set(root, { opacity: 1 })

  const tl = buildTimeline(items, cfg)
  if (cfg.trigger === 'load') {
    tl.play()
    return
  }

  // IntersectionObserver (not ScrollTrigger) so the component carries no plugin
  // dependency. It also fires immediately when the section is already in view on
  // load, which is what lets one trigger mode cover hero and below-the-fold both.
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
 * @param {HTMLElement[]} elements - All elements matching [data-component='reveal']
 */
export default function (elements) {
  // No GSAP: drop the shared gate rather than waiting out its 4s fail-safe.
  if (!gsap) {
    console.warn('[reveal] GSAP not found on window — skipping')
    document.documentElement.classList.remove('js-anim')
    return
  }

  // Reduced motion: lift the gate, leave everything visible, no split, no animation.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    elements.forEach((root) => gsap.set(root, { opacity: 1 }))
    return
  }

  elements.forEach(setupReveal)
}
