import { s as splitElement, R as REVEAL_FROM, a as REVEAL_TO } from './word-reveal-D8bOuPxk.js';

/*
  Util: point-shapes · procedural parametric point clouds
  Four generators (loop / lattice / flow / spiral) for the compouding cloud. A shape is not
  a static x/y set: every point keeps its curve coordinates (u along, v across) and is
  EVALUATED PER FRAME, so the motion lives in the parametrization (u wraps → infinite).
  Every number lives in TUNING (mutable at runtime → playground/compouding-shapes).
  Docs → .claude/rules/components/compouding.md
*/

const TAU = Math.PI * 2;
// Share of flow's `tipClear` window that is FULLY clear (alpha 0) before the ramp starts —
// the pocket the gold endpoint node sits in.
const TIP_HOLD = 0.42;

const SHAPE_ORDER = ['loop', 'lattice', 'flow', 'spiral'];

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
const TUNING = {
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
    speed: 0.085, // crossings per second on the centre line
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
    // Negative = inward (points born at the rim, spiralling into the centre). Positive
    // reverses it to outward. Either way it never ends — only the direction reads different.
    speed: -0.045, // full traversals per second (also the apparent spin)
    // The reference's outer arm is a WIDE granulated band, not a line — this is what
    // separates "spiral of dust" from "spiral drawn with dots".
    band: 0.15, // thickness scales with radius → granulated outside
    bandMin: 0.006,
    edge: 0.06,
  },
};

const MEASURE_TIMES = [0, 0.29, 0.73, 1.6, 3.1, 5.7, 9.3, 14.1];

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t)
}

// Box-Muller, clamped — a band reads softer than a uniform spread.
function gauss(rng) {
  const u = Math.max(1e-6, rng());
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
  const t = new Float32Array(n + 1);
  for (let i = 0; i <= n; i++) t[i] = fill(i / n);
  return t
}
function lut256(fill) {
  return lutN(256, fill)
}

// Ink gradient helper: dep 0 = the shape's interior, 1 = its outer edge. Writes the size
// multiplier and scales the alpha, so one knob pair per shape controls both.
function applyInner(out, inner, dep) {
  const k = 1 - 2 * dep;
  const r = 1 + inner[0] * k;
  out[3] *= r < 0.15 ? 0.15 : r;
  // Clamped on purpose: canvas IGNORES a globalAlpha outside [0,1] (it keeps the previous
  // value), so an alpha of 1.2 would silently paint with the previous point's alpha.
  const a = out[2] * (1 + inner[1] * k);
  out[2] = a > 1 ? 1 : a < 0 ? 0 : a;
}

// Warps the flow parameter so particles crawl near both tips and run in the middle.
const FLOW_WARP = { slow: -1, t: null };
function flowWarp(slow) {
  if (slow !== FLOW_WARP.slow) {
    FLOW_WARP.slow = slow;
    FLOW_WARP.t = lut256((p) => p - (slow / TAU) * Math.sin(TAU * p));
  }
  return FLOW_WARP.t
}

// Snap k so a wave peak sits exactly where the braid window opens (no splayed ends).
const LATTICE_K = { k: -1, edge: -1, v: 1 };
function latticeK(k, win0) {
  if (k !== LATTICE_K.k || win0 !== LATTICE_K.edge) {
    LATTICE_K.k = k;
    LATTICE_K.edge = win0;
    const xEdge = 1 - win0;
    LATTICE_K.v = Math.max(1, Math.round(k * xEdge)) / xEdge;
  }
  return LATTICE_K.v
}

const FLOW_PROFILE = { flat: -1, tip: -1, t: null };
function flowProfile(flat, tip) {
  if (flat !== FLOW_PROFILE.flat || tip !== FLOW_PROFILE.tip) {
    FLOW_PROFILE.flat = flat;
    FLOW_PROFILE.tip = tip;
    FLOW_PROFILE.t = lut256((ax) =>
      Math.pow(Math.max(0, 1 - Math.pow(ax, flat)), tip)
    );
  }
  return FLOW_PROFILE.t
}

// The lemniscate needs 3 trig + a hypot per point (position AND the normal the band offset
// rides on), all functions of the warped parameter only → tabulate the whole frame of
// reference: [x, y, normalX, normalY, sin²t] per step. 1024 steps because the curve moves
// fastest through the crossing.
const LOOP_STEPS = 2048;
const LOOP_CURVE = { skew: NaN, t: null };
function loopCurve(skew) {
  if (skew !== LOOP_CURVE.skew) {
    LOOP_CURVE.skew = skew;
    const t = new Float32Array((LOOP_STEPS + 1) * 5);
    for (let i = 0; i <= LOOP_STEPS; i++) {
      const p = i / LOOP_STEPS;
      // Monotone warp: points slow down (bunch up) where its derivative is small.
      const w = p - (skew / (2 * TAU)) * Math.sin(2 * TAU * p);
      const th = TAU * w;
      const s = Math.sin(th);
      const c = Math.cos(th);
      const d = 1 + s * s;
      const dd = d * d;
      const dx = (-s * (d + 2 * c * c)) / dd;
      const dy = ((c * c - s * s) * d - 2 * s * s * c * c) / dd;
      const nl = Math.hypot(dx, dy) || 1;
      const o = i * 5;
      t[o] = c / d;
      t[o + 1] = (s * c) / d;
      t[o + 2] = -dy / nl;
      t[o + 3] = dx / nl;
      t[o + 4] = s * s; // 0 at the lobes, 1 at the crossing
    }
    LOOP_CURVE.t = t;
  }
  return LOOP_CURVE.t
}

// Monotone warp p → p^g (g < 1): the derivative is large near the centre and small at the
// rim, so points race through the inner turns and pile up on the outer ones.
// 4096 steps, not 256: the warp is near-vertical at p → 0, so a coarse table makes the
// innermost points teleport from cell to cell instead of gliding.
const SPIRAL_WARP_STEPS = 4096;
const SPIRAL_WARP = { g: -1, t: null };
function spiralWarp(g) {
  if (g !== SPIRAL_WARP.g) {
    SPIRAL_WARP.g = g;
    SPIRAL_WARP.t = lutN(SPIRAL_WARP_STEPS, (p) => Math.pow(p, g));
  }
  return SPIRAL_WARP.t
}

const SPIRAL_RADIUS = { growth: -1, t: null };
function spiralRadius(growth) {
  if (growth !== SPIRAL_RADIUS.growth) {
    SPIRAL_RADIUS.growth = growth;
    // r = e^(b(θ-θmax)) with b = ln(growth)/θmax  ⇒  r = growth^(p-1)
    SPIRAL_RADIUS.t = lut256((p) => Math.pow(growth, p - 1));
  }
  return SPIRAL_RADIUS.t
}

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function buildLoop(n, rng) {
  const u = new Float32Array(n);
  const v = new Float32Array(n);
  const a = new Float32Array(n);
  const order = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    u[i] = rng();
    v[i] = axisPack(gauss(rng), TUNING.loop.axisBias);
    a[i] = 0.5 + 0.5 * rng();
    order[i] = u[i]; // the sweep draws the ∞ by travelling along it
  }
  return {
    order,
    sample(i, time, out) {
      const T = TUNING.loop;
      // Warping the parameter — not the per-point rate — keeps the density pattern still
      // while the points keep flowing through it.
      const t = loopCurve(T.skew);
      let p = u[i] + time * T.speed;
      p -= Math.floor(p);
      const o = ((p * LOOP_STEPS) | 0) * 5;
      const spread = 1 + T.crossSpread * t[o + 4]; // widest at the crossing
      const off = v[i] * T.band * spread;
      out[0] = t[o] + t[o + 2] * off;
      out[1] = (t[o + 1] + t[o + 3] * off) * T.squash;
      out[2] = a[i] / (1 + T.crossFade * (spread - 1));
      out[3] = 1;
      applyInner(out, T.inner, Math.abs(v[i])); // band centre = interior
    },
  }
}

function buildLattice(n, rng) {
  const threads = Math.max(2, Math.round(TUNING.lattice.threads));
  const thread = new Float32Array(n);
  const u = new Float32Array(n);
  const v = new Float32Array(n);
  const a = new Float32Array(n);
  const order = new Float32Array(n);
  const mid = (threads - 1) / 2;
  for (let i = 0; i < n; i++) {
    const k = Math.min(threads - 1, (rng() * threads) | 0);
    thread[i] = k - mid; // signed distance from the centre line, in gaps
    u[i] = rng();
    v[i] = axisPack(gauss(rng), TUNING.lattice.axisBias);
    a[i] = 0.5 + 0.5 * rng();
    order[i] = (k + u[i]) / threads; // weave thread by thread
  }
  return {
    order,
    sample(i, time, out) {
      const T = TUNING.lattice;
      // The lattice GEOMETRY is a function of x only (nodes stay put); the particles
      // travel through it left→right and recycle, so it reads as a flow crossing a
      // complex-but-ordered structure rather than a standing pattern.
      let p =
        u[i] + time * T.travel * (1 - T.travelVar * Math.abs(thread[i]) * 0.5);
      p -= Math.floor(p);
      const x = p * 2 - 1;
      // Braid window: 0 at both edges → the threads always enter and leave as straight
      // parallel lines. That's the "controlled" half — the system never loses its order.
      const w = smoothstep(T.window[0], T.window[1], 1 - Math.abs(x));
      const ph = time * T.phaseSpeed + thread[i] * T.phaseOffset;
      const k = latticeK(T.k, T.window[0]);
      let osc = Math.cos(k * Math.PI * x + ph);
      osc = osc * (1 - T.fold) + Math.abs(osc) * T.fold;
      // Breathing modulates HOW DEEP the nodes pinch (the window), not the amplitude:
      // scaling the amplitude pushed s past 1, which threw the threads beyond their rest
      // offset and drew ghost arcs above and below the band.
      let wEff = w * (1 + T.breath * Math.sin(time * T.breathSpeed));
      if (wEff > 1) wEff = 1;
      else if (wEff < 0) wEff = 0;
      // s = 1 at the edges, shared by every thread inside: they collapse into a node
      // together and bulge apart between nodes (a flat chain of rings when folded).
      const s = 1 - wEff * (1 - osc);
      out[0] = x;
      out[1] = thread[i] * T.gap * s + v[i] * T.band;
      out[2] = a[i] * smoothstep(0, T.edge, p) * smoothstep(0, T.edge, 1 - p);
      out[3] = 1;
      applyInner(out, T.inner, Math.abs(v[i])); // each thread's own axis
    },
  }
}

function buildFlow(n, rng) {
  const T0 = TUNING.flow;
  const lines = Math.max(2, Math.round(T0.lines));
  const u = new Float32Array(n);
  const v = new Float32Array(n);
  const a = new Float32Array(n);
  const core = new Uint8Array(n);
  const order = new Float32Array(n);
  // |offset| inside the point's OWN streamline ribbon (0 = that line's axis, 1 = its edge).
  // Keyed per line, not to the lens axis, so every streamline reads the same: a thick dark
  // core fading to a diffuse edge — instead of the central lines being the only strong ones.
  const dep = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (rng() < T0.coreFrac) {
      // Static dark core: uniform inside the ellipse (sqrt keeps the density even).
      const ang = rng() * TAU;
      const rr = Math.sqrt(rng());
      core[i] = 1;
      u[i] = Math.cos(ang) * rr * T0.coreRx;
      v[i] = Math.sin(ang) * rr * T0.coreRy;
      a[i] = 0.95 + 0.05 * rng(); // near-opaque: overlapping dots read as solid ink
      order[i] = 0.45 + 0.1 * rng();
      continue
    }
    const q = Math.min(lines - 1, (rng() * lines) | 0);
    const line = (q / (lines - 1)) * 2 - 1;
    // Bias packs the streamlines toward the axis, as in the reference graphic.
    const biased = Math.sign(line) * Math.pow(Math.abs(line), T0.lineBias);
    u[i] = rng();
    const off = axisPack((rng() - 0.5) * 2, T0.axisBias) * T0.jitter;
    dep[i] = Math.abs(off) / T0.jitter ;
    v[i] = clamp(biased + off, -1, 1);
    a[i] = 0.4 + 0.6 * rng();
    order[i] = u[i]; // fills in the direction of the flow
  }
  return {
    order,
    sample(i, time, out) {
      const T = TUNING.flow;
      if (core[i]) {
        out[0] = u[i];
        out[1] = v[i];
        out[2] = a[i];
        out[3] = 0.7; // smaller dots pack tighter → a solid ellipse, not a fuzzy clump
        return
      }
      // Poiseuille-ish profile: the centre line runs fastest, the outer ones lag.
      let p = u[i] + time * T.speed * (1 - T.shear * v[i] * v[i]);
      p -= Math.floor(p);
      const pw = flowWarp(T.tipSlow)[(p * 256) | 0]; // crawl at the tips → ink piles up
      const x = pw * 2 - 1;
      // flat = long horizontal run, tip < 1 = the streamlines converge into a point
      const prof = flowProfile(T.flat, T.tip)[(Math.abs(x) * 256) | 0];
      out[0] = x;
      out[1] = T.h * prof * v[i];
      out[2] = a[i] * smoothstep(0, T.edge, p) * smoothstep(0, T.edge, 1 - p);
      // A pocket for the gold node, not just a fade: alpha stays at 0 over the inner
      // TIP_HOLD of the window, so there is a real hole the node can sit in. A plain
      // smoothstep from the tip still had ~40% alpha at the halo's edge, and at this density
      // 40% of thousands of dots buries the node.
      out[2] *= smoothstep(T.tipClear * TIP_HOLD, T.tipClear, 1 - Math.abs(x));
      out[3] = 1;
      applyInner(out, T.inner, dep[i]); // each streamline's OWN axis is its interior
    },
  }
}

function buildSpiral(n, rng) {
  const u = new Float32Array(n);
  const v = new Float32Array(n);
  const a = new Float32Array(n);
  const order = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    u[i] = rng();
    v[i] = axisPack(gauss(rng), TUNING.spiral.axisBias);
    a[i] = 0.45 + 0.55 * rng();
    order[i] = u[i]; // winds outward from the centre
  }
  return {
    order,
    sample(i, time, out) {
      const T = TUNING.spiral;
      let p = u[i] + time * T.speed;
      p -= Math.floor(p);
      // fast inside, crawling at the rim
      const pw = spiralWarp(T.warp)[(p * SPIRAL_WARP_STEPS) | 0];
      const th = pw * TAU * T.turns;
      const r = spiralRadius(T.growth)[(pw * 256) | 0]; // r = 1 on the outer turn
      const rr = r + v[i] * (T.band * r + T.bandMin);
      out[0] = rr * Math.cos(th);
      out[1] = rr * Math.sin(th);
      out[2] =
        a[i] *
        smoothstep(0, T.edge, p) *
        smoothstep(0, T.edge, 1 - p) *
        smoothstep(0, T.coreFade, r); // the arm vanishes into the centre
      out[3] = 1;
      applyInner(out, T.inner, r); // r = 0 at the centre, 1 on the outer turn
    },
  }
}

const BUILDERS = {
  loop: buildLoop,
  lattice: buildLattice,
  flow: buildFlow,
  spiral: buildSpiral,
};

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
function makeShape(kind, n, rng) {
  const build = BUILDERS[kind] || BUILDERS.loop;
  const shape = build(n, rng);
  const raw = shape.sample;
  const buf = new Float32Array(4);
  // Extents are measured over several phases (the shapes move, the fit must not).
  // Strided: the maxima are statistical over thousands of points, so every 5th is enough
  // and init stays cheap.
  let maxX = 0;
  let maxY = 0;
  for (const t of MEASURE_TIMES) {
    for (let i = 0; i < n; i += 5) {
      raw(i, t, buf);
      const ax = Math.abs(buf[0]);
      const ay = Math.abs(buf[1]);
      if (ax > maxX) maxX = ax;
      if (ay > maxY) maxY = ay;
    }
  }
  const half = Math.max(maxX, maxY) || 1;
  const norm = 1 / half;
  return {
    kind, // the renderer reads TUNING[kind].shim from it (per-axis shimmer scale)
    order: shape.order,
    extX: maxX * norm || 1,
    extY: maxY * norm || 1,
    sample(i, time, out) {
      raw(i, time, out);
      out[0] *= norm;
      out[1] *= norm;
    },
  }
}

/*
  Component: compouding · data-component="compouding"
  Paradigm chrome (per-number underline + per-word de-blur + autoplay) with a PROCEDURAL
  point cloud for the visuals: one parametric shape per tab (loop / lattice / flow /
  spiral), each with its own perpetual motion, morphing along the incoming shape's own
  curve on every switch. No PNG sampling — the source <img>s are the static fallback only.
  CSS → ./styles/compouding.css (bundled via src/styles.js) · Docs → .claude/rules/components/compouding.md
*/


const { gsap } = window;

// ---- Chrome (underline + text) ----
const OUT_FADE = 0.3; // outgoing text fade
// Autoplay dwell scales with the tab's text length (more words → longer).
const AUTOPLAY_BASE = 3.5; // seconds baseline per tab
const AUTOPLAY_PER_WORD = 0.35; // extra seconds per word of the tab's message
const AUTOPLAY_MIN = 4; // floor (also keeps it ≥ the morph)
const AUTOPLAY_MAX = 11; // ceiling

// Per-tab autoplay seconds from its message word count.
function autoplayDuration(el) {
  const words = (el?.textContent || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const d = AUTOPLAY_BASE + words * AUTOPLAY_PER_WORD;
  return Math.min(AUTOPLAY_MAX, Math.max(AUTOPLAY_MIN, d))
}

// ---- Point cloud (procedural, evaluated per frame) ----
const SHAPE_ATTR = 'data-compouding-shape'; // loop | lattice | flow | spiral
// Grain over weight: the reference graphics are MANY small light dots, not few heavy ones.
// Halving the dot radius and doubling the count is what makes a shape read as fine grain.
const TARGET_POINTS = 16000; // points per state — same for all, for a 1:1 morph
const POINTS_MOBILE = 9000; // fewer points below 768px (evaluating 4 shapes per frame)
const MOBILE_Q = '(max-width: 767px)';
const DOT_COLOR = '138,142,149'; // light slate grey (tuned for a light bg)
// Sprite: alpha stays full out to this fraction of the radius, then falls off. Higher =
// crisper dots (a fully soft dot smears any shape made of lines into fog).
const DOT_HARD = 0.6;
const FIT = 0.8; // per-state: fraction of the stage each shape fills on its limiting axis
// px kept clear on every side. The shimmer, breathing and hover push points OUTSIDE the
// fitted box (~12% of the scale), so without this the cloud reaches the stage edge and
// reads as touching whatever sits above the wrapper.
const STAGE_PAD = 32;
// Varied dot sizes: mostly fine dots, a fraction a bit bigger (keep them slim).
const BIG_DOT_CHANCE = 0.12;
const SMALL_R = [0.3, 0.62];
const BIG_R = [0.75, 1.3];
// Morph (the transition): per-point staggered "wave" ordered by the TARGET shape's own
// parametrization (see point-shapes.js `order`) — so each state builds along its curve.
const MORPH_DURATION = 3.5;
const MORPH_EASE = 'power1.inOut';
const MORPH_SPREAD = 0.55; // how far the per-point START is staggered along the order
const MORPH_SPEED_VAR = 0.5; // per-point DURATION variance (faster/slower particles)
const WAVE_RANDOM = 0.4; // blend the ordered sweep with per-point randomness (softer)
// Hover nebula (desktop only — reads as jitter on tablet/below)
const HOVER_RADIUS = 0.4;
const HOVER_PUSH = 0.03;
const HOVER_SWIRL = 0.06;
const HOVER_EASE = 0.11;
const HOVER_SCATTER = 0.18;
const HOVER_MIN_WIDTH = 992; // px — hover only at/above this (Webflow desktop base)
// Ambient shimmer — residual drift that never fully stops (assembled = DRIFT×SHIMMER_FLOOR).
const DRIFT = 0.16;
const DRIFT_SPEED = 1.2; // shimmer oscillation rate
const SHIMMER_FLOOR = 0.5;
const DRIFT_FREQ_VAR = 0.4; // per-point drift-frequency variation → desynced shimmer
// Coherent breathing — a slow radial pulse rippling out from center.
const BREATH_AMP = 0.03;
const BREATH_SPEED = 1.65;
const BREATH_RIPPLE = 2.2;
// Flow tab: gold endpoint nodes drawn on canvas + the two HTML endpoint labels.
const ENDPOINT_ATTR = 'data-compouding-endpoint'; // start | end
const START_ATTR = 'data-compouding-startpoint'; // accepted alias for the start label
const UNIT_SHIM = [1, 1]; // fallback shimmer anisotropy
const ALPHA_SKIP = 0.015; // below this a dot is invisible — skip the draw, not the physics
const NODE_CORE_R = 4.5; // px
const NODE_GLOW_R = 15; // px (halo)
const NODE_PULSE = 1.5; // rad/s
const LABEL_GAP = 16; // px between a lens tip and its label
const LABEL_FADE = 0.75;
const LABEL_STAGGER = 0.16;
// The nodes + labels belong to the lens, so they must not show while the cloud is still the
// previous shape — they'd sit on top of it. Windows of the morph progress: in late, out early.
const NODE_IN = 0.55;
const NODE_OUT = 0.3;
const LABEL_IN = 0.6; // fraction of the morph waited before the labels fade in
// Intro (float in → assemble): gentle so the load assembly never lurches.
const INTRO_SCATTER = 0.6;
const INTRO_FADE = 0.6;
const INTRO_HOLD = 0.8;
const INTRO_DURATION = 2.4;
const INTRO_STAGGER = 0.7;

// Tuning — messages column fits the active tab
// Every tab-title shares grid cell 1/1, so the column would otherwise always be as tall as
// the LONGEST tab, leaving the shorter ones trailing that leftover height before the
// figures. The column height is tweened to the active tab instead, in step with the text.
const FIT_TWEEN = { duration: 1, ease: 'sine.out' }; // matches REVEAL_TO so it reads as one motion

const desktopHover = window.matchMedia(`(min-width: ${HOVER_MIN_WIDTH}px)`);

// Outgoing tab: plain fade. The de-blur lives on the words, never the parent.
const REVEAL_OUT = { autoAlpha: 0, duration: OUT_FADE };

// The endpoint labels are authored in Webflow, where the attribute VALUE is the easiest
// thing to get wrong (a city name instead of start/end). So: accept start|end in any case,
// accept the -startpoint alias, and fall back to DOM order for whatever is left — then
// rewrite the canonical value, since the CSS and positionEndpoints() key off it.
function resolveEndpoints(root, visualsWrap) {
  if (!visualsWrap) return []
  const found = gsap.utils.toArray(
    root.querySelectorAll(`[${ENDPOINT_ATTR}], [${START_ATTR}]`)
  );
  const sides = found.map((el) => {
    if (el.hasAttribute(START_ATTR)) return 'start'
    const v = (el.getAttribute(ENDPOINT_ATTR) || '').trim().toLowerCase();
    if (v === 'start' || v === 'from') return 'start'
    if (v === 'end' || v === 'to') return 'end'
    return null
  });
  found.forEach((el, i) => {
    if (!sides[i]) sides[i] = sides.includes('start') ? 'end' : 'start';
  });
  if (found.length > 2)
    console.warn(
      `[compouding] ${found.length} endpoint labels — only the first start + end are used`
    );
  // start first, so the fade-in stagger always runs origin → destination.
  const out = []
  ;['start', 'end'].forEach((side) => {
    const el = found[sides.indexOf(side)];
    if (!el) return
    el.setAttribute(ENDPOINT_ATTR, side);
    el.removeAttribute(START_ATTR);
    if (el.parentElement !== visualsWrap) visualsWrap.appendChild(el);
    out.push(el);
  });
  return out
}

function setupRoot(root) {
  const titles = gsap.utils.toArray(
    root.querySelectorAll('[data-compunding="tab-title"]')
  );
  const messages = titles.map(
    (t) => t.querySelector('[data-paradigm-message]') || t
  );
  const links = gsap.utils.toArray(
    root.querySelectorAll('[data-paradigm="tab-link"]')
  );
  const visuals = gsap.utils.toArray(
    root.querySelectorAll('[data-paradigm-visual]')
  );
  const messagesWrap = root.querySelector('[data-paradigm-messages]');
  const visualsWrap = root.querySelector('.tabs-compouding_visual-wrapper');

  const count = Math.min(titles.length, links.length, visuals.length);
  if (count < 1) {
    console.warn(
      '[compouding] needs at least one tab-title / tab-link / visual'
    );
    return null
  }

  root.classList.add('is-enhanced');

  // Per-number underline (active-only): inject a grey track + black fill into each number.
  // Only the active number's fill grows 0→1; the rest stay empty (inactive). Replaces the
  // single full-width .tabs_number-underline (hidden via CSS).
  const bars = links.slice(0, count).map((link) => {
    const track = document.createElement('span');
    track.className = 'tabs-compouding_tab-link-underline is-track';
    const fill = document.createElement('span');
    fill.className = 'tabs-compouding_tab-link-fill';
    track.appendChild(fill);
    link.appendChild(track);
    return fill
  });

  const wordsByTab = messages.slice(0, count).map(splitElement);

  // Initial states. Visuals start hidden either way (the canvas paints them in cloud
  // mode; crossfade toggles them in fallback mode).
  gsap.set(titles, { autoAlpha: 0 });
  gsap.set(visuals, { autoAlpha: 0 });
  gsap.set(wordsByTab.flat(), REVEAL_FROM);
  gsap.set(bars, { scaleX: 0, transformOrigin: 'left center' });

  // ===================== Point-cloud visuals =====================
  const cloudEnabled = !!visualsWrap;
  // Which procedural shape each tab shows. Falls back to SHAPE_ORDER by index.
  const shapeKinds = visuals.slice(0, count).map((v, i) => {
    const raw = (v.getAttribute(SHAPE_ATTR) || '').trim();
    if (SHAPE_ORDER.includes(raw)) return raw
    const fallback = SHAPE_ORDER[i % SHAPE_ORDER.length];
    console.warn(
      `[compouding] visual ${i}: ${
        raw ? `unknown ${SHAPE_ATTR}="${raw}"` : `no ${SHAPE_ATTR}`
      } — using "${fallback}"`
    );
    return fallback
  });
  const flowIndex = shapeKinds.indexOf('flow');

  // Flow endpoint labels (São Paulo / Texas): real text in the DOM. Moved onto the visual
  // wrapper so JS can anchor them to the lens tips (and so .is-canvas can't hide them
  // along with the source visuals).
  const endpoints = resolveEndpoints(root, visualsWrap);
  if (endpoints.length) gsap.set(endpoints, { autoAlpha: 0 });

  let cloudOk = false; // procedural cloud is live → canvas drives the visuals
  let canvas = null;
  let cctx = null;
  let sprite = null;
  let nodeSprite = null;
  const N = window.matchMedia(MOBILE_Q).matches ? POINTS_MOBILE : TARGET_POINTS;
  let states = null;
  const sbuf = new Float32Array(4); // shared sample output — no per-point allocation
  const fbuf = new Float32Array(4); // ditto, for the outgoing shape during a morph
  // Per-point residual at the instant of a switch: painted frame − the outgoing shape's LIVE
  // position. It decays as the point migrates, which is what lets the morph start
  // frame-exact without freezing the outgoing shape (see morphTo).
  const resX = new Float32Array(N);
  const resY = new Float32Array(N);
  const resA = new Float32Array(N);
  // Positions of the last painted frame — what the residual above is measured against.
  const curX = new Float32Array(N);
  const curY = new Float32Array(N);
  const curA = new Float32Array(N);
  let toState = null;
  let fromState = null; // the outgoing shape, sampled LIVE while a morph runs
  const morph = { t: 1 };
  let cloudReady = false;
  let introduced = false;
  let introActive = false;
  let pendingGo = null;
  let looping = false;
  // per-point buffers
  const dispX = new Float32Array(N);
  const dispY = new Float32Array(N);
  const pointR = new Float32Array(N); // per-point dot radius (varied sizes)
  const offX = new Float32Array(N);
  const offY = new Float32Array(N);
  const startX = new Float32Array(N);
  const startY = new Float32Array(N);
  const introDelay = new Float32Array(N);
  const driftPhase = new Float32Array(N);
  const driftFreq = new Float32Array(N); // per-point shimmer frequency → desynced
  const mProj = new Float32Array(N); // per-point morph order (0..1, from the target shape)
  const waveJit = new Float32Array(N); // per-point random blended into the wave delay
  const mRand = new Float32Array(N); // per-point random → morph speed variance
  const introProg = { v: 0 };
  const introFade = { v: 0 };
  let hovActive = false;
  let mx = 0;
  let my = 0;
  let flowFrom = false; // flow is the morph's source → fade its nodes OUT
  let flowTo = false; // flow is the morph's target → fade them IN
  let cssW = 0;
  let cssH = 0;
  let cscale = 0; // resting scale of the current state (per-state fit)
  let scaleFrom = 0; // scale at the start of the current morph (interpolated to cscale)
  let curState = 0; // index of the current cloud state
  let coverX = 1;
  let coverY = 1;
  let cdpr = 1;
  const stateScale = []; // per-state fit scale (min of width/height fit × FIT)

  function makeSprite() {
    const s = document.createElement('canvas');
    s.width = s.height = 16;
    const c = s.getContext('2d');
    const g = c.createRadialGradient(8, 8, 0, 8, 8, 8);
    g.addColorStop(0, `rgba(${DOT_COLOR},1)`);
    g.addColorStop(DOT_HARD, `rgba(${DOT_COLOR},1)`);
    g.addColorStop(1, `rgba(${DOT_COLOR},0)`);
    c.fillStyle = g;
    c.beginPath();
    c.arc(8, 8, 8, 0, Math.PI * 2);
    c.fill();
    return s
  }

  // Gold endpoint node: hot-white core inside a warm halo (same language as impact-map).
  function makeNodeSprite() {
    const s = document.createElement('canvas');
    s.width = s.height = 64;
    const c = s.getContext('2d');
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,236,190,1)');
    g.addColorStop(0.42, 'rgba(230,168,74,0.55)');
    g.addColorStop(1, 'rgba(230,168,74,0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(32, 32, 32, 0, Math.PI * 2);
    c.fill();
    return s
  }

  // Point the current scale + scatter cover at a given state (no morph in flight).
  function setStateScale(idx) {
    curState = idx;
    cscale = stateScale[idx] || cscale;
    scaleFrom = cscale;
    coverX = cscale ? (cssW * 0.5) / cscale : 1;
    coverY = cscale ? (cssH * 0.5) / cscale : 1;
  }

  function cloudResize() {
    if (!visualsWrap || !canvas) return
    const w = visualsWrap.clientWidth;
    const h = visualsWrap.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Assigning canvas.width re-allocates (and clears) the whole backing store, so only do
    // it when the stage really changed — the ResizeObserver fires on no-op layouts too.
    if (w !== cssW || h !== cssH || dpr !== cdpr) {
      cssW = w;
      cssH = h;
      cdpr = dpr;
      canvas.width = cssW * cdpr;
      canvas.height = cssH * cdpr;
      cctx.setTransform(cdpr, 0, 0, cdpr, 0, 0);
    }
    // The flow state fits into the stage MINUS its endpoint labels + node halos, so the
    // labels can never be pushed off the stage (or over the section copy).
    const res = endpointReserve();
    for (let i = 0; i < states.length; i++) {
      const rx = i === flowIndex ? res.x : 0;
      const ry = i === flowIndex ? res.y : 0;
      const halfW = Math.max(cssW * 0.5 - rx - STAGE_PAD, cssW * 0.25);
      const halfH = Math.max(cssH * 0.5 - ry - STAGE_PAD, cssH * 0.25);
      stateScale[i] =
        Math.min(halfW / states[i].extX, halfH / states[i].extY) *
        FIT *
        (TUNING[states[i].kind]?.fill ?? 1); // per-shape stage fill
    }
    cscale = stateScale[curState] || cssW * 0.5 * FIT;
    scaleFrom = cscale;
    coverX = cscale ? (cssW * 0.5) / cscale : 1;
    coverY = cscale ? (cssH * 0.5) / cscale : 1;
    positionEndpoints();
    if (cloudReady) drawCloud();
  }

  // Room the flow tab needs outside the lens: the widest label + the gap + the node halo.
  function endpointReserve() {
    let x = 0;
    endpoints.forEach((el) => {
      x = Math.max(x, el.offsetWidth + LABEL_GAP + NODE_GLOW_R);
    });
    return { x, y: endpoints.length ? NODE_GLOW_R : 0 }
  }

  // Anchor each label just outside its lens tip. `start` sits left of it, `end` right of it
  // (the CSS translates them off their anchor point accordingly). The gap is measured from
  // the OUTER EDGE OF THE NODE HALO, not the tip: the halo reaches NODE_GLOW_R past the tip,
  // so a gap measured from the tip alone puts the text right on top of the glow.
  function positionEndpoints() {
    if (flowIndex < 0 || !endpoints.length || !states) return
    const sc = stateScale[flowIndex] || cscale;
    const off = states[flowIndex].extX * sc + NODE_GLOW_R + LABEL_GAP;
    const cx = cssW / 2;
    const cy = cssH / 2;
    endpoints.forEach((el) => {
      const isEnd = el.getAttribute(ENDPOINT_ATTR) === 'end';
      el.style.left = (isEnd ? cx + off : cx - off) + 'px';
      el.style.top = cy + 'px';
    });
  }

  // Per-point local morph progress at global t: staggered START (target order ⊕ randomness)
  // + per-point DURATION (speed variance). All points reach 1 by t = 1. Smoothstepped.
  function waveLP(i, t) {
    const spreadClamp = MORPH_SPREAD ;
    const delay = (1 - WAVE_RANDOM) * mProj[i] + WAVE_RANDOM * waveJit[i];
    const start = delay * spreadClamp;
    let dur = (1 - start) * (1 - mRand[i] * MORPH_SPEED_VAR);
    if (dur < 1e-3) dur = 1e-3;
    let lp = (t - start) / dur;
    lp = lp < 0 ? 0 : lp > 1 ? 1 : lp;
    return lp * lp * (3 - 2 * lp)
  }

  // Smoothstep window — 0 below a, 1 above b.
  function win(x, a, b) {
    let p = (x - a) / (b - a);
    p = p < 0 ? 0 : p > 1 ? 1 : p;
    return p * p * (3 - 2 * p)
  }

  // Gold nodes at the lens tips — only on the flow tab. They fade in LATE and out EARLY
  // (NODE_IN / NODE_OUT) so they never sit on a cloud that isn't the lens yet.
  function drawNodes(now, t) {
    if (flowIndex < 0) return
    const amt = flowTo
      ? win(t, NODE_IN, 1)
      : flowFrom
        ? 1 - win(t, 0, NODE_OUT)
        : 0;
    if (amt < 0.002) return
    // Pinned to the LENS's own scale, not the interpolated one: the endpoint labels are
    // positioned at that scale, so anything else drifts the node off its label mid-morph.
    const hw = states[flowIndex].extX * (stateScale[flowIndex] || cscale);
    const cy = cssH / 2;
    const cx = cssW / 2;
    const pulse = 0.86 + 0.14 * Math.sin(now * NODE_PULSE);
    const glow = NODE_GLOW_R * (0.9 + 0.1 * pulse);
    cctx.globalAlpha = amt * pulse;
    for (let k = 0; k < 2; k++) {
      const sx = k ? cx + hw : cx - hw;
      cctx.drawImage(nodeSprite, sx - glow, cy - glow, glow * 2, glow * 2);
      cctx.drawImage(
        nodeSprite,
        sx - NODE_CORE_R,
        cy - NODE_CORE_R,
        NODE_CORE_R * 2,
        NODE_CORE_R * 2
      );
    }
    cctx.globalAlpha = 1;
  }

  function drawCloud() {
    cctx.clearRect(0, 0, cssW, cssH);
    if (!cloudReady) return
    const cx = cssW / 2;
    const cy = cssH / 2;
    const now = window.performance.now() * 0.001;
    // Intro / morph / idle share ONE loop on purpose: anything a phase doesn't share becomes
    // a snap when the phase flips (the shimmer anisotropy and the breathing used to appear
    // out of nowhere the instant the intro ended).
    const t = introActive ? 1 : morph.t;
    const morphing = !introActive && t < 1;
    const rscale = introActive ? cscale : scaleFrom + (cscale - scaleFrom) * t; // interpolated per-state scale
    const R2 = HOVER_RADIUS * HOVER_RADIUS;
    // Per-shape, per-axis shimmer: on the line-based shapes it runs ALONG the line, so it
    // can't smear two streamlines into one another. Interpolated across a morph so neither
    // shape's grain snaps in. Read once per frame, not per point.
    const shTo = TUNING[toState.kind]?.shim || UNIT_SHIM;
    const shFrom = morphing ? TUNING[fromState.kind]?.shim || UNIT_SHIM : shTo;
    // Interpolated PER POINT below (by its own migration progress, not the global t): a point
    // that already reached the lens has to shimmer along the lens, or the arrived lines read
    // smeared while the rest of the cloud is still in transit.
    const driftAmpX = SHIMMER_FLOOR * DRIFT * shFrom[0];
    const driftAmpY = SHIMMER_FLOOR * DRIFT * shFrom[1];
    const driftDX = SHIMMER_FLOOR * DRIFT * (shTo[0] - shFrom[0]);
    const driftDY = SHIMMER_FLOOR * DRIFT * (shTo[1] - shFrom[1]);
    // Radial breathing is per shape (`pulse`): flow keeps it at 0 because its lens is pinned
    // to two labelled endpoints, and a pulse there reads as the cities drifting.
    const puTo = BREATH_AMP * (TUNING[toState.kind]?.pulse ?? 1);
    const puFrom = morphing
      ? BREATH_AMP * (TUNING[fromState.kind]?.pulse ?? 1)
      : puTo;
    const puDelta = puTo - puFrom;
    const fade = introActive ? introFade.v : 1;
    const ispan = 1 + INTRO_STAGGER;
    const icovX = coverX * INTRO_SCATTER;
    const icovY = coverY * INTRO_SCATTER;

    for (let i = 0; i < N; i++) {
      // The target is evaluated LIVE, so the incoming shape is already in motion while it
      // assembles — nothing jumps when the morph lands.
      toState.sample(i, now, sbuf);
      let bx = sbuf[0];
      let by = sbuf[1];
      let al = sbuf[2];
      let rm = sbuf[3];
      let amp = 1; // shimmer multiplier — wider while the intro cloud is still dispersed
      let lpv = 1; // this point's migration progress (1 = fully on the target shape)
      if (introActive) {
        let pp = introProg.v * ispan - introDelay[i];
        pp = pp < 0 ? 0 : pp > 1 ? 1 : pp;
        pp = pp * pp * (3 - 2 * pp);
        const dx = startX[i] * icovX;
        const dy = startY[i] * icovY;
        bx = dx + (bx - dx) * pp;
        by = dy + (by - dy) * pp;
        amp = 1 + (1 / SHIMMER_FLOOR - 1) * (1 - pp);
      } else if (morphing) {
        const lp = waveLP(i, t);
        lpv = lp;
        // The OUTGOING shape is sampled live too. Baking it as a frozen snapshot left every
        // point that hadn't started its migration standing still — up to MORPH_SPREAD of the
        // duration — which read as the section pausing on every switch. The residual keeps
        // the hand-off frame-exact even when a switch interrupts another morph.
        fromState.sample(i, now, fbuf);
        const k = 1 - lp;
        const fx = fbuf[0] + resX[i] * k;
        const fy = fbuf[1] + resY[i] * k;
        const fa = fbuf[2] + resA[i] * k;
        bx = fx + (bx - fx) * lp;
        by = fy + (by - fy) * lp;
        al = fa + (al - fa) * lp;
        rm = fbuf[3] + (rm - fbuf[3]) * lp;
      }
      curX[i] = bx;
      curY[i] = by;
      curA[i] = al;
      const ph = now * DRIFT_SPEED * driftFreq[i] + driftPhase[i];
      bx += Math.cos(ph) * dispX[i] * (driftAmpX + driftDX * lpv) * amp;
      by += Math.sin(ph) * dispY[i] * (driftAmpY + driftDY * lpv) * amp;
      const pu = puFrom + puDelta * lpv;
      if (pu !== 0) {
        const dd = Math.sqrt(bx * bx + by * by);
        const breath =
          1 + Math.sin(now * BREATH_SPEED - dd * BREATH_RIPPLE) * pu;
        bx *= breath;
        by *= breath;
      }
      let txo = 0;
      let tyo = 0;
      let glow = 0;
      if (hovActive) {
        const ddx = bx - mx;
        const ddy = by - my;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < R2) {
          const d = Math.sqrt(d2) || 1e-4;
          let f = 1 - d / HOVER_RADIUS;
          f = f * f * (3 - 2 * f);
          const nx = ddx / d;
          const ny = ddy / d;
          txo =
            (nx * HOVER_PUSH - ny * HOVER_SWIRL + dispX[i] * HOVER_SCATTER) * f;
          tyo =
            (ny * HOVER_PUSH + nx * HOVER_SWIRL + dispY[i] * HOVER_SCATTER) * f;
          glow = f;
        }
      }
      offX[i] += (txo - offX[i]) * HOVER_EASE;
      offY[i] += (tyo - offY[i]) * HOVER_EASE;
      al *= fade;
      if (al < ALPHA_SKIP) continue // invisible: the draw is the expensive half of the frame
      const sx = cx + (bx + offX[i]) * rscale;
      const sy = cy + (by + offY[i]) * rscale;
      const r = pointR[i] * rm * (1 + glow * 0.7);
      cctx.globalAlpha = al > 1 ? 1 : al;
      cctx.drawImage(sprite, sx - r, sy - r, r * 2, r * 2);
    }
    cctx.globalAlpha = 1;
    drawNodes(now, t);
  }

  function cloudLoop() {
    drawCloud();
    if (onScreen) window.requestAnimationFrame(cloudLoop);
    else looping = false;
  }
  function ensureCloudLoop() {
    if (!looping && onScreen && cloudReady) {
      looping = true;
      window.requestAnimationFrame(cloudLoop);
    }
  }

  function morphTo(next) {
    // A switch during the intro cuts it short: cur* already holds the frame on screen, so
    // the morph picks up from there (letting the intro finish would reset toState).
    if (introActive) {
      gsap.killTweensOf([introProg, introFade]);
      introActive = false;
      introFade.v = 1;
    }
    // Keep the outgoing shape LIVE as the morph's origin and store only the difference from
    // the frame on screen. That way leaving a moving state neither rewinds (the residual is
    // frame-exact) nor freezes (the shape keeps flowing under the migration).
    const now = window.performance.now() * 0.001;
    fromState = toState;
    for (let i = 0; i < N; i++) {
      fromState.sample(i, now, fbuf);
      resX[i] = curX[i] - fbuf[0];
      resY[i] = curY[i] - fbuf[1];
      resA[i] = curA[i] - fbuf[2];
    }
    scaleFrom = scaleFrom + (cscale - scaleFrom) * morph.t;
    flowFrom = curState === flowIndex;
    flowTo = next === flowIndex;
    toState = states[next];
    curState = next;
    // Morph the scale from the current state's fit to the next one's (interpolated in
    // drawCloud), so the shape grows/shrinks to its own size as it changes.
    cscale = stateScale[next] || cscale;
    coverX = cscale ? (cssW * 0.5) / cscale : 1;
    coverY = cscale ? (cssH * 0.5) / cscale : 1;
    mProj.set(states[next].order); // the target's own parametric order drives the sweep
    morph.t = 0;
    gsap.killTweensOf(morph);
    gsap.to(morph, { t: 1, duration: MORPH_DURATION, ease: MORPH_EASE });
    ensureCloudLoop();
  }

  function runIntro(target) {
    toState = states[target];
    fromState = states[target];
    setStateScale(target); // intro draws at the target state's own scale
    mProj.set(states[target].order);
    flowTo = target === flowIndex;
    flowFrom = false;
    introActive = true;
    introProg.v = 0;
    introFade.v = 0;
    gsap.killTweensOf([introProg, introFade]);
    gsap
      .timeline({ onComplete: () => finishIntro(target) })
      .to(introFade, { v: 1, duration: INTRO_FADE, ease: 'power1.out' }, 0)
      .to(
        introProg,
        { v: 1, duration: INTRO_DURATION, ease: 'power2.inOut' },
        INTRO_HOLD
      );
    ensureCloudLoop();
  }

  function finishIntro(target) {
    introActive = false;
    toState = states[target];
    setStateScale(target);
    morph.t = 1; // lp = 1 everywhere → the next frame bakes the shape into cur*
    drawCloud();
  }

  // Tell the cloud which tab is active. The first call plays the intro converging onto
  // that state, subsequent calls morph.
  function cloudGo(i) {
    if (!cloudOk) return
    if (!cloudReady) {
      pendingGo = i;
      return
    }
    if (!introduced) {
      introduced = true;
      runIntro(i);
    } else if (states[i] && toState !== states[i]) {
      morphTo(i);
    }
  }

  function bootCloud() {
    canvas = document.createElement('canvas');
    canvas.className = 'tabs-compouding_pointcloud';
    canvas.setAttribute('aria-hidden', 'true');
    visualsWrap.appendChild(canvas);
    cctx = canvas.getContext('2d');
    sprite = makeSprite();
    nodeSprite = makeNodeSprite();

    states = shapeKinds.map((kind, i) =>
      makeShape(kind, N, mulberry32(1000 + i))
    );
    toState = states[0];
    morph.t = 1;
    mProj.set(states[0].order);

    const frng = mulberry32(7);
    for (let i = 0; i < N; i++) {
      const ang = frng() * Math.PI * 2;
      const mg = frng();
      dispX[i] = Math.cos(ang) * mg;
      dispY[i] = Math.sin(ang) * mg;
      startX[i] = frng() * 2 - 1;
      startY[i] = frng() * 2 - 1;
      introDelay[i] = frng() * INTRO_STAGGER;
      driftPhase[i] = frng() * Math.PI * 2;
      driftFreq[i] = 1 + (frng() - 0.5) * 2 * DRIFT_FREQ_VAR;
      waveJit[i] = frng();
      mRand[i] = frng();
      pointR[i] =
        frng() < BIG_DOT_CHANCE
          ? BIG_R[0] + frng() * (BIG_R[1] - BIG_R[0])
          : SMALL_R[0] + frng() * (SMALL_R[1] - SMALL_R[0]);
    }

    // .is-canvas BEFORE the first measure: it makes the endpoint labels absolute, and
    // cloudResize() reserves room for them from their offsetWidth — measured in normal flow
    // a label reports the whole stage width, so the flow lens got fitted into a quarter of
    // the stage and then jumped to its real size on the first resize.
    root.classList.add('is-canvas'); // CSS hides the source imgs, shows the canvas
    cloudResize();
    // Re-measure on ANY wrapper size change (not just width) so the canvas buffer
    // keeps the stage's aspect — otherwise it stretches and the shapes skew.
    if (window.ResizeObserver) {
      new window.ResizeObserver(() => cloudResize()).observe(visualsWrap);
    }

    fromState = states[0];
    for (let i = 0; i < N; i++) {
      states[0].sample(i, 0, sbuf);
      curX[i] = sbuf[0];
      curY[i] = sbuf[1];
      curA[i] = sbuf[2];
    }

    cloudOk = true;
    cloudReady = true;
    if (pendingGo != null) cloudGo(pendingGo);
    else if (onScreen) cloudGo(index);
    updateFlowLabels(index); // show the labels if we booted onto the flow tab
  }

  // Crossfade fallback (no visual wrapper → no canvas): the original paradigm behaviour.
  function crossfadeVisuals(i) {
    visuals.forEach((v, k) =>
      gsap.to(v, {
        autoAlpha: k === i ? 1 : 0,
        duration: 0.6,
        ease: 'sine.out',
      })
    );
  }

  // Endpoint labels fade in only on the flow tab, each at its own speed (staggered) — and
  // only once the cloud has become the lens (they're anchored to its tips, so showing them
  // earlier parks them on whatever shape is still morphing away).
  function updateFlowLabels(i) {
    if (!cloudOk || flowIndex < 0 || !endpoints.length) return
    gsap.killTweensOf(endpoints);
    if (i === flowIndex) {
      positionEndpoints();
      const wait = introActive
        ? INTRO_HOLD + INTRO_DURATION * 0.8
        : MORPH_DURATION * LABEL_IN;
      endpoints.forEach((el, k) =>
        gsap.to(el, {
          autoAlpha: 1,
          duration: LABEL_FADE * (0.85 + k * 0.35),
          ease: 'power2.out',
          delay: wait + k * LABEL_STAGGER,
        })
      );
    } else {
      gsap.to(endpoints, { autoAlpha: 0, duration: 0.3, ease: 'sine.out' });
    }
  }

  // ===================== Paradigm chrome (underline + text + autoplay) =========
  let index = 0;
  let started = false;
  let progressTl = null;
  let onScreen = false;
  let hover = false;
  let docVisible = !document.hidden;

  const shouldPlay = () => started && onScreen && !hover && docVisible;
  const sync = () => {
    if (!progressTl) return
    shouldPlay() ? progressTl.play() : progressTl.pause();
  };

  const activate = (i) => {
    links.forEach((l, k) => {
      l.classList.toggle('is-active', k === i);
      l.setAttribute('aria-current', k === i ? 'true' : 'false');
    });

    titles.forEach((t, k) => {
      if (k !== i) gsap.to(t, REVEAL_OUT);
    });
    gsap.set(titles[i], { autoAlpha: 1 });
    gsap.set(wordsByTab[i], REVEAL_FROM);
    gsap.to(wordsByTab[i], REVEAL_TO);

    // Visuals: point-cloud morph when the canvas is live, else image crossfade.
    if (cloudEnabled) {
      cloudGo(i);
      updateFlowLabels(i);
    } else {
      crossfadeVisuals(i);
    }
  };

  // Every non-active number's fill stays empty (inactive).
  const setStaticFills = (i) => {
    bars.forEach((bar, k) => {
      if (k === i) return
      gsap.set(bar, { scaleX: 0, transformOrigin: 'left center' });
    });
  };

  // Underline = autoplay progress, active-only: only the active number's fill grows
  // 0→1 over its text-scaled dwell; the others stay empty. Advances on complete.
  const runProgress = () => {
    progressTl && progressTl.kill();
    setStaticFills(index);
    progressTl = gsap.timeline({ onComplete: () => goTo((index + 1) % count) });
    const bar = bars[index];
    gsap.set(bar, { scaleX: 0, transformOrigin: 'left center' });
    progressTl.to(
      bar,
      {
        scaleX: 1,
        duration: autoplayDuration(messages[index]),
        ease: 'none',
      },
      0
    );
    sync();
  };

  // Collapse the messages column onto the active tab, so a short tab doesn't drag the
  // longest tab's leftover height around with it. Measured off the DOM (the CSS
  // `align-items: start` keeps each stacked title at its own content height, so a stretched
  // grid item can't report the row height back) rather than counting lines — line-height
  // math is unreliable in rich text (mixed sizes, margins, wrapped inline markup).
  // `immediate` skips the tween on load and on resize, where there is no switch to ride.
  const fitMessages = (i, immediate) => {
    if (!messagesWrap) return
    const h = titles[i].offsetHeight;
    if (immediate) gsap.set(messagesWrap, { height: h });
    else gsap.to(messagesWrap, { height: h, ...FIT_TWEEN });
  };

  fitMessages(0, true); // no collapse animation on load
  // Webfonts land after init and reflow the copy — re-measure once they're in.
  document.fonts?.ready.then(() => fitMessages(index, true));

  function goTo(i) {
    index = i;
    activate(i);
    fitMessages(i);
    runProgress();
  }

  const start = () => {
    if (started) return
    started = true;
    goTo(0);
  };

  const select = (i) => {
    started = true;
    goTo(i);
  };

  const wireButton = (el, onActivate, label) => {
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', label);
    el.addEventListener('click', onActivate);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate();
      }
    });
  };

  // Clicking a number in the menu jumps to that tab.
  links.forEach((l, i) =>
    wireButton(l, () => select(i), 'Go to slide ' + (i + 1))
  );

  // Visibility / hover / tab-focus gating (drives autoplay AND the cloud loop).
  const io = new window.IntersectionObserver(
    (entries) => {
      onScreen = entries[0].isIntersecting;
      if (onScreen) {
        if (!started) start();
        else sync();
        ensureCloudLoop();
      } else {
        sync();
        if (cloudReady) cctx.clearRect(0, 0, cssW, cssH);
      }
    },
    {
      // threshold stays 0 + a negative rootMargin: intersectionRatio is capped at
      // viewportHeight/elementHeight, so a section taller than ~2.5x the viewport
      // (routine on mobile) never reaches a 0.4 threshold and this never fires.
      threshold: 0,
      rootMargin: '-25% 0px -25% 0px',
    }
  );
  io.observe(root)

  // Pause autoplay only while hovering the content (text + visual).
  ;[messagesWrap, visualsWrap].forEach((el) => {
    if (!el) return
    el.addEventListener('mouseenter', () => {
      hover = true;
      sync();
    });
    el.addEventListener('mouseleave', () => {
      hover = false;
      sync();
    });
  });
  document.addEventListener('visibilitychange', () => {
    docVisible = !document.hidden;
    sync();
  });

  // Cloud hover-nebula over the visual stage (desktop only). Separate from the autoplay
  // pause above — hovering loosens the cloud but doesn't need to stop the morph.
  if (cloudEnabled) {
    visualsWrap.addEventListener('pointermove', (e) => {
      if (!desktopHover.matches || !cscale) return
      const rect = visualsWrap.getBoundingClientRect();
      mx = (e.clientX - rect.left - cssW / 2) / cscale;
      my = (e.clientY - rect.top - cssH / 2) / cscale;
      ensureCloudLoop();
    });
    visualsWrap.addEventListener('pointerenter', () => {
      if (!desktopHover.matches) return
      hovActive = true;
      ensureCloudLoop();
    });
    visualsWrap.addEventListener('pointerleave', () => {
      hovActive = false;
      ensureCloudLoop();
    });
    desktopHover.addEventListener('change', (e) => {
      if (!e.matches) hovActive = false;
    });
    bootCloud();
  }

  return {
    resize() {
      if (cloudOk) cloudResize();
      // Column width drives how the copy wraps, so the active tab's height changes with it.
      fitMessages(index, true);
    },
  }
}

// Static fallback (no GSAP / reduced motion): show the first tab only via classes.
function staticFallback(root) {
  const first = (sel) => root.querySelector(sel);
  first('[data-compunding="tab-title"]')?.classList.add('is-active');
  first('[data-paradigm="tab-link"]')?.classList.add('is-active');
  first('[data-paradigm-visual]')?.classList.add('is-active');
  root.classList.add('is-static');
}

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='compouding']
 */
function compouding (elements) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!gsap || reduce) {
    if (!gsap)
      console.warn('[compouding] GSAP not found on window — static fallback');
    elements.forEach(staticFallback);
    return
  }

  const instances = elements.map(setupRoot).filter(Boolean);
  if (!instances.length) return

  return {
    resize() {
      instances.forEach((inst) => inst.resize());
    },
  }
}

export { compouding as default };
//# sourceMappingURL=compouding-Cv3SqnH0.js.map
