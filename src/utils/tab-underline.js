/*
  Shared tab-underline fill helpers — the injected black bar the tabs components scale
  over their grey track. Kept here so paradigm / tabs-architected / tabs-imaging /
  tabs-foundation-model / tabs-stats can't drift apart.
  Docs → each component's .md (they own their own timing).
*/

const { gsap } = window

// Minimum visible fill. A bar at true 0 paints nothing, so a tab paused at the very start
// of its segment (hover pause) reads as "the underline is broken". ~2px of ink instead.
// Measured in px, not %: 1% of a 40px paradigm number is sub-pixel and still invisible.
const MIN_PX = 2
const FLOOR_MAX = 0.35 // never let the stub swallow a very narrow track
const FLOOR_FALLBACK = 0.01 // track not laid out yet (measures 0)
// Outgoing bar: fades out where it stands. Retracting it (scaleX → 0) read as the progress
// rewinding while the next tab was already filling forwards.
const FILL_OUT = {
  opacity: 0,
  duration: 0.35,
  ease: 'power2.out',
  overwrite: true,
}

// Floor per bar, measured once per arm — `fillTo` runs every frame, so it must never read
// layout itself.
const floors = new WeakMap()

const clamp01 = (n) => Math.min(1, Math.max(0, n))

function measureFloor(bar) {
  const w = bar.parentElement?.offsetWidth || 0
  return w ? Math.min(FLOOR_MAX, MIN_PX / w) : FLOOR_FALLBACK
}

// Arm a bar for its own fill: at the floor + fully opaque, dropping any fade still running
// on it (a switch back inside the FILL_OUT window would otherwise leave it half-transparent
// and fight the per-frame `fillTo`). Re-measures the floor, so a breakpoint change
// self-corrects on the next switch.
export function armFill(bar) {
  if (!bar) return
  gsap.killTweensOf(bar)
  floors.set(bar, measureFloor(bar))
  gsap.set(bar, {
    scaleX: floors.get(bar),
    opacity: 1,
    transformOrigin: 'left center',
  })
}

// Progress 0→1 mapped above the floor, so the bar is visible from its first frame.
export function fillTo(bar, progress) {
  if (!bar) return
  const f = floors.get(bar) ?? 0
  gsap.set(bar, { scaleX: f + clamp01(progress) * (1 - f) })
}

// Full bar, immediately — a state indicator with nothing to time.
export function fillFull(bar) {
  if (!bar) return
  gsap.killTweensOf(bar)
  gsap.set(bar, { scaleX: 1, opacity: 1, transformOrigin: 'left center' })
}

// Outgoing bar: fade out at its current width, then snap back to empty once invisible
// (ready for its next turn). A bar that's already empty is just left opaque.
export function fadeOutFill(bar) {
  if (!bar) return
  if (gsap.getProperty(bar, 'scaleX') === 0)
    return gsap.set(bar, { opacity: 1 })
  gsap.to(bar, {
    ...FILL_OUT,
    onComplete: () => gsap.set(bar, { scaleX: 0, opacity: 1 }),
  })
}

// Instant empty (no fade) — for the components whose inactive bars just clear.
export function clearFill(bar) {
  if (!bar) return
  gsap.killTweensOf(bar)
  gsap.set(bar, { scaleX: 0, opacity: 1, transformOrigin: 'left center' })
}
