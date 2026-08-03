/*
  Util: point-shapes · procedural parametric point clouds
  Four generators (loop / lattice / flow / spiral) for the compouding cloud. A shape is not
  a static x/y set: every point keeps its curve coordinates (u along, v across) and is
  EVALUATED PER FRAME, so the motion lives in the parametrization (u wraps → infinite).
  Every number lives in TUNING (mutable at runtime → playground/compouding-shapes).
  Docs → .claude/rules/components/compouding.md
*/

const TAU = Math.PI * 2
// Share of flow's `tipClear` window that is FULLY clear (alpha 0) before the ramp starts —
// the pocket the gold endpoint node sits in.
const TIP_HOLD = 0.42

export const SHAPE_ORDER = ['loop', 'lattice', 'flow', 'spiral']

// Mutable so the playground can tune live. `build` keys are baked when the shape is
// created (changing one needs a rebuild); the rest are read per frame.
// `shim` scales the renderer's ambient shimmer per axis for that shape. It matters most
// where the shape IS lines: the shimmer's amplitude (~0.08 normalized) is bigger than the
// gap between two streamlines (~0.045), so an isotropic shimmer smears them into fog.
// Keeping it along the line (x) and near-zero across it (y) is what makes the lines read.
// `inner` = [sizeBias, alphaBias]: ink gradient from the shape's INSIDE to its OUTSIDE.
// Positive makes the interior dots fatter / darker than the rim, negative flips it. What
// counts as "inside" is per shape: distance across the band (loop), distance from the
// centre thread (lattice), from the flow axis (flow), from the centre (spiral).
export const TUNING = {
  loop: {
    fill: 1, // stage fill, multiplies the renderer's FIT — per shape
    pulse: 1, // scales the renderer's BREATH_AMP (radial breathing) — 0 turns it off
    inner: [0.45, 0.3],
    axisBias: 1.8, // build — >1 packs the dots onto the line's own axis
    shim: [1, 0.5],
    speed: 0.062, // laps per second
    // Speed warp = where the dots bunch up. NEGATIVE slows them at the crossing (denser
    // centre, even lobes — the reference graphic); positive slows them at the outer lobes.
    skew: -0.35,
    band: 0.1, // band thickness around the curve — also sets the ∞'s aspect
    squash: 0.78, // vertical squash: a true lemniscate is taller than the reference ∞
    crossSpread: 2.6, // extra thickness at the crossing (the wide diffuse X)
    crossFade: 0, // how much lighter the crossing reads (0 = same ink as the lobes)
  },
  lattice: {
    fill: 0.85,
    pulse: 1, // radial breathing ×  (its own `breath` below is a different thing: node pinch)
    // dep here is the offset inside the thread's OWN band, so this darkens each of the four
    // axes and softens their edges (using the distance to the middle thread instead would
    // just make the inner threads darker than the outer ones).
    inner: [0.5, 0.4],
    axisBias: 2.6, // build
    shim: [1, 0.1],
    threads: 4, // build
    gap: 0.2, // separation between threads at rest (sets the aspect)
    band: 0.026, // per-thread thickness — thin keeps them reading as LINES
    // Nodes across the width (zeros of the shared cosine). Ring width ≈ 1/k, so this also
    // decides whether the rings read circular (matching the band height) or squeezed.
    // Snapped at sample time so a wave PEAK lands exactly where the braid window opens —
    // otherwise the threads enter the braid mid-oscillation and the straight ends splay.
    k: 4.4,
    travel: 0.045, // crossings/sec — particles FLOW left→right through the lattice
    travelVar: 0.25, // per-thread speed spread (outer threads lag) → it reads alive
    edge: 0.05, // fade at both ends, so the travel wrap is invisible
    phaseSpeed: 0.06, // rad/s — slow drift of the node pattern itself (0 = fixed nodes)
    phaseOffset: 0, // per-thread phase shift (0 = shared nodes / nested lenses)
    // 1 = |cos| : each thread stays on its own side of the axis → flat chain of rings.
    // 0 = cos : threads swap sides at every node, which reads as a twisting 3-D ribbon.
    fold: 1,
    window: [0.06, 0.42], // braid window: 0 at the edges (parallel), 1 mid
    breath: 0.1,
    breathSpeed: 0.31,
    h2: 0, // secondary harmonic amount (0 = clean single wave)
    k2: 1.4,
  },
  flow: {
    fill: 1,
    // No radial breathing here: the lens is anchored to two fixed labelled endpoints, so a
    // pulse that grows/shrinks the whole shape reads as the cities moving. The streamlines
    // already carry the motion.
    pulse: 0,
    inner: [0.6, 0.5], // per streamline: fat + dark on its axis, thin + faint at its edges
    axisBias: 2.4, // build — the streamline ribbons carry their ink on the centreline
    shim: [1, 0.08],
    // Crossings per second on the centre line. BIDIRECTIONAL: the top half runs in this
    // direction (left→right, São Paulo → Texas) and the bottom half always runs opposite,
    // so the lens reads as traffic going both ways. A negative value mirrors both halves.
    speed: 0.085,
    shear: 0.55, // outer streamlines run this much slower → fluid, not a slab
    // Slows the particles near both tips, so ink piles up there the way it does in the
    // reference (where every streamline converges into the node).
    tipSlow: 0.6,
    h: 0.3, // lens half-height at the centre
    lines: 10, // build — discrete streamlines
    lineBias: 1.15, // >1 packs the streamlines toward the axis
    jitter: 0.03, // build — thickness of each streamline ribbon
    flat: 2.6, // profile flatness: high = long horizontal runs
    tip: 0.9, // profile tip: <1 sharpens the two points
    edge: 0.07, // fade in/out at both tips, so the recycle is invisible
    // Clears the last fraction of the half-width so the streamlines DISSOLVE into the gold
    // node instead of piling over it. `edge` can't do this: it fades by path parameter, and
    // tipSlow makes a wide band of the parameter land on the tip at full alpha. The inner
    // TIP_HOLD of this window is fully clear (see the sample) — sized to the node's halo.
    tipClear: 0.13,
    // Static dark core (the black ellipse some versions of the graphic have). OFF by
    // default: at a low share it reads as a stray clump in the middle rather than a core.
    coreFrac: 0, // build — share of points forming the core
    coreRx: 0.11, // build
    coreRy: 0.028, // build
  },
  spiral: {
    fill: 1,
    pulse: 1, // radial breathing ×
    // Negative: the arm THINS and FADES toward the centre (the reference carries its grain
    // on the outer turns and tapers to a hairline inside).
    inner: [-0.5, -0.45],
    coreFade: 0.24, // radius under which the arm tapers away (must be > 1/growth)
    axisBias: 1.6, // build
    shim: [0.45, 0.45],
    // Density toward the rim. A warp, not a distribution: points move fast through the
    // inner turns and crawl on the outer ones, so the density pattern stays PUT while they
    // travel (biasing the distribution instead would make the dense band orbit the spiral).
    warp: 0.6,
    // READABLE turns ≈ turns × (−ln(coreFade)/ln(growth)) — the inner ones taper away, so
    // `turns` alone doesn't decide what you see. 5 / 6 / 0.24 leaves ~4 readable turns, each
    // ~1.43× the radius of the one inside it (band 0.15 → they never touch).
    // `coreFade` must stay ABOVE the innermost radius (1/growth) or there is no taper.
    turns: 5, // build
    growth: 6, // outer radius / inner radius (per-turn spacing)
    // Positive = outward (points born at the centre, drifting out to the rim, like a galaxy
    // throwing its arms out). Negative reverses it to inward. Either way it never ends —
    // both ends of the path are fade-gated (`edge` + `coreFade`), so the recycle is
    // invisible in both directions; only the reading changes.
    speed: 0.045, // full traversals per second (also the apparent spin)
    // Which way the arm winds, independent of `speed` (= where the points travel). Mirrors
    // the angle only, so the disc keeps the `tilt` / `lean` inclination authored below.
    // Like those two it reads live but moves the shape's EXTENTS, so the stage fit only
    // catches up on the next makeShape (a rebuild slider in the playground).
    spin: -1,
    // Inclination — the disc seen at an angle instead of face-on. `tilt` foreshortens the
    // minor axis (1 = a flat circle seen head-on, lower = closer to edge-on) and `lean`
    // then rotates that ellipse. Applied AFTER the band, so the arm's thickness
    // foreshortens with the disc rather than staying a constant-width ribbon.
    // They read live, but they change the shape's extents — so the stage fit only catches
    // up on the next `makeShape` (the playground rebuilds on these two).
    tilt: 0.62,
    lean: -20, // degrees; negative tips the major axis UP to the right
    // The reference's outer arm is a WIDE granulated band, not a line — this is what
    // separates "spiral of dust" from "spiral drawn with dots".
    band: 0.15, // thickness scales with radius → granulated outside
    bandMin: 0.006,
    edge: 0.06,
  },
}

const MEASURE_TIMES = [0, 0.29, 0.73, 1.6, 3.1, 5.7, 9.3, 14.1]

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

// Box-Muller, clamped — a band reads softer than a uniform spread.
function gauss(rng) {
  const u = Math.max(1e-6, rng())
  return clamp(
    Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rng()) * 0.42,
    -1,
    1
  )
}

// Pulls a band offset toward the line's own axis (bias > 1 = denser centreline, which is
// where the reference graphics carry their intensity). Build-time: no per-frame cost.
function axisPack(v, bias) {
  return bias === 1 ? v : Math.sign(v) * Math.pow(Math.abs(v), bias)
}

// Two shapes need a power/exp per point, which dominated the frame at high point counts.
// Both depend only on the along-curve parameter, so they're tabulated once per tuning
// change (256 steps — finer than a pixel at any stage size) and looked up per point.
function lutN(n, fill) {
  const t = new Float32Array(n + 1)
  for (let i = 0; i <= n; i++) t[i] = fill(i / n)
  return t
}
function lut256(fill) {
  return lutN(256, fill)
}

// Ink gradient helper: dep 0 = the shape's interior, 1 = its outer edge. Writes the size
// multiplier and scales the alpha, so one knob pair per shape controls both.
function applyInner(out, inner, dep) {
  const k = 1 - 2 * dep
  const r = 1 + inner[0] * k
  out[3] *= r < 0.15 ? 0.15 : r
  // Clamped on purpose: canvas IGNORES a globalAlpha outside [0,1] (it keeps the previous
  // value), so an alpha of 1.2 would silently paint with the previous point's alpha.
  const a = out[2] * (1 + inner[1] * k)
  out[2] = a > 1 ? 1 : a < 0 ? 0 : a
}

// Warps the flow parameter so particles crawl near both tips and run in the middle.
const FLOW_WARP = { slow: -1, t: null }
function flowWarp(slow) {
  if (slow !== FLOW_WARP.slow) {
    FLOW_WARP.slow = slow
    FLOW_WARP.t = lut256((p) => p - (slow / TAU) * Math.sin(TAU * p))
  }
  return FLOW_WARP.t
}

// Snap k so a wave peak sits exactly where the braid window opens (no splayed ends).
const LATTICE_K = { k: -1, edge: -1, v: 1 }
function latticeK(k, win0) {
  if (k !== LATTICE_K.k || win0 !== LATTICE_K.edge) {
    LATTICE_K.k = k
    LATTICE_K.edge = win0
    const xEdge = 1 - win0 || 1
    LATTICE_K.v = Math.max(1, Math.round(k * xEdge)) / xEdge
  }
  return LATTICE_K.v
}

const FLOW_PROFILE = { flat: -1, tip: -1, t: null }
function flowProfile(flat, tip) {
  if (flat !== FLOW_PROFILE.flat || tip !== FLOW_PROFILE.tip) {
    FLOW_PROFILE.flat = flat
    FLOW_PROFILE.tip = tip
    FLOW_PROFILE.t = lut256((ax) =>
      Math.pow(Math.max(0, 1 - Math.pow(ax, flat)), tip)
    )
  }
  return FLOW_PROFILE.t
}

// The lemniscate needs 3 trig + a hypot per point (position AND the normal the band offset
// rides on), all functions of the warped parameter only → tabulate the whole frame of
// reference: [x, y, normalX, normalY, sin²t] per step. 1024 steps because the curve moves
// fastest through the crossing.
const LOOP_STEPS = 2048
const LOOP_CURVE = { skew: NaN, t: null }
function loopCurve(skew) {
  if (skew !== LOOP_CURVE.skew) {
    LOOP_CURVE.skew = skew
    const t = new Float32Array((LOOP_STEPS + 1) * 5)
    for (let i = 0; i <= LOOP_STEPS; i++) {
      const p = i / LOOP_STEPS
      // Monotone warp: points slow down (bunch up) where its derivative is small.
      const w = p - (skew / (2 * TAU)) * Math.sin(2 * TAU * p)
      const th = TAU * w
      const s = Math.sin(th)
      const c = Math.cos(th)
      const d = 1 + s * s
      const dd = d * d
      const dx = (-s * (d + 2 * c * c)) / dd
      const dy = ((c * c - s * s) * d - 2 * s * s * c * c) / dd
      const nl = Math.hypot(dx, dy) || 1
      const o = i * 5
      t[o] = c / d
      t[o + 1] = (s * c) / d
      t[o + 2] = -dy / nl
      t[o + 3] = dx / nl
      t[o + 4] = s * s // 0 at the lobes, 1 at the crossing
    }
    LOOP_CURVE.t = t
  }
  return LOOP_CURVE.t
}

// Monotone warp p → p^g (g < 1): the derivative is large near the centre and small at the
// rim, so points race through the inner turns and pile up on the outer ones.
// 4096 steps, not 256: the warp is near-vertical at p → 0, so a coarse table makes the
// innermost points teleport from cell to cell instead of gliding.
const SPIRAL_WARP_STEPS = 4096
const SPIRAL_WARP = { g: -1, t: null }
function spiralWarp(g) {
  if (g !== SPIRAL_WARP.g) {
    SPIRAL_WARP.g = g
    SPIRAL_WARP.t = lutN(SPIRAL_WARP_STEPS, (p) => Math.pow(p, g))
  }
  return SPIRAL_WARP.t
}

// Disc inclination, memoised: sample() runs per point per frame, so computing the lean's
// cos/sin inline would be ~32k trig calls a frame for one number that rarely changes.
const SPIRAL_LEAN = { deg: NaN, c: 1, s: 0 }
function spiralLean(deg) {
  if (deg !== SPIRAL_LEAN.deg) {
    SPIRAL_LEAN.deg = deg
    SPIRAL_LEAN.c = Math.cos((deg * Math.PI) / 180)
    SPIRAL_LEAN.s = Math.sin((deg * Math.PI) / 180)
  }
  return SPIRAL_LEAN
}

const SPIRAL_RADIUS = { growth: -1, t: null }
function spiralRadius(growth) {
  if (growth !== SPIRAL_RADIUS.growth) {
    SPIRAL_RADIUS.growth = growth
    // r = e^(b(θ-θmax)) with b = ln(growth)/θmax  ⇒  r = growth^(p-1)
    SPIRAL_RADIUS.t = lut256((p) => Math.pow(growth, p - 1))
  }
  return SPIRAL_RADIUS.t
}

export function mulberry32(seed) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function buildLoop(n, rng) {
  const u = new Float32Array(n)
  const v = new Float32Array(n)
  const a = new Float32Array(n)
  const order = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    u[i] = rng()
    v[i] = axisPack(gauss(rng), TUNING.loop.axisBias)
    a[i] = 0.5 + 0.5 * rng()
    order[i] = u[i] // the sweep draws the ∞ by travelling along it
  }
  return {
    order,
    sample(i, time, out) {
      const T = TUNING.loop
      // Warping the parameter — not the per-point rate — keeps the density pattern still
      // while the points keep flowing through it.
      const t = loopCurve(T.skew)
      let p = u[i] + time * T.speed
      p -= Math.floor(p)
      const o = ((p * LOOP_STEPS) | 0) * 5
      const spread = 1 + T.crossSpread * t[o + 4] // widest at the crossing
      const off = v[i] * T.band * spread
      out[0] = t[o] + t[o + 2] * off
      out[1] = (t[o + 1] + t[o + 3] * off) * T.squash
      out[2] = a[i] / (1 + T.crossFade * (spread - 1))
      out[3] = 1
      applyInner(out, T.inner, Math.abs(v[i])) // band centre = interior
    },
  }
}

function buildLattice(n, rng) {
  const threads = Math.max(2, Math.round(TUNING.lattice.threads))
  const thread = new Float32Array(n)
  const u = new Float32Array(n)
  const v = new Float32Array(n)
  const a = new Float32Array(n)
  const order = new Float32Array(n)
  const mid = (threads - 1) / 2
  for (let i = 0; i < n; i++) {
    const k = Math.min(threads - 1, (rng() * threads) | 0)
    thread[i] = k - mid // signed distance from the centre line, in gaps
    u[i] = rng()
    v[i] = axisPack(gauss(rng), TUNING.lattice.axisBias)
    a[i] = 0.5 + 0.5 * rng()
    order[i] = (k + u[i]) / threads // weave thread by thread
  }
  return {
    order,
    sample(i, time, out) {
      const T = TUNING.lattice
      // The lattice GEOMETRY is a function of x only (nodes stay put); the particles
      // travel through it left→right and recycle, so it reads as a flow crossing a
      // complex-but-ordered structure rather than a standing pattern.
      let p =
        u[i] + time * T.travel * (1 - T.travelVar * Math.abs(thread[i]) * 0.5)
      p -= Math.floor(p)
      const x = p * 2 - 1
      // Braid window: 0 at both edges → the threads always enter and leave as straight
      // parallel lines. That's the "controlled" half — the system never loses its order.
      const w = smoothstep(T.window[0], T.window[1], 1 - Math.abs(x))
      const ph = time * T.phaseSpeed + thread[i] * T.phaseOffset
      const k = latticeK(T.k, T.window[0])
      let osc = Math.cos(k * Math.PI * x + ph)
      if (T.h2)
        osc =
          (osc + T.h2 * Math.cos(T.k2 * Math.PI * x - ph * 0.6)) / (1 + T.h2)
      if (T.fold) osc = osc * (1 - T.fold) + Math.abs(osc) * T.fold
      // Breathing modulates HOW DEEP the nodes pinch (the window), not the amplitude:
      // scaling the amplitude pushed s past 1, which threw the threads beyond their rest
      // offset and drew ghost arcs above and below the band.
      let wEff = w * (1 + T.breath * Math.sin(time * T.breathSpeed))
      if (wEff > 1) wEff = 1
      else if (wEff < 0) wEff = 0
      // s = 1 at the edges, shared by every thread inside: they collapse into a node
      // together and bulge apart between nodes (a flat chain of rings when folded).
      const s = 1 - wEff * (1 - osc)
      out[0] = x
      out[1] = thread[i] * T.gap * s + v[i] * T.band
      out[2] = a[i] * smoothstep(0, T.edge, p) * smoothstep(0, T.edge, 1 - p)
      out[3] = 1
      applyInner(out, T.inner, Math.abs(v[i])) // each thread's own axis
    },
  }
}

function buildFlow(n, rng) {
  const T0 = TUNING.flow
  const lines = Math.max(2, Math.round(T0.lines))
  const u = new Float32Array(n)
  const v = new Float32Array(n)
  const a = new Float32Array(n)
  const core = new Uint8Array(n)
  const order = new Float32Array(n)
  // |offset| inside the point's OWN streamline ribbon (0 = that line's axis, 1 = its edge).
  // Keyed per line, not to the lens axis, so every streamline reads the same: a thick dark
  // core fading to a diffuse edge — instead of the central lines being the only strong ones.
  const dep = new Float32Array(n)
  // Travel direction: +1 = left→right (top half), -1 = right→left (bottom half). Resolved
  // here from the LINE INDEX, not per frame from v[i] — v carries the ribbon jitter, and a
  // point must never change sides. Core points (which return early) keep the +1 default.
  const dir = new Int8Array(n).fill(1)
  for (let i = 0; i < n; i++) {
    if (rng() < T0.coreFrac) {
      // Static dark core: uniform inside the ellipse (sqrt keeps the density even).
      const ang = rng() * TAU
      const rr = Math.sqrt(rng())
      core[i] = 1
      u[i] = Math.cos(ang) * rr * T0.coreRx
      v[i] = Math.sin(ang) * rr * T0.coreRy
      a[i] = 0.95 + 0.05 * rng() // near-opaque: overlapping dots read as solid ink
      order[i] = 0.45 + 0.1 * rng()
      continue
    }
    const q = Math.min(lines - 1, (rng() * lines) | 0)
    const line = (q / (lines - 1)) * 2 - 1
    // Bias packs the streamlines toward the axis, as in the reference graphic.
    const biased = Math.sign(line) * Math.pow(Math.abs(line), T0.lineBias || 1)
    // Canvas draws +y downward, so biased > 0 is the BOTTOM half — the return leg. An odd
    // `lines` puts one streamline exactly on the axis; it joins the top half.
    if (biased > 0) dir[i] = -1
    u[i] = rng()
    const off = axisPack((rng() - 0.5) * 2, T0.axisBias) * T0.jitter
    dep[i] = T0.jitter ? Math.abs(off) / T0.jitter : 0
    v[i] = clamp(biased + off, -1, 1)
    a[i] = 0.4 + 0.6 * rng()
    order[i] = dir[i] > 0 ? u[i] : 1 - u[i] // each half fills in its OWN direction
  }
  return {
    order,
    sample(i, time, out) {
      const T = TUNING.flow
      if (core[i]) {
        out[0] = u[i]
        out[1] = v[i]
        out[2] = a[i]
        out[3] = 0.7 // smaller dots pack tighter → a solid ellipse, not a fuzzy clump
        return
      }
      // Poiseuille-ish profile: the centre line runs fastest, the outer ones lag. `dir`
      // flips the bottom half; the floor-wrap normalises a negative p on its own, and the
      // warp / edge / tipClear windows are all symmetric, so the recycle stays invisible.
      let p = u[i] + time * T.speed * dir[i] * (1 - T.shear * v[i] * v[i])
      p -= Math.floor(p)
      const pw = flowWarp(T.tipSlow)[(p * 256) | 0] // crawl at the tips → ink piles up
      const x = pw * 2 - 1
      // flat = long horizontal run, tip < 1 = the streamlines converge into a point
      const prof = flowProfile(T.flat, T.tip)[(Math.abs(x) * 256) | 0]
      out[0] = x
      out[1] = T.h * prof * v[i]
      out[2] = a[i] * smoothstep(0, T.edge, p) * smoothstep(0, T.edge, 1 - p)
      // A pocket for the gold node, not just a fade: alpha stays at 0 over the inner
      // TIP_HOLD of the window, so there is a real hole the node can sit in. A plain
      // smoothstep from the tip still had ~40% alpha at the halo's edge, and at this density
      // 40% of thousands of dots buries the node.
      if (T.tipClear > 0)
        out[2] *= smoothstep(T.tipClear * TIP_HOLD, T.tipClear, 1 - Math.abs(x))
      out[3] = 1
      applyInner(out, T.inner, dep[i]) // each streamline's OWN axis is its interior
    },
  }
}

function buildSpiral(n, rng) {
  const u = new Float32Array(n)
  const v = new Float32Array(n)
  const a = new Float32Array(n)
  const order = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    u[i] = rng()
    v[i] = axisPack(gauss(rng), TUNING.spiral.axisBias)
    a[i] = 0.45 + 0.55 * rng()
    order[i] = u[i] // winds outward from the centre
  }
  return {
    order,
    sample(i, time, out) {
      const T = TUNING.spiral
      let p = u[i] + time * T.speed
      p -= Math.floor(p)
      // fast inside, crawling at the rim
      const pw = spiralWarp(T.warp)[(p * SPIRAL_WARP_STEPS) | 0]
      const th = pw * TAU * T.turns * T.spin
      const r = spiralRadius(T.growth)[(pw * 256) | 0] // r = 1 on the outer turn
      const rr = r + v[i] * (T.band * r + T.bandMin)
      // Inclined disc: foreshorten the minor axis, then rotate the ellipse.
      const dx = rr * Math.cos(th)
      const dy = rr * Math.sin(th) * T.tilt
      const L = spiralLean(T.lean)
      out[0] = dx * L.c - dy * L.s
      out[1] = dx * L.s + dy * L.c
      out[2] =
        a[i] *
        smoothstep(0, T.edge, p) *
        smoothstep(0, T.edge, 1 - p) *
        smoothstep(0, T.coreFade, r) // the arm vanishes into the centre
      out[3] = 1
      applyInner(out, T.inner, r) // r = 0 at the centre, 1 on the outer turn
    },
  }
}

const BUILDERS = {
  loop: buildLoop,
  lattice: buildLattice,
  flow: buildFlow,
  spiral: buildSpiral,
}

/**
 * Build a parametric point cloud.
 * @param {string} kind - one of SHAPE_ORDER
 * @param {number} n - point count (same for every state → 1:1 morph)
 * @param {function} rng - seeded RNG (deterministic across reloads)
 * @returns {{kind:string, order:Float32Array, extX:number, extY:number,
 *            sample:(i:number, time:number, out:Float32Array)=>void}}
 *   `sample` writes [x, y, alpha, radiusMultiplier]; x/y are normalized so the shape's
 *   largest half-extent is 1, and extX/extY are its half-extents in that space.
 */
export function makeShape(kind, n, rng) {
  const build = BUILDERS[kind] || BUILDERS.loop
  const shape = build(n, rng)
  const raw = shape.sample
  const buf = new Float32Array(4)
  // Extents are measured over several phases (the shapes move, the fit must not).
  // Strided: the maxima are statistical over thousands of points, so every 5th is enough
  // and init stays cheap.
  let maxX = 0
  let maxY = 0
  for (const t of MEASURE_TIMES) {
    for (let i = 0; i < n; i += 5) {
      raw(i, t, buf)
      const ax = Math.abs(buf[0])
      const ay = Math.abs(buf[1])
      if (ax > maxX) maxX = ax
      if (ay > maxY) maxY = ay
    }
  }
  const half = Math.max(maxX, maxY) || 1
  const norm = 1 / half
  return {
    kind, // the renderer reads TUNING[kind].shim from it (per-axis shimmer scale)
    order: shape.order,
    extX: maxX * norm || 1,
    extY: maxY * norm || 1,
    sample(i, time, out) {
      raw(i, time, out)
      out[0] *= norm
      out[1] *= norm
    },
  }
}
