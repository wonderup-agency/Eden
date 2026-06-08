/*
Component: hero
Webflow attribute: data-component="hero"

Orchestrates the hero entrance in one master timeline on load: the video fades +
scales in, the heading de-blurs per word, the divider draws, the paragraph
de-blurs, and the buttons rise — each overlapping for a smooth, subtle reveal.

Reuses the word de-blur from ../utils/word-reveal.js (same effect as paradigm /
title-animation), so the hero's texts should NOT also carry data-title-animation.
GSAP is expected as a global (loaded site-wide in Webflow).

Hooks (all optional except the root — the timeline includes whatever is present):
  data-component="hero"  → section_hero (root)
  data-hero-visual       → the video / visual wrapper
  data-hero-heading      → the heading (or its rich-text wrapper)
  data-hero-divider      → the divider line (animated via scaleX)
  data-hero-text         → the paragraph (or its rich-text wrapper)
  data-hero-buttons      → the buttons wrapper (its direct children stagger)
*/

import { REVEAL_FROM, REVEAL_TO, splitElement } from '../utils/word-reveal.js'

const { gsap } = window

function setupHero(root) {
  const q = (sel) => root.querySelector(sel)
  const visual = q('[data-hero-visual]')
  const heading = q('[data-hero-heading]')
  const divider = q('[data-hero-divider]')
  const text = q('[data-hero-text]')
  const buttonsWrap = q('[data-hero-buttons]')
  const buttons = buttonsWrap ? Array.from(buttonsWrap.children) : []

  const headingWords = heading ? splitElement(heading) : []
  const textWords = text ? splitElement(text) : []

  // Start states — small movements, gentle: subtle but smooth.
  if (visual)
    gsap.set(visual, {
      autoAlpha: 0,
      scale: 1.06,
      transformOrigin: 'center center',
    })
  if (headingWords.length) gsap.set(headingWords, REVEAL_FROM)
  if (divider) gsap.set(divider, { scaleX: 0, transformOrigin: 'left center' })
  if (textWords.length) gsap.set(textWords, REVEAL_FROM)
  if (buttons.length) gsap.set(buttons, { autoAlpha: 0, y: 12 })

  // Lift the anti-FOUC gate now that everything is hidden (local, not the global
  // class — see title-animation): the hero becomes visible but shows nothing yet.
  gsap.set(root, { opacity: 1 })

  // Master timeline — absolute positions overlap each step for a continuous flow:
  // video settles → heading sharpens → divider draws → paragraph → buttons rise.
  const tl = gsap.timeline({ defaults: { ease: 'power2.out' } })
  if (visual) tl.to(visual, { autoAlpha: 1, scale: 1, duration: 1.4 }, 0)
  if (headingWords.length) tl.to(headingWords, { ...REVEAL_TO }, 0.15)
  if (divider) tl.to(divider, { scaleX: 1, duration: 0.6 }, 0.55)
  if (textWords.length) tl.to(textWords, { ...REVEAL_TO, duration: 0.9 }, 0.65)
  if (buttons.length)
    tl.to(buttons, { autoAlpha: 1, y: 0, duration: 0.7, stagger: 0.08 }, 1.0)
  return tl
}

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='hero']
 */
export default function (elements) {
  if (!gsap) {
    console.warn('[hero] GSAP not found on window — skipping')
    return
  }

  // Reduced motion: lift the gate, leave everything visible, no animation.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    elements.forEach((root) => gsap.set(root, { opacity: 1 }))
    return
  }

  elements.forEach(setupHero)
}
