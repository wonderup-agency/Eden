import { s as splitElement, R as REVEAL_FROM, a as REVEAL_TO } from './word-reveal-D8bOuPxk.js';

/*
  Component: title-animation · data-title-animation="True"
  Per-word de-blur reveal for any heading/text (same effect as paradigm). Fires once
  via ScrollTrigger — on load if already in view, else on scroll-in.
  No CSS file (styled inline). Docs → .claude/rules/components/title-animation.md
*/


const { gsap, ScrollTrigger } = window;

// Extra delay per marked element sharing a <section> (cascade within a section).
const STAGGER_BETWEEN = 0.15;

/**
 * @param {HTMLElement[]} elements - All elements matching [data-title-animation='True']
 */
function titleAnimation (elements) {
  if (!gsap || !ScrollTrigger) {
    console.warn(
      '[title-animation] GSAP / ScrollTrigger not found on window — skipping'
    );
    return
  }
  gsap.registerPlugin(ScrollTrigger);

  // Reduced motion: leave the text untouched (gate is never added, titles stay visible).
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  // 1) Split every target and set the hidden/blurred start state.
  const prepared = elements
    .map((el) => ({ el, words: splitElement(el) }))
    .filter((p) => p.words.length);
  prepared.forEach(({ words }) => gsap.set(words, REVEAL_FROM));

  // 2) Lift the anti-FOUC gate per element (words still hidden → no flash).
  prepared.forEach(({ el }) => gsap.set(el, { opacity: 1 }));

  // 3) Build the reveals (once). Marked elements in the same <section> cascade
  //    via an extra per-index delay.
  const countPerSection = new Map();
  prepared.forEach(({ el, words }) => {
    const section = el.closest('section');
    const i = section ? countPerSection.get(section) || 0 : 0;
    if (section) countPerSection.set(section, i + 1);
    gsap.to(words, {
      ...REVEAL_TO,
      delay: i * STAGGER_BETWEEN,
      scrollTrigger: { trigger: el, start: 'top 85%', once: true },
    });
  });
  ScrollTrigger.refresh(); // recalc start positions now that the DOM changed
}

export { titleAnimation as default };
//# sourceMappingURL=title-animation-vk9RrM9c.js.map
