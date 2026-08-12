/*
  Component: impact-map · data-component="impact-map"
  Perpetual clock-derived odometer % (same for every visitor, never resets), optionally
  beside a night-lights map of the Americas: the glow is made of DOTS, never painted
  blobs — hub clusters + a faint field that keeps lighting up and dying forever. Canada,
  Greenland and Alaska are out of frame by construction. Geometry (d3-geo + topojson +
  world-atlas) loads on demand from CDN; the canvas is injected, so Webflow ships 3 elements.
  NO [data-impact-stage] in the markup = counter only: nothing injected, no CDN fetch.
  CSS → ./styles/impact-map.css (bundled via src/styles.js) · Docs → .claude/rules/components/impact-map.md
*/

import { HUBS, AMBIENT } from '../utils/impact-cities.js'

// ---- Framing -------------------------------------------------------------------
// The bbox IS the crop. -125 drops Alaska (its eastern tip reaches -130) WITHOUT
// cutting the US west coast: Cape Mendocino sits at -124.4 and projects ~5px from
// the frame, so anything east of -124 loses California. lat1 50 sits just above the
// US border, which is where the drawn land now ends (see EXCLUDE).
// THE CSS aspect-ratio MUST MATCH this span (91 / 106) or the map letterboxes inside
// its own stage — one rule in impact-map.css, same contract as the old viewBox.
const BBOX = { lng0: -125, lng1: -34, lat0: -56, lat1: 50 }

// Not drawn at all — not merely cropped. The land mask is built from the SAME
// filtered list, so no dot is ever seeded on land that isn't painted.
const EXCLUDE = ['Canada', 'Greenland']

// Dot budget per device. The field is dense from the first frame, so this is the
// number that decides both the look and the frame cost — `cluster + live` IS the
// per-frame budget. `cluster` is split across the 73 hubs by weight, so it has to grow
// with the table: at 20000 the biggest hub gets ~580 dots and a mid one ~260.
const DESKTOP = { cluster: 20000, live: 12000, pool: 34000 }
const MOBILE = { cluster: 8000, live: 5000, pool: 16000 }
const MOBILE_Q = '(max-width: 767px)'

// ---- Tuning — counter -----------------------------------------------------------
// Growth is authored in the honest unit: percentage POINTS gained per year. The visual
// tick speed is set separately by DECIMALS — one extra decimal = a 10× faster tick at
// the SAME real growth. Keeping them apart is the point: rhythm without inflating the
// figure. At DECIMALS 10 / RISE_PER_YEAR 0.005 the last digit ticks every ~0.6s.
const RISE_PER_YEAR = 0.005
const DECIMALS = 10 // decimals shown — coarse speed knob (more = 10× faster, longer number)
const YEAR = 31557600 // seconds in an average Gregorian year
const CARRY = 0.25 // fraction of ONE last-digit step spent rolling over (lower = snappier)

// The counter is a pure function of the clock: value = target + RISE_PER_YEAR × (now − EPOCH).
// No backend — every visitor sees the same number at the same instant and a reload never
// resets it. Override per section with data-impact-epoch (ISO date).
const EPOCH = '2026-07-28T00:00:00Z'
const RISE_RATE = RISE_PER_YEAR / YEAR // percentage points per second

// ---- Tuning — dots --------------------------------------------------------------
const CLUSTER_SPREAD = 1 // hub reach multiplier
const BIG_SHARE = 0.08 // share of cluster dots drawn big (biased to the core)
const BIG_SIZE = 1.8
const SMALL_SIZE = 0.62
const CLUSTER_FALLOFF = 0.55 // how much dimmer a cluster's edge is than its core
const CLUSTER_ALPHA = 1

const AMBIENT_CITY_SHARE = 0.35 // share of the pool seeded around AMBIENT cities
const AMBIENT_ALPHA = 0.42 // many dots → little ink each, or the field washes out
const AMBIENT_SIZE = 0.8
const FOCUS = 0.15 // ambient falloff with distance to the nearest hub (0 = flat field)
const FOCUS_HALF = 12 // degrees at which that falloff halves

const LIFE = 7 // seconds a faint dot stays lit
const LIFE_VAR = 0.6 // ± share of LIFE, so deaths never sync into waves
const FADE = 1.6 // seconds of fade in / out

const ANCHOR_SIZE = 1
const ANCHOR_BLOOM = 0.55
const ANCHOR_ALPHA = 1
// Twinkle rides on EVERY lit dot, faint field included. Without it the map reads as a
// still photograph: 26 000 dots each changing by a hair is invisible, one shimmer
// across all of them is not. Speed is per dot (from its seed) so nothing pulses in sync.
const TWINKLE = 0.28 // amplitude — 0.28 swings a dot between 0.44 and 1
const TWINKLE_SPEED = [0.55, 1.7] // rad/s, picked per dot from its seed

const BORDER_WIDTH = 0.6 // px; the colour + its alpha come from --im-border
const VIGNETTE = 0.25
const DOT_SIZE = 1 // global multiplier
const SEED = 137 // fixed: the same map on every load
const RECT_MAX = 1.1 // below this radius a dot is a fillRect, not an arc (see flushBuckets)

// Adaptive budget (see the frame loop): thresholds for giving up ambient dots on a
// device that can't hold the frame.
const SLOW_MS = 22 // a frame slower than this counts as slow
const SLOW_FRAMES = 90 // sustained slow frames before stepping down
const DOWNGRADE_KEEP = 0.6 // share of the ambient field kept per step
const DOWNGRADES_MAX = 2

// Palette fallbacks — the live values are read from the CSS custom properties on the
// root, so colour stays tunable in impact-map.css.
const PALETTE = {
  ocean: [3, 6, 11, 1],
  land: [10, 10, 10, 1],
  border: [232, 226, 210, 0.55],
  light: [255, 207, 90, 1],
  hot: [255, 240, 194, 1],
}

// ---- Map libs + geometry: imported from CDN once, shared across instances --------
let mapPromise
function loadMap() {
  if (!mapPromise) {
    mapPromise = (async () => {
      const [geo, topojson] = await Promise.all([
        import('https://cdn.jsdelivr.net/npm/d3-geo@3/+esm'),
        import('https://cdn.jsdelivr.net/npm/topojson-client@3/+esm'),
      ])
      const world = await fetch(
        'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json'
      ).then((r) => r.json())
      const countries = topojson.feature(
        world,
        world.objects.countries
      ).features
      return { geo, countries }
    })()
  }
  return mapPromise
}

// A country belongs to the Americas if its centroid sits in the western hemisphere
// band. The -125 lower bound is what excludes far-Pacific island nations; every
// mainland American centroid is east of it.
function isAmericas(geo, f) {
  const c = geo.geoCentroid(f)
  return c[0] >= -125 && c[0] <= -33 && c[1] >= -58 && c[1] <= 84
}

function drawnFeatures(americas) {
  return {
    type: 'FeatureCollection',
    features: americas.filter(
      (f) => EXCLUDE.indexOf((f.properties && f.properties.name) || '') === -1
    ),
  }
}

// ---- Helpers ---------------------------------------------------------------------
const lerp = (a, b, t) => a + (b - a) * t
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const smooth = (t) => t * t * (3 - 2 * t)
const rgba = (c, a) =>
  'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')'

function makeRng(seed) {
  let s = seed >>> 0
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

// Sum of three uniforms ≈ gaussian, centred on 0.
const gauss = (rng) => rng() + rng() + rng() - 1.5

// Per-dot shimmer. `sd` seeds both the phase and the speed, so no two dots share a beat.
const twinkle = (sd, t) =>
  1 -
  TWINKLE +
  TWINKLE *
    Math.sin(
      t * (TWINKLE_SPEED[0] + sd * (TWINKLE_SPEED[1] - TWINKLE_SPEED[0])) +
        sd * 6.283
    )

// Reads a CSS custom property as [r,g,b,a]. Only hex and rgb()/rgba() are supported —
// that's what the stylesheet uses; anything else falls back.
function readColor(root, name, fallback) {
  const raw = getComputedStyle(root).getPropertyValue(name).trim()
  if (!raw) return fallback
  if (raw[0] === '#') {
    const h = raw.slice(1)
    const full =
      h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h.slice(0, 6)
    const n = parseInt(full, 16)
    if (isNaN(n)) return fallback
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]
  }
  const m = raw.match(/rgba?\(([^)]+)\)/)
  if (!m) return fallback
  const p = m[1]
    .split(/[,\s/]+/)
    .filter(Boolean)
    .map(parseFloat)
  if (p.length < 3 || p.some(isNaN)) return fallback
  return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]
}

function readPalette(root) {
  return {
    ocean: readColor(root, '--im-ocean', PALETTE.ocean),
    land: readColor(root, '--im-land', PALETTE.land),
    border: readColor(root, '--im-border', PALETTE.border),
    light: readColor(root, '--im-light', PALETTE.light),
    hot: readColor(root, '--im-hot', PALETTE.hot),
  }
}

// ---- Projection ------------------------------------------------------------------
// WINDING ORDER IS LOAD-BEARING: NW -> NE -> SE -> SW. d3-geo polygons are SPHERICAL;
// wound the other way this ring means "the whole sphere except this box" and fitExtent
// scales the entire world into the stage. The horizontal edges must also be DENSIFIED:
// d3 joins consecutive vertices with GREAT CIRCLES, so a top edge drawn as one segment
// bows ~10° north — ten degrees of Canada nobody asked for. Meridians already are great
// circles. Verified: the four corners project exactly onto the frame.
const BBOX_SEGMENTS = 24

function bboxPolygon(b) {
  const ring = []
  const step = (b.lng1 - b.lng0) / BBOX_SEGMENTS
  for (let i = 0; i <= BBOX_SEGMENTS; i++)
    ring.push([b.lng0 + step * i, b.lat1])
  for (let i = BBOX_SEGMENTS; i >= 0; i--)
    ring.push([b.lng0 + step * i, b.lat0])
  ring.push([b.lng0, b.lat1])
  return { type: 'Polygon', coordinates: [ring] }
}

// Land test = a rasterised bitmask, not geometry. geoContains walks a whole polygon
// ring per call (~0.2ms per sample even with a bbox prefilter, because the bboxes of
// Brazil and the USA never reject); this component samples tens of thousands of
// candidate positions at build, which would be a frozen tab. So the land is drawn once
// into an offscreen canvas and reduced to one byte per pixel — a test is an array read.
// The lookup runs the SAME projection used to rasterise, so the two agree by
// construction. Do not replace that call with arithmetic: equirectangular LOOKS linear,
// but fitExtent lands elsewhere because d3 treats the ring's edges as great circles.
const MASK_W = 1024 // ~0.09 deg/px over this bbox, ≈10 km

function buildLandMask(geo, land) {
  const w = MASK_W
  const h = Math.max(
    1,
    Math.round((w * (BBOX.lat1 - BBOX.lat0)) / (BBOX.lng1 - BBOX.lng0))
  )
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  const proj = geo.geoEquirectangular().fitExtent(
    [
      [0, 0],
      [w, h],
    ],
    bboxPolygon(BBOX)
  )
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  geo.geoPath(proj, ctx)(land)
  ctx.fill()

  const px = ctx.getImageData(0, 0, w, h).data
  const mask = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    // Alpha, not colour: anti-aliased coastline pixels count as land, which keeps thin
    // islands from vanishing at this resolution.
    if (px[i * 4 + 3] > 8) mask[i] = 1
  }
  return function (lng, lat) {
    const p = proj([lng, lat])
    if (!p) return false
    const x = p[0] | 0
    const y = p[1] | 0
    if (x < 0 || y < 0 || x >= w || y >= h) return false
    return mask[y * w + x] === 1
  }
}

// ---- Dot tiers -------------------------------------------------------------------
// `foc` is 1 at a hub and → 0 far from every hub; cluster dots sit on their hub by
// construction, so they default to 1.
function packDots(lng, lat, rad, alp, sd, foc) {
  const n = lng.length
  return {
    n,
    lng: Float32Array.from(lng),
    lat: Float32Array.from(lat),
    rad: Float32Array.from(rad),
    alp: Float32Array.from(alp),
    sd: Float32Array.from(sd),
    foc: foc ? Float32Array.from(foc) : new Float32Array(n).fill(1),
    screen: new Float32Array(n * 2),
  }
}

function focusWeight(lng, lat) {
  let best = Infinity
  for (let i = 0; i < HUBS.length; i++) {
    const dx = lng - HUBS[i][2]
    const dy = lat - HUBS[i][1]
    const d = dx * dx + dy * dy
    if (d < best) best = d
  }
  return 1 / (1 + Math.sqrt(best) / FOCUS_HALF)
}

// The hub's glow is THIS — thousands of small lights packed around it, with a few
// bigger ones near the core. Not a painted blob: a blob has a rim and reads as paint,
// a swarm reads as a city.
function buildCluster(onLand, count, rng) {
  const lng = []
  const lat = []
  const rad = []
  const alp = []
  const sd = []
  if (count <= 0) return packDots(lng, lat, rad, alp, sd)
  const sumW = HUBS.reduce((s, h) => s + h[3], 0)

  HUBS.forEach((h) => {
    const w = h[3]
    const n = Math.max(6, Math.round((count * w) / sumW))
    // Reach grows with the hub: a big city sprawls further. Degrees, near-equal on
    // both axes — in plate carrée equal degrees are equal pixels, so it reads round.
    const reach = (0.5 + w * 2.3) * CLUSTER_SPREAD
    let guard = 0
    let made = 0
    while (made < n && guard < n * 12) {
      guard++
      const gx = gauss(rng)
      const gy = gauss(rng)
      const d = Math.min(1, Math.sqrt(gx * gx + gy * gy) / 1.5) // 0 core → 1 edge
      const plng = h[2] + gx * reach
      const plat = h[1] + gy * reach * 0.92
      if (plng < BBOX.lng0 || plng > BBOX.lng1) continue
      if (plat < BBOX.lat0 || plat > BBOX.lat1) continue
      if (!onLand(plng, plat)) continue
      // Big dots near the core, small ones everywhere: the size gradient is what
      // gives the mass a centre.
      const big = rng() < BIG_SHARE * (1 - d * 0.8)
      const fade = 1 - CLUSTER_FALLOFF * d
      lng.push(plng)
      lat.push(plat)
      rad.push(
        big ? BIG_SIZE * (0.8 + w * 0.5) : SMALL_SIZE * (0.7 + rng() * 0.7)
      )
      alp.push(
        clamp((big ? 0.75 : 0.3 + rng() * 0.3) * (0.45 + w * 0.55) * fade, 0, 1)
      )
      sd.push(rng())
      made++
    }
  })
  return packDots(lng, lat, rad, alp, sd)
}

// A POOL, not a dot list: every entry is a pre-validated on-land position, projected
// once. A dying dot just takes another index — so "keep populating the map forever"
// costs an array read per death instead of rejection sampling mid-frame.
function buildPool(onLand, size, rng) {
  const lng = []
  const lat = []
  const rad = []
  const alp = []
  const sd = []
  const foc = []
  if (size <= 0) return packDots(lng, lat, rad, alp, sd, foc)

  const add = (plng, plat, w) => {
    lng.push(plng)
    lat.push(plat)
    rad.push(0.35 + rng() * 0.45 + w * 1.2)
    alp.push(clamp(0.18 + w * 1.6 + rng() * 0.12, 0, 1))
    sd.push(rng())
    foc.push(focusWeight(plng, plat))
  }

  const totalW = AMBIENT.reduce((s, c) => s + c[3], 0)
  const pickCity = () => {
    let r = rng() * totalW
    for (let i = 0; i < AMBIENT.length; i++) {
      r -= AMBIENT[i][3]
      if (r <= 0) return AMBIENT[i]
    }
    return AMBIENT[0]
  }

  const cityCount = Math.round(size * AMBIENT_CITY_SHARE)
  let guard = 0
  while (lng.length < cityCount && guard < cityCount * 30) {
    guard++
    const c = pickCity()
    // Weaker cities scatter wider — a small town is a smudge, a big one a dense knot.
    const s = 0.8 + (1 - c[3]) * 2.4
    const plng = c[2] + gauss(rng) * s
    const plat = c[1] + gauss(rng) * s * 0.9
    if (plng < BBOX.lng0 || plng > BBOX.lng1) continue
    if (plat < BBOX.lat0 || plat > BBOX.lat1) continue
    if (!onLand(plng, plat)) continue
    add(plng, plat, c[3] * 0.35)
  }

  guard = 0
  while (lng.length < size && guard < size * 60) {
    guard++
    const plng = BBOX.lng0 + rng() * (BBOX.lng1 - BBOX.lng0)
    const plat = BBOX.lat0 + rng() * (BBOX.lat1 - BBOX.lat0)
    if (!onLand(plng, plat)) continue
    add(plng, plat, 0.02 + rng() * 0.06)
  }

  // Shuffle: the respawn cursor walks the pool in order, and the pool is built
  // city-block first / uniform second. Unshuffled, the field would light up in
  // regional waves instead of everywhere at once.
  const order = []
  for (let i = 0; i < lng.length; i++) order.push(i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0
    const t = order[i]
    order[i] = order[j]
    order[j] = t
  }
  return packDots(
    order.map((i) => lng[i]),
    order.map((i) => lat[i]),
    order.map((i) => rad[i]),
    order.map((i) => alp[i]),
    order.map((i) => sd[i]),
    order.map((i) => foc[i])
  )
}

// Slots are the LIVE dots: each points at a pool index and holds its own birth +
// lifetime. On death it re-points somewhere else, so the field never settles.
function initSlots(poolN, want, rng) {
  // Capped below the pool: with every index in use, takeIndex would walk the whole
  // pool on each death, and the field would have nowhere new to move to.
  const live = Math.min(want, Math.floor(poolN * 0.85))
  const slots = {
    n: live,
    idx: new Int32Array(live),
    birth: new Float32Array(live),
    life: new Float32Array(live),
    inUse: new Uint8Array(poolN),
    cursor: 0,
    rng,
  }
  for (let s = 0; s < live; s++) {
    slots.idx[s] = takeIndex(slots, poolN)
    slots.life[s] = LIFE * (1 + (rng() * 2 - 1) * LIFE_VAR)
    // A NEGATIVE birth means the dot is already partway through its life at t=0 —
    // that is what makes the map open FULLY POPULATED instead of building up from an
    // empty continent.
    slots.birth[s] = -rng() * slots.life[s]
  }
  return slots
}

function takeIndex(slots, poolN) {
  let guard = 0
  do {
    slots.cursor = (slots.cursor + 1) % poolN
    guard++
  } while (slots.inUse[slots.cursor] && guard < poolN)
  slots.inUse[slots.cursor] = 1
  return slots.cursor
}

function respawn(slots, s, t, poolN) {
  slots.inUse[slots.idx[s]] = 0
  slots.idx[s] = takeIndex(slots, poolN)
  slots.birth[s] = t
  slots.life[s] = LIFE * (1 + (slots.rng() * 2 - 1) * LIFE_VAR)
}

// ---- Rendering -------------------------------------------------------------------
function makeSprite(pal) {
  const S = 64
  const c = document.createElement('canvas')
  c.width = c.height = S
  const ctx = c.getContext('2d')
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  g.addColorStop(0, rgba(pal.hot, 1))
  g.addColorStop(0.25, rgba(pal.light, 0.5))
  g.addColorStop(0.6, rgba(pal.light, 0.12))
  // Transparent GOLD, never `transparent` (= rgba(0,0,0,0)), which would interpolate
  // through grey and dirty the falloff.
  g.addColorStop(1, rgba(pal.light, 0))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  return c
}

// Dots are batched into alpha buckets: a handful of draw calls instead of tens of
// thousands. Buffers are preallocated — pushing into JS arrays every frame is pure GC
// churn at this count.
const BUCKETS = 6

function ensureBuckets(st, total) {
  const need = Math.max(64, total)
  if (st.buckets && st.buckets[0].length >= need * 3) return
  st.buckets = []
  for (let i = 0; i < BUCKETS; i++) st.buckets.push(new Float32Array(need * 3))
  st.bucketN = new Int32Array(BUCKETS)
}

function pushDot(st, a, x, y, r) {
  const b = Math.min(BUCKETS - 1, (a * BUCKETS) | 0)
  const n = st.bucketN[b]
  const buf = st.buckets[b]
  if (n * 3 + 2 >= buf.length) return
  buf[n * 3] = x
  buf[n * 3 + 1] = y
  buf[n * 3 + 2] = r
  st.bucketN[b] = n + 1
}

function flushBuckets(st, ctx) {
  const pal = st.pal
  for (let b = 0; b < BUCKETS; b++) {
    const n = st.bucketN[b]
    if (!n) continue
    const buf = st.buckets[b]
    const f = (b + 0.5) / BUCKETS
    // Dim lights stay gold; only the densest cores clip toward cream, the way a
    // long-exposure sensor does. The ramp is f² on purpose — linear turned most of the
    // field pale, and the brief is a YELLOW map, not a white one.
    const k = f * f
    const col = [
      lerp(pal.light[0], pal.hot[0], k),
      lerp(pal.light[1], pal.hot[1], k),
      lerp(pal.light[2], pal.hot[2], k),
    ]
    ctx.fillStyle = rgba(col, f.toFixed(3))
    // Most of the field is sub-pixel, and at that size a square and a circle are the
    // same pixels — but an arc has to be tessellated into a path and a rect does not.
    // That split is what makes tens of thousands of dots affordable per frame.
    ctx.beginPath()
    let arcs = 0
    for (let i = 0; i < n; i++) {
      const r = buf[i * 3 + 2]
      if (r < RECT_MAX) continue
      arcs++
      ctx.moveTo(buf[i * 3] + r, buf[i * 3 + 1])
      ctx.arc(buf[i * 3], buf[i * 3 + 1], r, 0, 6.283)
    }
    if (arcs) ctx.fill()
    for (let i = 0; i < n; i++) {
      const r = buf[i * 3 + 2]
      if (r >= RECT_MAX) continue
      const d = r * 2
      ctx.fillRect(buf[i * 3] - r, buf[i * 3 + 1] - r, d, d)
    }
  }
}

function renderEarth(st) {
  const c = st.earthCanvas
  const ctx = c.getContext('2d')
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, c.width, c.height)
  ctx.scale(st.dpr, st.dpr)

  ctx.fillStyle = rgba(st.pal.ocean, st.pal.ocean[3])
  ctx.fillRect(0, 0, st.W, st.H)

  const path = st.geo.geoPath(st.projection, ctx)
  ctx.beginPath()
  path(st.land)
  ctx.fillStyle = rgba(st.pal.land, st.pal.land[3])
  ctx.fill()
  if (st.pal.border[3] > 0 && BORDER_WIDTH > 0) {
    ctx.strokeStyle = rgba(st.pal.border, st.pal.border[3])
    ctx.lineWidth = BORDER_WIDTH
    ctx.stroke()
  }
  st.earthDirty = false
}

function renderDots(st, ctx) {
  const t = st.time
  const cl = st.cluster
  const pool = st.pool
  const slots = st.slots
  // Radii are authored against an 800px-tall stage, so the look holds at any size.
  const px = (st.H / 800) * DOT_SIZE

  ensureBuckets(st, cl.n + (slots ? slots.n : 0))
  st.bucketN.fill(0)

  for (let i = 0; i < cl.n; i++) {
    const x = cl.screen[i * 2]
    if (x !== x) continue
    const tw = st.still ? 1 : twinkle(cl.sd[i], t)
    const a = clamp(cl.alp[i] * CLUSTER_ALPHA * tw, 0, 1)
    if (a < 0.01) continue
    pushDot(st, a, x, cl.screen[i * 2 + 1], Math.max(0.35, cl.rad[i] * px))
  }

  if (slots && pool.n) {
    for (let s = 0; s < slots.n; s++) {
      const idx = slots.idx[s]
      const x = pool.screen[idx * 2]
      if (x !== x) continue

      let env = 1
      if (!st.still) {
        const life = slots.life[s]
        const age = t - slots.birth[s]
        if (age >= life) {
          respawn(slots, s, t, pool.n)
          continue
        }
        const fade = Math.min(FADE, life * 0.45)
        env =
          smooth(clamp(Math.min(age, life - age) / fade, 0, 1)) *
          twinkle(pool.sd[idx], t)
      }
      // Focus falloff: the field covers the whole continent, the hubs still own the
      // eye. The weight is baked in at build (focusWeight).
      const foc = 1 - FOCUS * (1 - pool.foc[idx])
      const a = clamp(pool.alp[idx] * AMBIENT_ALPHA * env * foc, 0, 1)
      if (a < 0.01) continue
      pushDot(
        st,
        a,
        x,
        pool.screen[idx * 2 + 1],
        Math.max(0.3, pool.rad[idx] * AMBIENT_SIZE * px)
      )
    }
  }

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  flushBuckets(st, ctx)

  // Anchors last, over their own cluster: bloom sprite + hot core.
  for (let i = 0; i < st.anchors.length; i++) {
    const a = st.anchors[i]
    if (a.x !== a.x) continue
    if (ANCHOR_BLOOM > 0) {
      const r = (6 + a.w * 26) * px * ANCHOR_BLOOM
      ctx.globalAlpha = clamp(0.22 + a.w * 0.3, 0, 1) * ANCHOR_ALPHA
      ctx.drawImage(st.sprite, a.x - r, a.y - r, r * 2, r * 2)
    }
    const cr = Math.max(0.5, (0.9 + a.w * 1.7) * px * ANCHOR_SIZE)
    ctx.globalAlpha = ANCHOR_ALPHA
    ctx.fillStyle = rgba(st.pal.hot, 0.95)
    ctx.beginPath()
    ctx.arc(a.x, a.y, cr, 0, 6.283)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  ctx.restore()
}

function renderVignette(st, ctx) {
  if (VIGNETTE <= 0) return
  const g = ctx.createRadialGradient(
    st.W / 2,
    st.H / 2,
    0,
    st.W / 2,
    st.H / 2,
    Math.max(st.W, st.H) * 0.72
  )
  g.addColorStop(0, 'rgba(0,0,0,0)')
  g.addColorStop(0.62, 'rgba(0,0,0,0)')
  g.addColorStop(1, 'rgba(0,0,0,' + VIGNETTE + ')')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, st.W, st.H)
}

function draw(st) {
  const ctx = st.canvas.getContext('2d')
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, st.canvas.width, st.canvas.height)
  ctx.scale(st.dpr, st.dpr)
  if (st.earthDirty) renderEarth(st)
  ctx.drawImage(st.earthCanvas, 0, 0, st.W, st.H)
  renderDots(st, ctx)
  renderVignette(st, ctx)
}

// ---- Counter: odometer host + screen-reader text ---------------------------------
function buildCounter(counterEl) {
  counterEl.setAttribute('role', 'status')
  counterEl.setAttribute('aria-live', 'polite')
  const odoHost = document.createElement('span')
  odoHost.className = 'impact-map_odo'
  odoHost.setAttribute('aria-hidden', 'true')
  const sr = document.createElement('span')
  sr.className = 'impact-map_sronly'
  counterEl.append(odoHost, sr)
  return { odoHost, sr }
}

function formatNumber(v, decimals) {
  return v.toFixed(decimals).replace('.', ',')
}

const CELL = 1.3 // em — must match --odo-h in impact-map.css

// A continuous odometer: each reel (0-9 + a trailing 0 so 9→0 wraps seamlessly) is
// translated to the live fractional digit. Every digit ticks ONE NUMBER AT A TIME.
function buildOdometer(host, target) {
  host.innerHTML = ''
  // Pad the authored figure out to DECIMALS so the extra reels (and the faster tick)
  // come from code, not from retyping a long number into the Webflow attribute.
  const authored = (String(target).split('.')[1] || '').length
  const decimals = Math.max(DECIMALS, authored)
  const finalStr = formatNumber(target, decimals)
  const intLen = finalStr.split(',')[0].length
  const digitsStr = finalStr.replace(',', '')
  const n = digitsStr.length

  const places = []
  for (let i = 0; i < n; i++) places.push(Math.pow(10, intLen - 1 - i))

  const sep = (ch) => {
    const s = document.createElement('span')
    s.className = 'odo-sep'
    s.textContent = ch
    return s
  }

  const reels = []
  for (let pos = 0; pos < n; pos++) {
    if (pos === intLen) host.appendChild(sep(','))
    const digit = document.createElement('span')
    digit.className = 'odo-digit'
    const clip = document.createElement('span')
    clip.className = 'odo-clip'
    const reel = document.createElement('span')
    reel.className = 'odo-reel'
    for (let k = 0; k <= 10; k++) {
      const s = document.createElement('span')
      s.textContent = k % 10
      reel.appendChild(s)
    }
    clip.appendChild(reel)
    digit.appendChild(clip)
    host.appendChild(digit)
    reels.push(reel)
  }
  host.appendChild(sep('%'))

  const setReel = (reel, disp) => {
    reel.style.transform = `translateY(${(-disp * CELL).toFixed(4)}em)`
  }

  // The roll window is scaled by place value so it lasts the same WALL-CLOCK time on
  // every digit (CARRY × one last-digit step). A flat fraction of each digit's own
  // cycle instead would leave a high digit visibly stuck mid-roll for hours.
  const smallest = places[n - 1]
  const windows = places.map((p) => CARRY * (smallest / p))

  const render = (value) => {
    for (let i = 0; i < n; i++) {
      const scaled = value / places[i]
      const d = ((Math.floor(scaled) % 10) + 10) % 10
      const frac = scaled - Math.floor(scaled)
      const w = windows[i]
      const roll = frac > 1 - w ? (frac - (1 - w)) / w : 0
      setReel(reels[i], d + roll)
    }
  }

  return {
    target,
    smallestPlace: smallest,
    format: (v) => formatNumber(v, decimals),
    render,
  }
}

// Value at page load: the target plus everything accrued since EPOCH. This is what
// makes the number survive reloads and keep climbing across days. Clamped at 0 so a
// visitor with a clock set before the epoch never sees less than the target.
function valueNow(odo, epochAttr) {
  const epochMs = Date.parse(epochAttr || EPOCH)
  if (isNaN(epochMs)) return odo.target
  const elapsed = Math.max(0, (Date.now() - epochMs) / 1000)
  console.log(
    `impact-map: +${RISE_PER_YEAR}/year → last digit ticks every ${(odo.smallestPlace / RISE_RATE).toFixed(1)}s`
  )
  return odo.target + RISE_RATE * elapsed
}

// ---- Per-instance setup ----------------------------------------------------------
async function setup(wrapper) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  const hasGSAP = typeof window.gsap !== 'undefined'

  const stage = wrapper.querySelector('[data-impact-stage]')
  const counterEl = wrapper.querySelector('[data-impact-counter]')
  if (!counterEl) {
    console.warn('impact-map: missing [data-impact-counter]')
    return null
  }

  const target = parseFloat(wrapper.getAttribute('data-impact-target')) || 0
  const { odoHost, sr } = buildCounter(counterEl)
  const odo = buildOdometer(odoHost, target)
  const current = valueNow(odo, wrapper.getAttribute('data-impact-epoch'))
  sr.textContent = odo.format(current) + '%'

  // The counter runs off the GSAP ticker (it pauses with the tab, so it never
  // fast-forwards after being backgrounded — the next load re-syncs from the clock).
  if (hasGSAP && !reduce) {
    const { gsap } = window
    const start = gsap.ticker.time
    gsap.ticker.add(() => {
      odo.render(current + RISE_RATE * (gsap.ticker.time - start))
    })
  } else {
    odo.render(current)
  }

  // The map is OPTIONAL and the counter is the half that carries the section: with no
  // [data-impact-stage] in the markup we stop here — no canvas injected, no rAF loop,
  // and loadMap() is never reached, so d3-geo / topojson / world-atlas are not fetched
  // at all. Delete the stage div in Webflow to get the counter on its own.
  if (!stage) return null

  // The map is independent of GSAP: it owns its own rAF loop, so it still runs if
  // GSAP never loads. `still` paints one populated frame and stops (reduced motion).
  const st = {
    stage,
    still: reduce,
    time: 0,
    running: false,
    earthDirty: true,
    W: 0,
    H: 0,
    dpr: 1,
    anchors: [],
    buckets: null,
    bucketN: new Int32Array(BUCKETS),
    slow: 0,
    downgrades: 0,
    pal: readPalette(wrapper),
  }

  const canvas = document.createElement('canvas')
  canvas.className = 'impact-map_canvas'
  canvas.setAttribute('role', 'img')
  canvas.setAttribute(
    'aria-label',
    'Night view of the Americas, with activity concentrated in Mexico, Texas, Florida and the main Latin American capitals'
  )
  stage.appendChild(canvas)
  st.canvas = canvas
  st.earthCanvas = document.createElement('canvas')
  st.sprite = makeSprite(st.pal)

  let data
  try {
    data = await loadMap()
  } catch (e) {
    console.warn('impact-map: map failed to load', e)
    return null // the counter is already running; the stage stays black
  }

  st.geo = data.geo
  st.land = drawnFeatures(data.countries.filter((f) => isAmericas(data.geo, f)))
  const budget = matchMedia(MOBILE_Q).matches ? MOBILE : DESKTOP

  const t0 = window.performance.now()
  const rng = makeRng(SEED)
  const onLand = buildLandMask(st.geo, st.land)
  st.anchors = HUBS.map((h) => ({ lng: h[2], lat: h[1], w: h[3], x: 0, y: 0 }))
  st.cluster = buildCluster(onLand, budget.cluster, rng)
  st.pool = buildPool(onLand, budget.pool, rng)
  st.slots = initSlots(st.pool.n, budget.live, rng)
  console.log(
    `impact-map: ${st.cluster.n} cluster + ${st.slots.n} live of ${st.pool.n} pooled dots in ${Math.round(window.performance.now() - t0)}ms`
  )

  resize(st)
  if (window.ResizeObserver) {
    new window.ResizeObserver(() => resize(st)).observe(stage)
  }

  if (st.still) {
    draw(st) // one populated frame, no loop
    return { resize: () => resize(st) }
  }

  const loop = (now) => {
    if (!st.running) return
    const raw = st.lastT ? now - st.lastT : 16
    const dt = st.lastT ? Math.min(0.05, raw / 1000) : 0.016
    st.lastT = now
    st.time += dt
    draw(st)
    // Adaptive budget: the dot count is what decides the frame cost, and the range of
    // devices is unknown. A sustained slow patch drops the faint field instead of
    // running the whole section at half rate — one-way, at most DOWNGRADES_MAX steps,
    // and only the ambient tier (the hubs are the content).
    if (raw > SLOW_MS) st.slow++
    else if (st.slow > 0) st.slow--
    if (st.slow > SLOW_FRAMES && st.downgrades < DOWNGRADES_MAX) {
      st.downgrades++
      st.slow = 0
      st.slots.n = Math.floor(st.slots.n * DOWNGRADE_KEEP)
      console.warn(
        `impact-map: slow frames → ambient field cut to ${st.slots.n} dots (step ${st.downgrades})`
      )
    }
    requestAnimationFrame(loop)
  }
  const start = () => {
    if (st.running) return
    st.running = true
    st.lastT = 0
    requestAnimationFrame(loop)
  }
  const stop = () => {
    st.running = false
  }

  // Off-screen or hidden tab: stop the loop. The field's phases are time-based, so it
  // resumes exactly where it left off.
  if (window.IntersectionObserver) {
    new window.IntersectionObserver((entries) => {
      st.visible = entries[0].isIntersecting
      if (st.visible && !document.hidden) start()
      else stop()
    }).observe(stage)
  } else {
    st.visible = true
    start()
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop()
    else if (st.visible) start()
  })

  return { resize: () => resize(st) }
}

function resize(st) {
  const rect = st.stage.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  st.dpr = Math.min(window.devicePixelRatio || 1, 2)
  st.W = rect.width
  st.H = rect.height
  const w = Math.round(st.W * st.dpr)
  const h = Math.round(st.H * st.dpr)
  st.canvas.width = w
  st.canvas.height = h
  st.canvas.style.width = st.W + 'px'
  st.canvas.style.height = st.H + 'px'
  st.earthCanvas.width = w
  st.earthCanvas.height = h

  if (!st.geo) return
  st.projection = st.geo.geoEquirectangular().fitExtent(
    [
      [0, 0],
      [st.W, st.H],
    ],
    bboxPolygon(BBOX)
  )
  st.anchors.forEach((a) => {
    const p = st.projection([a.lng, a.lat])
    a.x = p ? p[0] : NaN
    a.y = p ? p[1] : NaN
  })
  cacheScreen(st, st.cluster)
  cacheScreen(st, st.pool)
  st.earthDirty = true
  if (st.still) draw(st) // no loop to pick the new size up
}

// Positions never move, so screen coords are cached and recomputed only on resize.
function cacheScreen(st, dots) {
  if (!dots) return
  for (let i = 0; i < dots.n; i++) {
    const p = st.projection([dots.lng[i], dots.lat[i]])
    dots.screen[i * 2] = p ? p[0] : NaN
    dots.screen[i * 2 + 1] = p ? p[1] : NaN
  }
}

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='impact-map']
 */
export default function (elements) {
  const hooks = []
  elements.forEach((wrapper) => {
    setup(wrapper)
      .then((h) => h && hooks.push(h))
      .catch((e) => console.warn('impact-map: init failed', e))
  })
  return {
    resize() {
      hooks.forEach((h) => h.resize())
    },
  }
}
