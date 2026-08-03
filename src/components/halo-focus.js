/*
  Component: halo-focus · data-component="halo-focus"
  About header: the gold dome grows out of the card's top edge on load while the title
  and the payoff line de-blur; on scroll it keeps settling and the title steps back.
  CSS → ./styles/halo-focus.css · Docs → .claude/rules/components/halo-focus.md
*/

import { REVEAL_FROM, splitElement } from '../utils/word-reveal.js'

const { gsap, ScrollTrigger } = window

// Load entrance. The halo is at full colour from frame one — only its size animates.
const GROW = { from: 0.55, duration: 1.7, ease: 'power2.out' }
const TITLE_AT = 0.15 // seconds into the load timeline
const PAYOFF_AT = 0.55

// Word reveal — same de-blur as reveal / hero / title-animation.
const WORD = { duration: 1.45, stagger: 0.06, ease: 'power2.out' }
const WORDS_CAP = 0.9 // ceiling on the whole cascade — see reveal.md
const WORD_TO = { autoAlpha: 1, filter: 'blur(0px)', yPercent: 0 }
const CLEAR = { clearProps: 'filter,transform,willChange' }

// Scroll pass — movement only. `travel` is a yPercent on the stage, and the stage is
// the card's own box: the number is a % of the CARD HEIGHT, not of the ring diameter.
const DESKTOP = { travel: 26, dim: 0.35, scrub: 0.6 }
const MOBILE = { travel: 14, dim: 0.45, scrub: 0.35 }

// The section is the page header, so the card is already fully visible on load. The
// range starts at scroll 0 (`top top` on the section, not the card) — anchoring it to
// the card's entrance would leave most of the travel consumed before the first pixel.
const START = 'top top'
const END = 'bottom center'
const LOAD_START = 'top 85%' // fires at once when the section is already in view
const MOBILE_Q = '(max-width: 767px)'
const RING_FALLBACK = '.header145_halo' // the ring is markup inside a Webflow embed

const wordStagger = (n) =>
  n < 2 ? 0 : Math.min(WORD.stagger, WORDS_CAP / (n - 1))

// Two nested layers so each animation owns its own element: the outer translates with
// the scroll, the inner scales on load. Sharing one element would let a matchMedia
// revert on the scroll branch restore whatever scale the load tween was at.
function mountStage(card, ring) {
  const found = card.querySelector('.halo-focus_stage')
  if (found) return { stage: found, grow: found.firstElementChild }

  const stage = document.createElement('div')
  stage.className = 'halo-focus_stage'
  const grow = document.createElement('div')
  grow.className = 'halo-focus_grow'
  stage.appendChild(grow)
  card.insertBefore(stage, card.firstChild)
  grow.appendChild(ring)
  return { stage, grow }
}

function setupHaloFocus(root) {
  const card = root.querySelector('[data-halo-card]')
  const ring =
    root.querySelector('[data-halo-ring]') || root.querySelector(RING_FALLBACK)
  if (!card || !ring) {
    console.warn(
      '[halo-focus] missing [data-halo-card] or the halo ring — skipping',
      root
    )
    gsap.set(root, { opacity: 1 })
    return
  }

  const { stage, grow } = mountStage(card, ring)
  const title = root.querySelector('[data-halo-title]')
  const payoff = root.querySelector('[data-halo-reveal]')

  // Split, then set every start state, then lift the gate — in that order, so nothing
  // is ever painted at its final size or un-blurred.
  const titleWords = title ? splitElement(title) : []
  const payoffWords = payoff ? splitElement(payoff) : []
  if (titleWords.length) gsap.set(titleWords, REVEAL_FROM)
  if (payoffWords.length) gsap.set(payoffWords, REVEAL_FROM)
  gsap.set(grow, { scale: GROW.from, willChange: 'transform' })
  gsap.set(root, { opacity: 1 })

  // Scaling an element that carries blur(52px) re-rasterises the blur every frame.
  // Acceptable for a bounded one-shot; the hint is dropped the moment it lands.
  const load = gsap.timeline({
    paused: true,
    onComplete: () => gsap.set(grow, { clearProps: 'willChange' }),
  })
  load.to(grow, { scale: 1, duration: GROW.duration, ease: GROW.ease }, 0)

  const cascade = (words, at) =>
    load.to(
      words,
      {
        ...WORD_TO,
        duration: WORD.duration,
        stagger: wordStagger(words.length),
        ease: WORD.ease,
        ...CLEAR,
      },
      at
    )
  if (titleWords.length) cascade(titleWords, TITLE_AT)
  if (payoffWords.length) cascade(payoffWords, PAYOFF_AT)

  // The entrance is the important half — without the plugin, play it and stop there.
  if (!ScrollTrigger) {
    console.warn('[halo-focus] ScrollTrigger not found — entrance only')
    load.play()
    return
  }

  // One trigger covers both cases: it fires immediately when the section is already in
  // view (this one is a page header) and waits for the scroll when it isn't.
  ScrollTrigger.create({
    trigger: root,
    start: LOAD_START,
    once: true,
    onEnter: () => load.play(),
  })

  const mm = gsap.matchMedia()
  const branch = (query, v) => {
    mm.add(query, () => {
      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: {
          trigger: root.querySelector('[data-halo-trigger]') || root,
          start: START,
          end: END,
          scrub: v.scrub,
        },
      })
      tl.fromTo(stage, { yPercent: -v.travel }, { yPercent: 0, duration: 1 }, 0)
      if (title) tl.to(title, { opacity: v.dim, duration: 1 }, 0)
      return () => tl.scrollTrigger?.kill()
    })
  }
  branch('(min-width: 768px)', DESKTOP)
  branch(MOBILE_Q, MOBILE)

  // The card's height comes from the device shot, so the start/end positions are only
  // exact once it has landed — main.js refreshes after init, which is before that.
  if (document.readyState !== 'complete')
    window.addEventListener('load', () => ScrollTrigger.refresh(), {
      once: true,
    })
}

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='halo-focus']
 */
export default function (elements) {
  // No GSAP: drop the shared gate rather than waiting out its 4s fail-safe.
  if (!gsap) {
    console.warn('[halo-focus] GSAP not found on window — skipping')
    document.documentElement.classList.remove('js-anim')
    return
  }
  if (ScrollTrigger) gsap.registerPlugin(ScrollTrigger)

  // Reduced motion: lift the gate, leave everything visible — no split, no animation.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    elements.forEach((root) => gsap.set(root, { opacity: 1 }))
    return
  }

  elements.forEach(setupHaloFocus)
}
