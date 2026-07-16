/*
  Component: impact-map · data-component="impact-map"
  Autoplay odometer % synced with a staggered, twinkling clustered gold-dot reveal on a US map.
  Map geometry (d3-geo + topojson + us-atlas) is loaded on demand from CDN; the <svg>,
  gradients and dots are injected by JS, so Webflow only needs 3 elements + the head CSS.
  CSS → ./styles/impact-map.css (paste into Webflow head) · Docs → .claude/rules/components/impact-map.md
*/

const VIEW_W = 960
const VIEW_H = 600
const NS = 'http://www.w3.org/2000/svg'

// Tuning
const DOT_EXTRA = 60 // clustered dots ON TOP of the guaranteed one-per-state
const COUNT_DURATION = 16 // seconds — the whole odometer + dot reveal
const SCATTER = 1.1 // degrees of gaussian spread around each city hotspot
const DOT_FADE = 1.4 // seconds each dot takes to ease on
const GLOW_R = 15 // halo radius (viewBox units) — the soft gold bloom size
const ROLL_SPAN = 0.6 // fraction of the count each digit spends rolling (overlap)
const TWINKLE_MIN = 0.45 // dimmest a lit dot drifts to
const TWINKLE_SPEED = [0.9, 2.4] // seconds per half-pulse (random per cycle)

// State FIPS ids dropped so the projection frames the continental US (AK, HI +
// territories) — they'd shrink the lower 48 or sit off-frame.
const SKIP_FIPS = new Set(['02', '15', '60', '66', '69', '72', '78'])

// Country labels, positioned in viewBox units (the continental fit is deterministic).
const COUNTRIES = [
  { name: 'Canada', x: 480, y: 40 },
  { name: 'United States', x: 470, y: 300 },
  { name: 'Mexico', x: 315, y: 528 },
]

// Real city hotspots [lng, lat, weight] — dots cluster around these.
const HOTSPOTS = [
  // West
  [-118.24, 34.05, 3],
  [-122.42, 37.77, 3],
  [-122.33, 47.61, 2],
  [-117.16, 32.72, 2],
  [-122.68, 45.52, 1.5],
  [-121.49, 38.58, 1.5],
  [-115.14, 36.17, 1.5],
  [-112.07, 33.45, 2],
  // Mountain / Central
  [-104.99, 39.74, 2],
  [-111.89, 40.76, 1.5],
  [-96.8, 32.78, 2.5],
  [-95.37, 29.76, 2.5],
  [-97.74, 30.27, 1.5],
  [-87.63, 41.88, 3],
  [-93.27, 44.98, 2],
  [-94.58, 39.1, 1.5],
  [-90.2, 38.63, 1.5],
  [-97.52, 35.47, 1.2],
  // East
  [-74.0, 40.71, 3.5],
  [-71.06, 42.36, 2],
  [-77.04, 38.9, 2.5],
  [-75.16, 39.95, 2],
  [-84.39, 33.75, 2.5],
  [-80.19, 25.76, 2],
  [-80.84, 35.23, 1.5],
  [-86.78, 36.16, 1.5],
  [-83.05, 42.33, 2],
  [-81.69, 41.5, 1.2],
  [-82.46, 27.95, 1.2],
]

// Full state name → USPS abbreviation (us-atlas exposes properties.name).
const STATE_ABBR = {
  Alabama: 'AL',
  Alaska: 'AK',
  Arizona: 'AZ',
  Arkansas: 'AR',
  California: 'CA',
  Colorado: 'CO',
  Connecticut: 'CT',
  Delaware: 'DE',
  'District of Columbia': 'DC',
  Florida: 'FL',
  Georgia: 'GA',
  Hawaii: 'HI',
  Idaho: 'ID',
  Illinois: 'IL',
  Indiana: 'IN',
  Iowa: 'IA',
  Kansas: 'KS',
  Kentucky: 'KY',
  Louisiana: 'LA',
  Maine: 'ME',
  Maryland: 'MD',
  Massachusetts: 'MA',
  Michigan: 'MI',
  Minnesota: 'MN',
  Mississippi: 'MS',
  Missouri: 'MO',
  Montana: 'MT',
  Nebraska: 'NE',
  Nevada: 'NV',
  'New Hampshire': 'NH',
  'New Jersey': 'NJ',
  'New Mexico': 'NM',
  'New York': 'NY',
  'North Carolina': 'NC',
  'North Dakota': 'ND',
  Ohio: 'OH',
  Oklahoma: 'OK',
  Oregon: 'OR',
  Pennsylvania: 'PA',
  'Rhode Island': 'RI',
  'South Carolina': 'SC',
  'South Dakota': 'SD',
  Tennessee: 'TN',
  Texas: 'TX',
  Utah: 'UT',
  Vermont: 'VT',
  Virginia: 'VA',
  Washington: 'WA',
  'West Virginia': 'WV',
  Wisconsin: 'WI',
  Wyoming: 'WY',
}

// ---- Map libs + geometry: imported from CDN once, shared across instances -----
let mapPromise
function loadMap() {
  if (!mapPromise) {
    mapPromise = (async () => {
      const [geo, topojson] = await Promise.all([
        import('https://cdn.jsdelivr.net/npm/d3-geo@3/+esm'),
        import('https://cdn.jsdelivr.net/npm/topojson-client@3/+esm'),
      ])
      const [us, world] = await Promise.all([
        fetch('https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json').then(
          (r) => r.json()
        ),
        fetch(
          'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json'
        ).then((r) => r.json()),
      ])
      const countries = topojson.feature(
        world,
        world.objects.countries
      ).features
      const neighbors = countries.filter(
        (f) => f.properties.name === 'Canada' || f.properties.name === 'Mexico'
      )
      return { geo, states: topojson.feature(us, us.objects.states), neighbors }
    })()
  }
  return mapPromise
}

// ---- SVG scaffold (injected — Webflow ships an empty stage) --------------------
function radialGradient(id, stops) {
  const g = document.createElementNS(NS, 'radialGradient')
  g.setAttribute('id', id)
  g.setAttribute('cx', '50%')
  g.setAttribute('cy', '50%')
  g.setAttribute('r', '50%')
  stops.forEach(([offset, color, opacity]) => {
    const s = document.createElementNS(NS, 'stop')
    s.setAttribute('offset', offset)
    s.setAttribute('stop-color', color)
    if (opacity != null) s.setAttribute('stop-opacity', opacity)
    g.appendChild(s)
  })
  return g
}

// Gradients use fixed ids referenced by the head CSS; inject once per document.
function ensureDefs(svg) {
  if (document.getElementById('im-dot-grad')) return
  const defs = document.createElementNS(NS, 'defs')
  defs.appendChild(
    radialGradient('im-dot-grad', [
      ['0%', '#fffaf0'],
      ['38%', '#fbe08a'],
      ['100%', '#f7c948'],
    ])
  )
  defs.appendChild(
    radialGradient('im-glow-grad', [
      ['0%', '#f7c948', '0.55'],
      ['30%', '#f7c948', '0.3'],
      ['100%', '#f7c948', '0'],
    ])
  )
  svg.appendChild(defs)
}

function svgGroup(attr) {
  const g = document.createElementNS(NS, 'g')
  g.setAttribute(attr, '')
  return g
}

function buildStage(stage) {
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', `0 0 ${VIEW_W} ${VIEW_H}`)
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('data-impact-svg', '')
  ensureDefs(svg)
  const neighborsG = svgGroup('data-impact-neighbors')
  const landG = svgGroup('data-impact-land')
  const labelsG = svgGroup('data-impact-labels')
  const dotsG = svgGroup('data-impact-dots')
  svg.append(neighborsG, landG, labelsG, dotsG)
  stage.appendChild(svg)
  return { neighborsG, landG, labelsG, dotsG }
}

// ---- Counter: odometer host + screen-reader text injected into [data-impact-counter] ----
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

// One reel (0-9 column) per digit slot; each reel knows its final digit and
// rolls up to it (see play). Comma sits before the decimals, % at the end.
function buildOdometer(host, target, hasGSAP) {
  host.innerHTML = ''
  const decimals = (String(target).split('.')[1] || '').length || 0
  const finalStr = formatNumber(target, decimals) // e.g. "0,239768"
  const intLen = finalStr.split(',')[0].length
  const digitsStr = finalStr.replace(',', '')

  const sep = (ch) => {
    const s = document.createElement('span')
    s.className = 'odo-sep'
    s.textContent = ch
    return s
  }

  const reels = []
  for (let pos = 0; pos < digitsStr.length; pos++) {
    if (pos === intLen) host.appendChild(sep(','))
    const digit = document.createElement('span')
    digit.className = 'odo-digit'
    const clip = document.createElement('span')
    clip.className = 'odo-clip'
    const reel = document.createElement('span')
    reel.className = 'odo-reel'
    for (let n = 0; n <= 9; n++) {
      const s = document.createElement('span')
      s.textContent = n
      reel.appendChild(s)
    }
    clip.appendChild(reel)
    digit.appendChild(clip)
    host.appendChild(digit)
    reels.push({ reel, digit: parseInt(digitsStr[pos], 10) || 0 })
  }
  host.appendChild(sep('%'))

  const setY = (reel, d) => {
    const y = -d * 10 // reel is 1000% tall, one digit = 10%
    if (hasGSAP) window.gsap.set(reel, { yPercent: y })
    else reel.style.transform = `translateY(${y}%)`
  }

  return {
    finalStr,
    reels,
    reset() {
      reels.forEach((r) => setY(r.reel, 0))
    },
    showFinal() {
      reels.forEach((r) => setY(r.reel, r.digit))
    },
  }
}

// ---- Dot placement -------------------------------------------------------------
function gaussian() {
  let u = 0
  let w = 0
  while (u === 0) u = Math.random()
  while (w === 0) w = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w)
}

function weightedHotspot() {
  const total = HOTSPOTS.reduce((s, h) => s + h[2], 0)
  let r = Math.random() * total
  for (const h of HOTSPOTS) {
    r -= h[2]
    if (r <= 0) return h
  }
  return HOTSPOTS[0]
}

// A random interior point of a single state (sampled in its bbox until inside),
// falling back to the centroid. Guarantees the dot lands on that state's land.
function statePoint(geo, projection, f) {
  const b = geo.geoBounds(f) // [[west, south], [east, north]]
  for (let i = 0; i < 250; i++) {
    const lng = b[0][0] + Math.random() * (b[1][0] - b[0][0])
    const lat = b[0][1] + Math.random() * (b[1][1] - b[0][1])
    if (geo.geoContains(f, [lng, lat])) return projection([lng, lat])
  }
  return projection(geo.geoCentroid(f))
}

// One guaranteed dot per state, then `extra` clustered dots — all kept on US land
// via geoContains (rejects ocean, lakes and neighbouring countries).
function makePoints(geo, projection, states, extra, scatter) {
  const pts = []
  states.features.forEach((f) => {
    const p = statePoint(geo, projection, f)
    if (p && !isNaN(p[0]) && !isNaN(p[1])) pts.push(p)
  })

  const target = pts.length + extra
  let guard = 0
  while (pts.length < target && guard < extra * 100) {
    guard++
    const [lng, lat] = weightedHotspot()
    const coord = [lng + gaussian() * scatter, lat + gaussian() * scatter]
    if (!geo.geoContains(states, coord)) continue // on-land only — no water
    const p = projection(coord)
    if (!p) continue
    const [x, y] = p
    if (x < 4 || x > VIEW_W - 4 || y < 4 || y > VIEW_H - 4) continue
    pts.push([x, y])
  }
  return pts
}

// A dot is a <g> at (x,y): a soft halo + the bright core. GSAP animates the
// group's opacity (fade in + twinkle).
function createDot(group, x, y) {
  const g = document.createElementNS(NS, 'g')
  g.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)})`)
  const halo = document.createElementNS(NS, 'circle')
  halo.setAttribute('class', 'im-halo')
  halo.setAttribute('r', GLOW_R)
  const core = document.createElementNS(NS, 'circle')
  core.setAttribute('class', 'im-core')
  core.setAttribute('r', '4')
  g.appendChild(halo)
  g.appendChild(core)
  group.appendChild(g)
  return g
}

// ---- Animation -----------------------------------------------------------------
// Once a dot is lit, drift its brightness forever — random dip + speed per cycle
// so no two dots pulse in sync.
function startTwinkle(c) {
  const { gsap } = window
  gsap.to(c, {
    opacity: () => gsap.utils.random(TWINKLE_MIN, 1),
    duration: () => gsap.utils.random(TWINKLE_SPEED[0], TWINKLE_SPEED[1]),
    ease: 'sine.inOut',
    repeat: -1,
    yoyo: true,
    repeatRefresh: true,
  })
}

// One timeline ties the odometer and the dots. Each reel rolls up to its final
// digit and stops in a quick, overlapped left→right cascade; the dots reveal
// across the same window so the last dot lands with the last digit.
function play(odo, circles) {
  const { gsap } = window
  const reels = odo.reels
  gsap.killTweensOf(circles)
  gsap.killTweensOf(reels.map((r) => r.reel))
  gsap.set(circles, { opacity: 0 })
  odo.reset()

  const tl = gsap.timeline()
  const rollDur = COUNT_DURATION * ROLL_SPAN
  const step =
    reels.length > 1
      ? Math.max(0, COUNT_DURATION - rollDur) / (reels.length - 1)
      : 0
  reels.forEach((r, i) => {
    tl.to(
      r.reel,
      { yPercent: -r.digit * 10, duration: rollDur, ease: 'power2.out' },
      i * step
    )
  })

  if (circles.length) {
    const spread = Math.max(0.02, (COUNT_DURATION - DOT_FADE) / circles.length)
    const order = gsap.utils.shuffle(circles.map((_, i) => i))
    order.forEach((ci, k) => {
      const c = circles[ci]
      tl.to(
        c,
        {
          opacity: 1,
          duration: DOT_FADE,
          ease: 'sine.out',
          onComplete: () => startTwinkle(c),
        },
        k * spread
      )
    })
  }
}

// ---- Per-instance setup --------------------------------------------------------
async function setup(wrapper) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  const hasGSAP = typeof window.gsap !== 'undefined'

  const stage = wrapper.querySelector('[data-impact-stage]')
  const counterEl = wrapper.querySelector('[data-impact-counter]')
  if (!stage || !counterEl) {
    console.warn(
      'impact-map: missing [data-impact-stage] or [data-impact-counter]'
    )
    return
  }

  const target = parseFloat(wrapper.getAttribute('data-impact-target')) || 0
  const { odoHost, sr } = buildCounter(counterEl)
  const odo = buildOdometer(odoHost, target, hasGSAP)
  sr.textContent = odo.finalStr + '%'

  const { neighborsG, landG, labelsG, dotsG } = buildStage(stage)

  const addLabel = (x, y, text, cls) => {
    const t = document.createElementNS(NS, 'text')
    t.setAttribute('x', x)
    t.setAttribute('y', y)
    if (cls) t.setAttribute('class', cls)
    t.textContent = text
    labelsG.appendChild(t)
  }

  // Draw the map. Degrades to counter-only if the CDN load/parse fails.
  const circles = []
  try {
    const { geo, states, neighbors } = await loadMap()

    // Frame the continental US (drop AK, HI + territories), but use plain
    // geoAlbers (not geoAlbersUsa) so Canada + Mexico project too.
    const continental = {
      type: 'FeatureCollection',
      features: states.features.filter((f) => !SKIP_FIPS.has(String(f.id))),
    }
    const projection = geo.geoAlbers().fitSize([VIEW_W, VIEW_H], continental)
    const path = geo.geoPath(projection)

    // Canada + Mexico behind (dark) — clipped to the stage by overflow.
    neighbors.forEach((f) => {
      const d = path(f)
      if (!d) return
      const p = document.createElementNS(NS, 'path')
      p.setAttribute('d', d)
      neighborsG.appendChild(p)
    })

    // US states (grey) + their initials.
    continental.features.forEach((f) => {
      const d = path(f)
      if (!d) return
      const p = document.createElementNS(NS, 'path')
      p.setAttribute('d', d)
      landG.appendChild(p)

      const abbr = STATE_ABBR[f.properties && f.properties.name]
      const c = path.centroid(f)
      if (abbr && !isNaN(c[0]) && !isNaN(c[1]))
        addLabel(c[0].toFixed(1), c[1].toFixed(1), abbr)
    })

    // Country labels.
    COUNTRIES.forEach(({ name, x, y }) => addLabel(x, y, name, 'im-country'))

    // Dots: one per state + clustered extras, all on US land.
    makePoints(geo, projection, continental, DOT_EXTRA, SCATTER).forEach(
      ([x, y]) => {
        circles.push(createDot(dotsG, x, y))
      }
    )
  } catch (e) {
    console.warn('impact-map: map failed to load', e)
  }

  // Static final state for reduced motion / no GSAP; otherwise play.
  if (!hasGSAP || reduce) {
    odo.showFinal()
    circles.forEach((c) => {
      c.style.opacity = '1'
    })
    return
  }
  play(odo, circles)
}

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='impact-map']
 */
export default function (elements) {
  elements.forEach((wrapper) => {
    setup(wrapper).catch((e) => console.warn('impact-map: init failed', e))
  })
}
