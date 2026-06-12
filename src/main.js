import components from './components.js'

function getComponentName(selector) {
  // Prefer the data-component value; fall back to the data-* attribute name so
  // components keyed on a custom attribute (e.g. [data-title-animation='True'])
  // still log a meaningful name instead of "unknown".
  const named = selector.match(/data-component=['"](.*?)['"]/)
  if (named) return named[1]
  const attr = selector.match(/data-([\w-]+)/)
  return attr ? attr[1] : 'unknown'
}

// ── Debounce helper ──────────────────────────────────────────────────
function debounce(fn, ms) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

// ── Breakpoint detection ─────────────────────────────────────────────
// Values mirror Webflow's built-in breakpoints (min-width of each range):
//   1920 → 2XL          (≥ 1920px)
//   1440 → XL           (1440–1919px)
//   1280 → Large        (1280–1439px)
//    992 → Desktop      (992–1279px)  ← base breakpoint
//    768 → Tablet       (768–991px)
//    480 → Mobile Landscape  (480–767px)
//      0 → Mobile Portrait   (< 480px)
const breakpoints = [1920, 1440, 1280, 992, 768, 480]

function getCurrentBreakpoint() {
  const w = window.innerWidth
  for (const bp of breakpoints) {
    if (w >= bp) return bp
  }
  return 0 // Mobile Portrait
}

let currentBreakpoint = getCurrentBreakpoint()

const activeComponents = []

async function loadComponent({ selector, importFn }) {
  const componentName = getComponentName(selector)
  try {
    const elements = document.querySelectorAll(selector)
    if (elements.length === 0) return
    const module = await importFn()

    if (typeof module.default === 'function') {
      console.log(
        `%c⚡ [main.js] Loading ${componentName}`,
        'color: #a78bfa; font-weight: bold'
      )
      const result = module.default(Array.from(elements))

      if (result && typeof result === 'object') {
        activeComponents.push({ name: componentName, hooks: result })
      }
    } else {
      console.warn(
        `%c⚠️ [main.js] No valid default function found in ${componentName}.js`,
        'color: #fbbf24; font-weight: bold'
      )
    }
  } catch (error) {
    console.error(
      `%c❌ [main.js] Failed to load ${componentName}:`,
      'color: #f87171; font-weight: bold',
      error
    )
  }
}

// ── Lifecycle hooks ──────────────────────────────────────────────────
// Mobile browsers fire 'resize' whenever the address bar shows/hides — the
// viewport HEIGHT changes but the WIDTH doesn't. Those must NOT run the resize
// hooks: components like scroll-morph call the expensive ScrollTrigger.refresh()
// there, which stalled scroll (100ms+) on every address-bar tick. So we only react
// to real, width-changing resizes (orientation flip, desktop window resize).
// Layout/canvas sizing keys off width; a height-only change is safe to ignore.
let lastWidth = window.innerWidth
window.addEventListener(
  'resize',
  debounce(() => {
    if (window.innerWidth === lastWidth) return // height-only (mobile address bar) — skip
    lastWidth = window.innerWidth

    activeComponents.forEach(({ hooks }) => {
      if (typeof hooks.resize === 'function') hooks.resize()
    })

    const newBreakpoint = getCurrentBreakpoint()
    if (newBreakpoint !== currentBreakpoint) {
      const prev = currentBreakpoint
      currentBreakpoint = newBreakpoint
      activeComponents.forEach(({ hooks }) => {
        if (typeof hooks.breakpoint === 'function')
          hooks.breakpoint(newBreakpoint, prev)
      })
    }
  }, 150)
)

// ── Init ─────────────────────────────────────────────────────────────
function init() {
  ;(async () => {
    try {
      const module = await import('./components/global.js')
      if (typeof module.default === 'function') {
        console.log(
          '%c🌍 [main.js] Loading global function',
          'color: #a78bfa; font-weight: bold'
        )
        module.default()
      } else {
        console.warn(
          '%c⚠️ [main.js] No valid default function found in global.js',
          'color: #fbbf24; font-weight: bold'
        )
      }
    } catch (error) {
      console.error(
        '%c❌ [main.js] Failed to load global function:',
        'color: #f87171; font-weight: bold',
        error
      )
    }
    await Promise.all(components.map(loadComponent))

    // Components load in parallel, so any ScrollTriggers they create (e.g. the
    // pinned paradigm + scroll-morph sections) are registered in a non-
    // deterministic order. Each component refreshes on its own init, but those
    // intermediate refreshes run before every pin exists, so pin-spacing can be
    // miscalculated (a section pins at the wrong offset → jump / overlap). One
    // authoritative refresh here, after every component is initialised, lets
    // ScrollTrigger recompute all pins together in page order. Pinned sections
    // also set `refreshPriority` so the higher one is calculated first.
    if (window.ScrollTrigger) window.ScrollTrigger.refresh()
  })()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
