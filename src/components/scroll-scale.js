/*
  Component: scroll-scale · data-component="scroll-scale"
  Scrubbed scale: the marked child grows from data-scroll-scale-from to 1 (100% of its
  container) as the section crosses the viewport. Transform only — no layout, no reflow.
  No CSS file · Docs → .claude/rules/components/scroll-scale.md
*/

const { gsap, ScrollTrigger } = window

// Root defaults — each overridable with data-scroll-scale-* on the root.
const DEFAULTS = {
  from: 0.86, // starting scale; 1 = no growth
  start: 'top 90%', // section top near the viewport bottom
  end: 'top 40%', // …to 40% down — a ~50vh travel, independent of the section's height
  scrub: 0.6, // seconds of catch-up; 0 = locked to the scrollbar
  origin: 'center center',
}

const TARGET = '[data-scroll-scale]'

function num(el, attr, fallback) {
  const raw = el.getAttribute(attr)
  if (raw === null || raw.trim() === '') return fallback
  const n = parseFloat(raw)
  return Number.isFinite(n) ? n : fallback
}

function str(el, attr, fallback) {
  const raw = el.getAttribute(attr)
  return raw && raw.trim() ? raw.trim() : fallback
}

// clamp() keeps start/end inside the page's scrollable range, so a section sitting at the
// very top or bottom still completes instead of stranding the scale mid-way.
function clamped(value) {
  return value.includes('clamp(') ? value : `clamp(${value})`
}

function setupScrollScale(root) {
  const target = root.matches(TARGET) ? root : root.querySelector(TARGET)
  if (!target) {
    console.warn(
      '[scroll-scale] no [data-scroll-scale] inside the root — skipping',
      root
    )
    return
  }

  const from = num(root, 'data-scroll-scale-from', DEFAULTS.from)
  if (from === 1) return // opted out — nothing to animate

  gsap.fromTo(
    target,
    { scale: from },
    {
      scale: 1,
      transformOrigin: str(root, 'data-scroll-scale-origin', DEFAULTS.origin),
      ease: 'none', // scrubbed: the scroll IS the easing
      scrollTrigger: {
        // The SECTION is the trigger, never the scaled element: ScrollTrigger measures
        // getBoundingClientRect(), which includes the transform, so a self-triggering
        // element would compute start/end off its own shrunken box.
        trigger: root,
        start: clamped(str(root, 'data-scroll-scale-start', DEFAULTS.start)),
        end: clamped(str(root, 'data-scroll-scale-end', DEFAULTS.end)),
        scrub: num(root, 'data-scroll-scale-scrub', DEFAULTS.scrub),
      },
    }
  )
}

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='scroll-scale']
 */
export default function (elements) {
  if (!gsap || !ScrollTrigger) {
    console.warn(
      '[scroll-scale] GSAP or ScrollTrigger not found on window — skipping'
    )
    return
  }

  // Reduced motion: nothing is set, so the element renders at its natural 100%.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  gsap.registerPlugin(ScrollTrigger)
  elements.forEach(setupScrollScale)

  // The poster is loading="lazy", so the section's height (and therefore the trigger's
  // start/end) is only final once it lands. main.js refreshes after init, which is earlier.
  if (document.readyState !== 'complete')
    window.addEventListener('load', () => ScrollTrigger.refresh(), {
      once: true,
    })
}
