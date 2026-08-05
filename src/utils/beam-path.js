/*
  Utility: rounded-rect perimeter → conic-gradient angle stops.
  A conic-gradient sweeps by ANGLE, so a beam driven by a linear angle crawls along the
  middle of the long edges and whips around the corners. These stops re-time the angle so
  equal slices of the lap cover equal PERIMETER — constant speed around the contour.
  Used by initButtonBeams in src/components/global.js · Docs → .claude/rules/components/button.md
*/

const QUARTER = Math.PI / 2

// Rounded rect centered on (0,0), y down, walked clockwise from top center.
// Each segment exposes its length and a point(u) with u in 0..1.
function buildSegments(w, h, r) {
  const hw = w / 2
  const hh = h / 2
  const rad = Math.max(0, Math.min(r, hw, hh))
  const sx = hw - rad // straight run, half the top/bottom edge
  const sy = hh - rad // straight run, half the side edge
  const arc = QUARTER * rad

  // Compass angle: 0 = up, growing clockwise — matches conic-gradient's convention.
  const corner = (cx, cy, from) => (u) => {
    const a = from + u * QUARTER
    return [cx + rad * Math.sin(a), cy - rad * Math.cos(a)]
  }

  return [
    { len: sx, point: (u) => [u * sx, -hh] },
    { len: arc, point: corner(sx, -sy, 0) },
    { len: 2 * sy, point: (u) => [hw, -sy + u * 2 * sy] },
    { len: arc, point: corner(sx, sy, QUARTER) },
    { len: 2 * sx, point: (u) => [sx - u * 2 * sx, hh] },
    { len: arc, point: corner(-sx, sy, Math.PI) },
    { len: 2 * sy, point: (u) => [-hw, sy - u * 2 * sy] },
    { len: arc, point: corner(-sx, -sy, Math.PI + QUARTER) },
    { len: sx, point: (u) => [-sx + u * sx, -hh] },
  ]
}

// The lit wedge is sized in DEGREES, so on its own it covers a wildly different amount of
// border depending on where it sits (2.6x at 120deg on a 200x48 box) — the same unevenness
// the re-timing removes from the speed, reappearing as length. Since the stops are already
// uniform in arc length, "the same perimeter, expressed in degrees from here" is just a
// fixed index shift back through the table.
function addCompensatedArc(stops, steps, arcDeg) {
  const at = (k) => stops[((k % steps) + steps) % steps].deg
  const back = (steps * arcDeg) / 360

  for (let i = 0; i <= steps; i++) {
    const j = i - back
    const lo = Math.floor(j)
    let span = at(lo + 1) - at(lo)
    if (span < 0) span += 360 // the table wraps past 360 once per lap
    const behind = at(lo) + (j - lo) * span
    let arc = stops[i].deg - behind
    if (arc < 0) arc += 360
    // A very wide authored arc on a very wide box can ask for more than a full turn.
    stops[i].arc = Math.min(350, Math.max(1, arc))
  }
}

/**
 * Angle stops for a beam that travels the border at a constant speed.
 * @param {number} w Border-box width (px)
 * @param {number} h Border-box height (px)
 * @param {number} r Corner radius (px)
 * @param {number} steps Samples around the perimeter (more = finer, longer CSS rule)
 * @param {number} [arcDeg] Authored lit wedge (deg). Given, each stop also carries the `arc`
 *   that keeps the wedge a constant LENGTH; omitted, the wedge stays a constant angle.
 * @returns {{offset: number, deg: number, arc?: number}[]|null} offset 0..1 → angle, or null
 */
export function beamAngleStops(w, h, r, steps, arcDeg) {
  if (!(w > 0) || !(h > 0) || !(steps > 1)) return null

  const segs = buildSegments(w, h, r)
  const total = segs.reduce((sum, s) => sum + s.len, 0)
  if (!(total > 0)) return null

  const stops = []
  let seg = 0
  let walked = 0 // perimeter consumed by the segments already passed

  for (let i = 0; i <= steps; i++) {
    const s = (i / steps) * total
    while (seg < segs.length - 1 && s > walked + segs[seg].len) {
      walked += segs[seg].len
      seg++
    }
    const [x, y] = segs[seg].point(
      segs[seg].len ? Math.min(1, (s - walked) / segs[seg].len) : 0
    )
    // atan2(x, -y) puts 0deg at 12 o'clock growing clockwise, like conic-gradient.
    let deg = (Math.atan2(x, -y) * 180) / Math.PI
    if (deg < 0) deg += 360
    // The walk is clockwise from top center, so the angle only ever grows; the last
    // sample lands back on 0 and has to read as a full turn instead.
    if (i === steps) deg = 360
    stops.push({ offset: i / steps, deg })
  }

  if (arcDeg > 0) addCompensatedArc(stops, steps, arcDeg)

  return stops
}
