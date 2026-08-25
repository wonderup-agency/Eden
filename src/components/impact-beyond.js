/*
  Component: impact-beyond · data-component="impact-beyond"
  Section entrance: title + subtitle de-blur per word, then each card wipes its
  photo open (clip-path) while the photo settles from a slight zoom and the copy
  de-blurs. Fires once on scroll-in. No CSS file (everything is inline/transform).
  Docs → .claude/rules/components/impact-beyond.md
*/

import { REVEAL_FROM, splitElement } from '../utils/word-reveal.js'

const { gsap } = window

// Root defaults — each overridable with data-beyond-* on the root.
const DEFAULTS = {
  delay: 0,
  subtitleAt: 0.18, // subtitle starts behind the title, not with it
  itemsAt: 0.4, // cards start once the copy is under way
  stagger: 0.16, // gap between cards
  ease: 'power2.out',
}

const WORD_TO = { autoAlpha: 1, filter: 'blur(0px)', yPercent: 0 }
const WORD_DUR = 1.2
const WORD_GAP = 0.06
// Ceiling on one element's whole word cascade, seconds. Without it the gap is
// multiplied by the word count, so the 12-word title would run several times
// longer than a short one and the section would read differently per copy edit.
const WORDS_CAP = 0.9

const MEDIA_ZOOM = 1.12 // photo settles down to 1 — never past it, or it lands soft
const MEDIA_DUR = 1.5
const COPY_AT = 0.14 // copy trails its own photo
const COPY_FROM = { autoAlpha: 0, filter: 'blur(8px)', y: 16 }
const COPY_TO = { autoAlpha: 1, filter: 'blur(0px)', y: 0 }
const COPY_DUR = 1
const COPY_GAP = 0.08

const IN_VIEW = '0px 0px -15% 0px' // fires once the top reaches ~85% of the viewport
const CLEAR = { clearProps: 'filter,transform,clipPath,willChange' }

// Attribute hook first, Webflow class second — so the section works with the
// markup as authored and only needs data-component on the wrapper.
const HOOKS = {
  title: ['[data-beyond="title"]', 'h1, h2'],
  subtitle: ['[data-beyond="subtitle"]', '.impact-privilege_subtitle'],
  item: ['[data-beyond="item"]', '.beyond-impact_item'],
  media: ['[data-beyond="media"]', '.beyond-impact_image-wrapper'],
  content: ['[data-beyond="content"]', '.beyond-impact_item-content'],
}

const one = (scope, [attr, cls]) =>
  scope.querySelector(attr) || scope.querySelector(cls)
const many = (scope, [attr, cls]) => {
  const found = scope.querySelectorAll(attr)
  return Array.from(found.length ? found : scope.querySelectorAll(cls))
}

function num(el, attr, fallback) {
  const raw = el.getAttribute(attr)
  if (raw === null || raw.trim() === '') return fallback
  const n = parseFloat(raw)
  return Number.isFinite(n) ? n : fallback
}

function readConfig(root) {
  return {
    delay: num(root, 'data-beyond-delay', DEFAULTS.delay),
    subtitleAt: num(root, 'data-beyond-subtitle-at', DEFAULTS.subtitleAt),
    itemsAt: num(root, 'data-beyond-items-at', DEFAULTS.itemsAt),
    stagger: num(root, 'data-beyond-stagger', DEFAULTS.stagger),
    ease: root.getAttribute('data-beyond-ease') || DEFAULTS.ease,
    trigger: root.getAttribute('data-beyond-trigger') || 'auto',
  }
}

const wordStagger = (n) => (n < 2 ? 0 : Math.min(WORD_GAP, WORDS_CAP / (n - 1)))

// The wipe has to respect the card's rounded corners — inset() takes
// border-radius syntax verbatim, so a multi-value radius passes straight through.
function clipFor(el, closed) {
  const box = closed ? '0% 0% 100% 0%' : '0% 0% 0% 0%'
  const r = window.getComputedStyle(el).borderRadius
  return r && parseFloat(r) ? `inset(${box} round ${r})` : `inset(${box})`
}

function collect(root) {
  const title = one(root, HOOKS.title)
  const subtitle = one(root, HOOKS.subtitle)
  const items = many(root, HOOKS.item).map((el) => {
    const media = one(el, HOOKS.media)
    const content = one(el, HOOKS.content)
    return {
      media,
      photo: media ? media.querySelector('img, video') : null,
      copy: content ? Array.from(content.children) : [],
    }
  })

  return {
    words: [title, subtitle].map((el) => (el ? splitElement(el) : [])),
    items,
  }
}

function setStart({ words, items }) {
  words.forEach((w) => w.length && gsap.set(w, REVEAL_FROM))
  items.forEach(({ media, photo, copy }) => {
    if (media)
      gsap.set(media, {
        clipPath: clipFor(media, true),
        willChange: 'clip-path',
      })
    if (photo) gsap.set(photo, { scale: MEDIA_ZOOM })
    if (copy.length) gsap.set(copy, COPY_FROM)
  })
}

function buildTimeline({ words, items }, cfg) {
  const tl = gsap.timeline({ paused: true, defaults: { ease: cfg.ease } })
  const at = [cfg.delay, cfg.delay + cfg.subtitleAt]

  words.forEach((w, i) => {
    if (!w.length) return
    tl.to(
      w,
      {
        ...WORD_TO,
        duration: WORD_DUR,
        stagger: wordStagger(w.length),
        ...CLEAR,
      },
      at[i]
    )
  })

  items.forEach(({ media, photo, copy }, i) => {
    const start = cfg.delay + cfg.itemsAt + i * cfg.stagger
    if (media)
      tl.to(
        media,
        { clipPath: clipFor(media, false), duration: MEDIA_DUR, ...CLEAR },
        start
      )
    // Same position as the wipe: the photo settles as it is uncovered.
    if (photo) tl.to(photo, { scale: 1, duration: MEDIA_DUR, ...CLEAR }, start)
    if (copy.length)
      tl.to(
        copy,
        { ...COPY_TO, duration: COPY_DUR, stagger: COPY_GAP, ...CLEAR },
        start + COPY_AT
      )
  })

  return tl
}

function setupBeyond(root) {
  const cfg = readConfig(root)
  const parts = collect(root)
  const hasWords = parts.words.some((w) => w.length)

  if (!hasWords && !parts.items.length) {
    console.warn('[impact-beyond] nothing to animate — skipping', root)
    return
  }

  setStart(parts)
  const tl = buildTimeline(parts, cfg)

  if (cfg.trigger === 'load') {
    tl.play()
    return
  }

  // IntersectionObserver, not ScrollTrigger: the component carries no plugin
  // dependency and stays out of the global refresh ordering. It also fires
  // immediately if the section is already in view, so one mode covers both cases.
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
 * @param {HTMLElement[]} elements - All elements matching [data-component='impact-beyond']
 */
export default function (elements) {
  if (!gsap) {
    console.warn('[impact-beyond] GSAP not found on window — skipping')
    return
  }

  // Reduced motion: nothing is set at all, so the section renders finished.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  elements.forEach(setupBeyond)
}
