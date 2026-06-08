/*
Component: title-animation
Webflow attribute: data-title-animation="True"

Per-word de-blur reveal for any heading/text, matching the paradigm text effect.
Add data-title-animation="True" to the element (or its rich-text wrapper); the
component finds the heading(s)/paragraph(s) inside, splits them into words, and
reveals them with a blur→sharp, rise + fade stagger.

Fires once via ScrollTrigger: if the element is already in view on load (e.g. a
hero title) it plays on load; otherwise it plays when scrolled into view — so a
single setup covers both scenarios.

GSAP + ScrollTrigger are expected as globals (loaded site-wide in Webflow). The
word spans are styled inline from JS (see ../utils/word-reveal.js), so no CSS
needs to live in Webflow.
*/

import { REVEAL_FROM, REVEAL_TO, splitElement } from '../utils/word-reveal.js'

const { gsap, ScrollTrigger } = window

// Extra delay per marked element that shares a <section>, so multiple titles in
// the same section cascade instead of firing at once.
const STAGGER_BETWEEN = 0.15

/**
 * @param {HTMLElement[]} elements - All elements matching [data-title-animation='True']
 */
export default function (elements) {
  if (!gsap || !ScrollTrigger) {
    console.warn(
      '[title-animation] GSAP / ScrollTrigger not found on window — skipping'
    )
    return
  }
  gsap.registerPlugin(ScrollTrigger)

  // Reduced motion: leave the text untouched (no split, no animation). The
  // anti-FOUC gate is never added in this case, so titles stay visible.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  // 1) Split every target and set the hidden/blurred start state up front.
  const prepared = elements
    .map((el) => ({ el, words: splitElement(el) }))
    .filter((p) => p.words.length)
  prepared.forEach(({ words }) => gsap.set(words, REVEAL_FROM))

  // 2) Lift the anti-FOUC gate locally (per element, not the global class) so
  //    other gated components stay hidden until they're ready. Parents become
  //    visible but show nothing — their words are still hidden — so no flash.
  prepared.forEach(({ el }) => gsap.set(el, { opacity: 1 }))

  // 3) Build the reveals. once: an already-in-view title (hero) fires on load;
  //    one below the fold fires when scrolled into view. Multiple marked
  //    elements in the SAME <section> cascade — each subsequent one gets an
  //    extra delay so they stagger in sequence (no effect when far apart).
  const countPerSection = new Map()
  prepared.forEach(({ el, words }) => {
    const section = el.closest('section')
    const i = section ? countPerSection.get(section) || 0 : 0
    if (section) countPerSection.set(section, i + 1)
    gsap.to(words, {
      ...REVEAL_TO,
      delay: i * STAGGER_BETWEEN,
      scrollTrigger: { trigger: el, start: 'top 85%', once: true },
    })
  })
  ScrollTrigger.refresh() // recalc start positions now that the DOM changed
}
