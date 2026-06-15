/*
  Component: number-counter · data-component="number-counter"
  Smooth count-up on scroll into view. Target read from the element's text (or
  data-count-to); prefix/suffix/separators/duration via data-count-* attributes.
  No CSS · Docs → .claude/rules/components/number-counter.md
*/

const { gsap } = window
const ScrollTrigger = window.ScrollTrigger

const SEPARATOR = ',' // default thousands separator
const DECIMAL = '.' // default decimal separator
const DURATION = 2 // seconds
const EASE = 'power2.out'
const START = 'top 85%' // ScrollTrigger start — fires when the element scrolls in

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

// Read an attribute, falling back when absent or empty.
const attr = (el, name, fallback) => {
  const v = el.getAttribute(name)
  return v === null || v === '' ? fallback : v
}

// Parse a human number string into { value, decimals }, honoring the configured
// thousands + decimal separators (so "1.900,5" with sep="." dec="," works too).
function parse(raw, separator, decimal) {
  let s = String(raw == null ? '' : raw).trim()
  if (separator) s = s.split(separator).join('')
  if (decimal && decimal !== '.') s = s.split(decimal).join('.')
  s = s.replace(/[^0-9.-]/g, '')
  const value = parseFloat(s)
  const decimals = s.includes('.') ? s.split('.')[1].length : 0
  return { value, decimals }
}

// Format a number with grouping + prefix/suffix.
function format(value, decimals, separator, decimal, prefix, suffix) {
  const neg = value < 0
  const fixed = Math.abs(value).toFixed(decimals)
  const dot = fixed.indexOf('.')
  let int = dot === -1 ? fixed : fixed.slice(0, dot)
  const frac = dot === -1 ? '' : fixed.slice(dot + 1)
  int = int.replace(/\B(?=(\d{3})+(?!\d))/g, separator)
  return (
    prefix +
    (neg ? '-' : '') +
    int +
    (decimals > 0 ? decimal + frac : '') +
    suffix
  )
}

function setup(el) {
  const separator = attr(el, 'data-count-separator', SEPARATOR)
  const decimal = attr(el, 'data-count-decimal', DECIMAL)
  const prefix = attr(el, 'data-count-prefix', '')
  const suffix = attr(el, 'data-count-suffix', '')
  const duration =
    parseFloat(attr(el, 'data-count-duration', DURATION)) || DURATION

  const { value: target, decimals } = parse(
    attr(el, 'data-count-to', el.textContent),
    separator,
    decimal
  )
  if (!Number.isFinite(target)) {
    console.warn('[number-counter] could not parse a number from', el)
    return
  }

  const fromAttr = attr(el, 'data-count-from', null)
  const from =
    fromAttr === null ? 0 : parse(fromAttr, separator, decimal).value || 0

  const render = (v) =>
    (el.textContent = format(v, decimals, separator, decimal, prefix, suffix))

  // Reduced motion: show the final value, no animation.
  if (reduceMotion.matches) {
    render(target)
    return
  }

  render(from) // start state (avoids a flash of the raw markup number)
  const proxy = { v: from }
  gsap.to(proxy, {
    v: target,
    duration,
    ease: EASE,
    scrollTrigger: { trigger: el, start: START, once: true },
    onUpdate: () => render(proxy.v),
    onComplete: () => render(target), // land on the exact value
  })
}

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='number-counter']
 */
export default function (elements) {
  if (!gsap || !ScrollTrigger) {
    console.warn('[number-counter] GSAP / ScrollTrigger not found — skipping')
    return
  }
  gsap.registerPlugin(ScrollTrigger)
  elements.forEach(setup)
}
