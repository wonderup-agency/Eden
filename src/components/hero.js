/*
  Component: hero · data-component="hero"
  Hero entrance master timeline on load: visual block fades/scales in, heading + paragraph
  de-blur per word, divider draws, buttons rise. Reuses ../utils/word-reveal.js.
  No CSS file (styled inline). Docs → .claude/rules/components/hero.md
*/

import { REVEAL_FROM, REVEAL_TO, splitElement } from '../utils/word-reveal.js'

const { gsap } = window

function setupHero(root) {
  const q = (sel) => root.querySelector(sel)
  const visual = q('[data-hero-visual]')
  // Animate the visual's wrapper (background + video as one unit), not the video
  // atom alone, so the background reveals with it. Falls back to the visual itself.
  const visualBlock = (visual && visual.parentElement) || visual
  const heading = q('[data-hero-heading]')
  const divider = q('[data-hero-divider]')
  const text = q('[data-hero-text]')
  const buttonsWrap = q('[data-hero-buttons]')
  const buttons = buttonsWrap ? Array.from(buttonsWrap.children) : []

  const headingWords = heading ? splitElement(heading) : []
  const textWords = text ? splitElement(text) : []

  // Start states — small movements, gentle: subtle but smooth.
  if (visualBlock)
    gsap.set(visualBlock, {
      autoAlpha: 0,
      scale: 1.06,
      transformOrigin: 'center center',
    })
  if (headingWords.length) gsap.set(headingWords, REVEAL_FROM)
  if (divider) gsap.set(divider, { scaleX: 0, transformOrigin: 'left center' })
  if (textWords.length) gsap.set(textWords, REVEAL_FROM)
  if (buttons.length) gsap.set(buttons, { autoAlpha: 0, y: 12 })

  // Lift the anti-FOUC gate locally now that everything is hidden (shows nothing yet).
  gsap.set(root, { opacity: 1 })

  // Master timeline — overlapping steps: video → heading → divider → paragraph → buttons.
  const tl = gsap.timeline({ defaults: { ease: 'power2.out' } })
  if (visualBlock)
    tl.to(visualBlock, { autoAlpha: 1, scale: 1, duration: 1.4 }, 0)
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
