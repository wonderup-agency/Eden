/*
  Shared tab-underline fill helpers — the injected black bar the tabs components scale
  over their grey track. Kept here so paradigm / tabs-architected / tabs-imaging /
  tabs-foundation-model / tabs-stats can't drift apart.
  Docs → each component's .md (they own their own timing).
*/

const { gsap } = window

// Minimum visible fill. A bar at true 0 paints nothing, so a tab whose clock is paused at
// the very start of its segment reads as "the underline is broken". ~2px of ink instead.
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
// Locked bar: completes to full and stays there.
const FILL_LOCK = {
  scaleX: 1,
  opacity: 1,
  duration: 0.35,
  ease: 'power2.out',
  overwrite: true,
}

function measureFloor(bar) {
  const w = bar.parentElement?.offsetWidth || 0
  return w ? Math.min(FLOOR_MAX, MIN_PX / w) : FLOOR_FALLBACK
}

// Arm a bar for its own fill: at the floor + fully opaque, dropping any fade still running
// on it (a switch back inside the FILL_OUT window would otherwise leave it half-transparent
// and fight the progress tween that follows). Re-measures the floor, so a breakpoint change
// self-corrects on the next switch. The caller then tweens scaleX floor → 1 over the dwell.
export function armFill(bar) {
  if (!bar) return
  gsap.killTweensOf(bar)
  gsap.set(bar, {
    scaleX: measureFloor(bar),
    opacity: 1,
    transformOrigin: 'left center',
  })
}

// Lock: run the bar to full and leave it there — the click signal that the cycle stops on
// this tab. Tweened from wherever it stands (so it never rewinds) and short enough to read
// as feedback rather than as progress.
// The caller MUST pause its clock first: `overwrite` kills the timeline's own bar tween,
// and a timeline emptied while still playing fires onComplete on the next tick.
export function lockFill(bar) {
  if (!bar) return
  gsap.to(bar, { ...FILL_LOCK, transformOrigin: 'left center' })
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
