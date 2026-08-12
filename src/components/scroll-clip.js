/*
  Component: scroll-clip · data-component="scroll-clip"
  Scrubbed clip-path reveal: an inset() window opens to 100% of the box as the section
  crosses the viewport. The content never scales — it's uncovered, not resized.
  No CSS file · Docs → .claude/rules/components/scroll-clip.md
*/

const { gsap, ScrollTrigger } = window

// Root defaults — each overridable with data-scroll-clip-* on the root.
const DEFAULTS = {
  from: 0.88, // window size at the start, as a fraction of the box; 1 = no reveal
  start: 'top 92%', // section top just inside the viewport bottom…
  end: 'top 32%', // …to 32% down — a ~60vh travel, independent of the section's height
  scrub: 1.2, // seconds of catch-up — this is the smoothness knob, see the doc
}

const TARGET = '[data-scroll-clip]'

// inset() resolves percentages PER AXIS (top/bottom off height, left/right off width), so a
// single value keeps the window's aspect identical to the box's at every frame — a video
// frame always reads as a video frame. A uniform px inset would let the window's shape drift.
function insetFor(from, radius) {
  const i = (((1 - from) / 2) * 100).toFixed(3)
  return `inset(${i}% ${i}% ${i}% ${i}% round ${radius})`
}

function setupScrollClip(root) {
  const target = root.matches(TARGET) ? root : root.querySelector(TARGET)
  if (!target) {
    console.warn(
      '[scroll-clip] no [data-scroll-clip] inside the root — skipping',
      root
    )
    return
  }

  const from = num(root, 'data-scroll-clip-from', DEFAULTS.from)
  if (from === 1) return // opted out — nothing to animate

  // The authored corner radius is carried into the clip, or the inset edges cut square
  // corners over a rounded box. `inset() round` takes border-radius syntax verbatim.
  const radius = getComputedStyle(target).borderRadius || '0px'

  gsap.fromTo(
    target,
    { clipPath: insetFor(from, radius) },
    {
      clipPath: insetFor(1, radius),
      ease: 'none', // scrubbed: the scroll IS the easing
      // Promotes the element to its own layer, so re-clipping composites instead of
      // repainting the poster every frame. Dropped once the reveal is done — a permanent
      // layer on a full-width image is memory nobody is using.
      willChange: 'clip-path',
      scrollTrigger: {
        // The SECTION is the trigger, never the clipped element — a trigger measures itself
        // with getBoundingClientRect(), so anything that animates its own box drifts.
        trigger: root,
        start: clamped(str(root, 'data-scroll-clip-start', DEFAULTS.start)),
        end: clamped(str(root, 'data-scroll-clip-end', DEFAULTS.end)),
        scrub: num(root, 'data-scroll-clip-scrub', DEFAULTS.scrub),
        onLeave: () => gsap.set(target, { willChange: 'auto' }),
        onEnterBack: () => gsap.set(target, { willChange: 'clip-path' }),
      },
    }
  )
}

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
// very top or bottom still opens fully instead of stranding the window half-closed.
function clamped(value) {
  return value.includes('clamp(') ? value : `clamp(${value})`
}

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='scroll-clip']
 */
export default function (elements) {
  if (!gsap || !ScrollTrigger) {
    console.warn(
      '[scroll-clip] GSAP or ScrollTrigger not found on window — skipping'
    )
    return
  }

  // Reduced motion: nothing is set, so the element renders fully uncovered from frame one.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  gsap.registerPlugin(ScrollTrigger)
  elements.forEach(setupScrollClip)

  // The poster is loading="lazy", so the section's height (and therefore the trigger's
  // start/end) is only final once it lands. main.js refreshes after init, which is earlier.
  if (document.readyState !== 'complete')
    window.addEventListener('load', () => ScrollTrigger.refresh(), {
      once: true,
    })
}
