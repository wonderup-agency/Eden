/*
  Component: impact-map · data-component="impact-map"
  Perpetual clock-derived odometer % (same for every visitor, never resets) synced with a staggered,
  twinkling gold-dot reveal across a map of ALL the Americas (Canada → Tierra del Fuego).
  Map geometry (d3-geo + topojson + world-atlas) is loaded on demand from CDN; the <svg>,
  gradients and dots are injected by JS, so Webflow only needs 3 elements + the head CSS.
  CSS → ./styles/impact-map.css (bundled via src/styles.js) · Docs → .claude/rules/components/impact-map.md
*/

// Framing per breakpoint: viewBox + its own geographic window (bbox), frame pad and dot
// scale. The desktop bbox is 107° wide × 130° tall (aspect ~0.82 — TALLER than wide), so
// fitExtent is height-constrained: in the 960×600 landscape box the continent fills the
// 600 height but only ~493 of the 960 width, leaving ~230 of black bar per side. That's the
// intended desktop framing.
// On mobile the width is whatever the phone gives (100%), so the ONLY way to draw the
// continent bigger is to fit fewer degrees across it: the mobile bbox crops ~10° of empty
// Pacific (lng0 -130 instead of -140, which also drops the Alaska sliver and Haida Gwaii)
// and the viewBox is a taller portrait matched to that aspect — ~18% more pixels per degree
// than the old 620×720 frame, with almost no black bar left. `dot` scales the halo/core so
// the dots keep their desktop pixel size in the narrower viewBox.
// Picked ONCE at init: changing it means re-projecting and re-sampling every dot, so a
// rotate/resize across the breakpoint keeps the framing it loaded with (slightly
// letterboxed, never broken). Keep the CSS aspect-ratio tokens in sync with both.
const VIEW_DESKTOP = {
  w: 960,
  h: 600,
  bbox: { lng0: -140, lng1: -33, lat0: -56, lat1: 74 },
  pad: 10,
  dot: 1,
};
const VIEW_MOBILE = {
  w: 620,
  h: 830,
  bbox: { lng0: -130, lng1: -33, lat0: -56, lat1: 74 },
  pad: 6,
  dot: 1.5,
};
const VIEW_Q = '(max-width: 767px)';
const NS = 'http://www.w3.org/2000/svg';

// Tuning — counter
// Growth is authored in the honest unit: percentage POINTS gained per year. The visual tick
// speed is set separately by DECIMALS — one extra decimal = a 10× faster tick at the SAME
// real growth. Keeping them apart is the point: rhythm without inflating the figure.
// At DECIMALS 10 / RISE_PER_YEAR 0.005 the last digit ticks every ~0.6s. DECIMALS moves in
// 10× jumps, so RISE_PER_YEAR is the FINE speed knob — nudge it for small changes of pace,
// keeping in mind it also inflates the figure. (Dev builds log the resulting tick.)
const RISE_PER_YEAR = 0.005;
const DECIMALS = 10; // decimals shown — coarse speed knob (more = 10× faster, longer number)
const YEAR = 31557600; // seconds in an average Gregorian year
const CARRY = 0.25; // fraction of ONE last-digit step spent rolling over (lower = snappier)
const DOTS_REVEAL = 6; // seconds over which the dots fade in on load (decoupled from the counter)

// The counter is a pure function of the clock: value = target + RISE_PER_YEAR × (now − EPOCH).
// No backend — every visitor sees the same number at the same instant and a reload never
// resets it. Override per section with data-impact-epoch (ISO date).
const EPOCH = '2026-07-28T00:00:00Z';
const RISE_RATE = RISE_PER_YEAR / YEAR; // percentage points per second

// Tuning — dots
const DOT_COUNT = 30; // total gold dots, spread evenly across the continent
const DOT_FADE = 1.4; // seconds each dot takes to ease on
const GLOW_R = 12; // halo radius (viewBox units) — the soft gold bloom size
const CORE_R = 3; // dot core radius
const TWINKLE_MIN = 0.45; // dimmest a lit dot drifts to
const TWINKLE_SPEED = [0.9, 2.4]; // seconds per half-pulse (random per cycle)

// The geographic window shown lives on each VIEW_* (`bbox` + `pad`) — fitting to that box
// rather than to the raw feature bounds keeps the framing deterministic and crops
// Alaska/Hawaii + the high arctic; SVG overflow hides the rest.

// Dropped from the Americas centroid filter (geographically N. America but skews the frame).
const EXCLUDE = new Set(['Greenland']);

// Country labels — manual [lng,lat] anchors (projected at draw time; robust to projection changes).
const COUNTRY_LABELS = [
  { name: 'Canada', lng: -100, lat: 60 },
  { name: 'United States', lng: -98, lat: 39 },
  { name: 'Mexico', lng: -102, lat: 23 },
  { name: 'Colombia', lng: -73.5, lat: 3.5 },
  { name: 'Peru', lng: -75, lat: -9.5 },
  { name: 'Brazil', lng: -51, lat: -10 },
  { name: 'Chile', lng: -71, lat: -38 },
  { name: 'Argentina', lng: -65, lat: -36 },
];

// ---- Map libs + geometry: imported from CDN once, shared across instances -----
let mapPromise;
function loadMap() {
  if (!mapPromise) {
    mapPromise = (async () => {
      const [geo, topojson] = await Promise.all([
        import('https://cdn.jsdelivr.net/npm/d3-geo@3/+esm'),
        import('https://cdn.jsdelivr.net/npm/topojson-client@3/+esm'),
      ]);
      const world = await fetch(
        'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json'
      ).then((r) => r.json());
      const countries = topojson.feature(
        world,
        world.objects.countries
      ).features;
      return { geo, countries }
    })();
  }
  return mapPromise
}

// A country belongs to the Americas if its centroid sits in the western hemisphere band
// (excludes Europe/Africa/Asia, whose centroids fall outside this lng/lat window).
function isAmericas(geo, f) {
  const c = geo.geoCentroid(f);
  const name = (f.properties && f.properties.name) || '';
  // Lower lng bound is -125 (not -170) so far-Pacific island nations (French Polynesia,
  // etc.) are excluded — every mainland American country's centroid is east of -125.
  return (
    c[0] >= -125 &&
    c[0] <= -33 &&
    c[1] >= -58 &&
    c[1] <= 84 &&
    !EXCLUDE.has(name)
  )
}

// ---- SVG scaffold (injected — Webflow ships an empty stage) --------------------
function radialGradient(id, stops) {
  const g = document.createElementNS(NS, 'radialGradient');
  g.setAttribute('id', id);
  g.setAttribute('cx', '50%');
  g.setAttribute('cy', '50%');
  g.setAttribute('r', '50%');
  stops.forEach(([offset, color, opacity]) => {
    const s = document.createElementNS(NS, 'stop');
    s.setAttribute('offset', offset);
    s.setAttribute('stop-color', color);
    if (opacity != null) s.setAttribute('stop-opacity', opacity);
    g.appendChild(s);
  });
  return g
}

// Gradients use fixed ids referenced by the head CSS; inject once per document.
function ensureDefs(svg) {
  if (document.getElementById('im-dot-grad')) return
  const defs = document.createElementNS(NS, 'defs');
  defs.appendChild(
    radialGradient('im-dot-grad', [
      ['0%', '#fffaf0'],
      ['38%', '#fbe08a'],
      ['100%', '#f7c948'],
    ])
  );
  defs.appendChild(
    radialGradient('im-glow-grad', [
      ['0%', '#f7c948', '0.55'],
      ['30%', '#f7c948', '0.3'],
      ['100%', '#f7c948', '0'],
    ])
  );
  svg.appendChild(defs);
}

function svgGroup(attr) {
  const g = document.createElementNS(NS, 'g');
  g.setAttribute(attr, '');
  return g
}

function buildStage(stage, view) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${view.w} ${view.h}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('data-impact-svg', '');
  ensureDefs(svg);
  const landG = svgGroup('data-impact-land');
  const labelsG = svgGroup('data-impact-labels');
  const dotsG = svgGroup('data-impact-dots');
  svg.append(landG, labelsG, dotsG);
  stage.appendChild(svg);
  return { landG, labelsG, dotsG }
}

// ---- Counter: odometer host + screen-reader text injected into [data-impact-counter] ----
function buildCounter(counterEl) {
  counterEl.setAttribute('role', 'status');
  counterEl.setAttribute('aria-live', 'polite');
  const odoHost = document.createElement('span');
  odoHost.className = 'impact-map_odo';
  odoHost.setAttribute('aria-hidden', 'true');
  const sr = document.createElement('span');
  sr.className = 'impact-map_sronly';
  counterEl.append(odoHost, sr);
  return { odoHost, sr }
}

function formatNumber(v, decimals) {
  return v.toFixed(decimals).replace('.', ',')
}

const CELL = 1.3; // em — must match --odo-h in impact-map.css

// A continuous odometer: each reel (0-9 + a trailing 0 so 9→0 wraps seamlessly) is
// translated to the live fractional digit. The last (fastest) digit glides continuously;
// higher digits stay crisp and only roll during the final CARRY window before they carry.
function buildOdometer(host, target) {
  host.innerHTML = '';
  // Pad the authored figure out to DECIMALS so the extra reels (and the faster tick) come
  // from code, not from retyping a long number into the Webflow attribute.
  const authored = (String(target).split('.')[1] || '').length;
  const decimals = Math.max(DECIMALS, authored);
  const finalStr = formatNumber(target, decimals); // e.g. "0,239768"
  const intLen = finalStr.split(',')[0].length;
  const digitsStr = finalStr.replace(',', '');
  const n = digitsStr.length;

  // Place value per position: 10^(intLen-1-i). Smallest = the fastest (last) digit.
  const places = [];
  for (let i = 0; i < n; i++) places.push(Math.pow(10, intLen - 1 - i));

  const sep = (ch) => {
    const s = document.createElement('span');
    s.className = 'odo-sep';
    s.textContent = ch;
    return s
  };

  const reels = [];
  for (let pos = 0; pos < n; pos++) {
    if (pos === intLen) host.appendChild(sep(','));
    const digit = document.createElement('span');
    digit.className = 'odo-digit';
    const clip = document.createElement('span');
    clip.className = 'odo-clip';
    const reel = document.createElement('span');
    reel.className = 'odo-reel';
    for (let k = 0; k <= 10; k++) {
      // 0..9 then a trailing 0 so the wrap 9→0 is seamless
      const s = document.createElement('span');
      s.textContent = k % 10;
      reel.appendChild(s);
    }
    clip.appendChild(reel);
    digit.appendChild(clip);
    host.appendChild(digit);
    reels.push(reel);
  }
  host.appendChild(sep('%'));

  const setReel = (reel, disp) => {
    reel.style.transform = `translateY(${(-disp * CELL).toFixed(4)}em)`;
  };

  // Every digit ticks ONE NUMBER AT A TIME: it rests on its value, then rolls quickly to
  // the next only in the final CARRY window before it carries — no continuous gliding.
  // The window is scaled by place value so it lasts the same WALL-CLOCK time on every
  // digit (CARRY × one last-digit step). Using a flat fraction of each digit's own cycle
  // instead would leave a high digit visibly stuck mid-roll for hours.
  const smallest = places[n - 1];
  const windows = places.map((p) => CARRY * (smallest / p));

  const render = (value) => {
    for (let i = 0; i < n; i++) {
      const scaled = value / places[i];
      const d = ((Math.floor(scaled) % 10) + 10) % 10;
      const frac = scaled - Math.floor(scaled);
      const w = windows[i];
      const roll = frac > 1 - w ? (frac - (1 - w)) / w : 0;
      setReel(reels[i], d + roll);
    }
  };

  return {
    target,
    smallestPlace: smallest,
    format: (v) => formatNumber(v, decimals),
    render,
  }
}

// ---- Dot placement -------------------------------------------------------------
// `count` dots spread EVENLY across the continent: uniform rejection sampling over the
// view's bbox, kept only when the point lands on Americas land (geoContains rejects
// ocean/lakes, so no dots in the water) — no city hotspots, so no country is over-clustered.
function makePoints(geo, projection, americas, count, view) {
  const pts = [];
  const bbox = view.bbox;
  const onLand = (coord) => americas.some((f) => geo.geoContains(f, coord));

  let guard = 0;
  while (pts.length < count && guard < count * 400) {
    guard++;
    const lng = bbox.lng0 + Math.random() * (bbox.lng1 - bbox.lng0);
    const lat = bbox.lat0 + Math.random() * (bbox.lat1 - bbox.lat0);
    if (!onLand([lng, lat])) continue // on-land only — no water
    const p = projection([lng, lat]);
    if (!p || isNaN(p[0])) continue
    const [x, y] = p;
    if (x < 4 || x > view.w - 4 || y < 4 || y > view.h - 4) continue
    pts.push([x, y]);
  }
  return pts
}

// A dot is a <g> at (x,y): a soft halo + the bright core. GSAP animates the
// group's opacity (fade in + twinkle). `scale` (view.dot) keeps the rendered pixel size
// consistent across the two viewBox widths.
function createDot(group, x, y, scale) {
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)})`);
  const halo = document.createElementNS(NS, 'circle');
  halo.setAttribute('class', 'im-halo');
  halo.setAttribute('r', (GLOW_R * scale).toFixed(1));
  const core = document.createElementNS(NS, 'circle');
  core.setAttribute('class', 'im-core');
  core.setAttribute('r', (CORE_R * scale).toFixed(1));
  g.appendChild(halo);
  g.appendChild(core);
  group.appendChild(g);
  return g
}

// ---- Animation -----------------------------------------------------------------
// Once a dot is lit, drift its brightness forever — random dip + speed per cycle
// so no two dots pulse in sync.
function startTwinkle(c) {
  const { gsap } = window;
  gsap.to(c, {
    opacity: () => gsap.utils.random(TWINKLE_MIN, 1),
    duration: () => gsap.utils.random(TWINKLE_SPEED[0], TWINKLE_SPEED[1]),
    ease: 'sine.inOut',
    repeat: -1,
    yoyo: true,
    repeatRefresh: true,
  });
}

// Value at page load: the target plus everything accrued since EPOCH. This is what makes
// the number survive reloads and keep climbing across days. Clamped at 0 so a visitor with
// a clock set before the epoch never sees a value below the target.
function valueNow(odo, epochAttr) {
  const epochMs = Date.parse(epochAttr || EPOCH);
  if (isNaN(epochMs)) return odo.target
  const elapsed = Math.max(0, (Date.now() - epochMs) / 1000);
  console.log(
    `impact-map: +${RISE_PER_YEAR}/year → last digit ticks every ${(odo.smallestPlace / RISE_RATE).toFixed(1)}s`
  );
  return odo.target + RISE_RATE * elapsed
}

// The odometer never lands: it starts at the clock-derived value and rises forever at
// RISE_RATE, ticking up ONE number at a time (it rests on each number, then rolls quickly
// to the next). Dots fade in over DOTS_REVEAL (decoupled
// from the counter). Driven by the GSAP ticker (pauses with the tab, so it never
// fast-forwards after being backgrounded — the next load re-syncs from the clock anyway).
function play(odo, circles, from) {
  const { gsap } = window;
  gsap.killTweensOf(circles);
  gsap.set(circles, { opacity: 0 });

  if (circles.length) {
    const spread = Math.max(0.02, (DOTS_REVEAL - DOT_FADE) / circles.length);
    const order = gsap.utils.shuffle(circles.map((_, i) => i));
    order.forEach((ci, k) => {
      const c = circles[ci];
      gsap.to(c, {
        opacity: 1,
        duration: DOT_FADE,
        ease: 'sine.out',
        delay: k * spread,
        onComplete: () => startTwinkle(c),
      });
    });
  }

  const start = gsap.ticker.time;
  gsap.ticker.add(() => {
    odo.render(from + RISE_RATE * (gsap.ticker.time - start));
  });
}

// ---- Per-instance setup --------------------------------------------------------
async function setup(wrapper) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasGSAP = typeof window.gsap !== 'undefined';

  const stage = wrapper.querySelector('[data-impact-stage]');
  const counterEl = wrapper.querySelector('[data-impact-counter]');
  if (!stage || !counterEl) {
    console.warn(
      'impact-map: missing [data-impact-stage] or [data-impact-counter]'
    );
    return
  }

  const target = parseFloat(wrapper.getAttribute('data-impact-target')) || 0;
  const { odoHost, sr } = buildCounter(counterEl);
  const odo = buildOdometer(odoHost, target);
  // Clock-derived starting value — the same for every visitor, and never lower than the last load.
  const current = valueNow(odo, wrapper.getAttribute('data-impact-epoch'));
  sr.textContent = odo.format(current) + '%';

  // Framing is chosen once, here — see the VIEW_* note at the top of the file.
  const view = window.matchMedia(VIEW_Q).matches ? VIEW_MOBILE : VIEW_DESKTOP;
  const { landG, labelsG, dotsG } = buildStage(stage, view);

  const addLabel = (x, y, text, cls) => {
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', x);
    t.setAttribute('y', y);
    t.setAttribute('class', cls);
    t.textContent = text;
    labelsG.appendChild(t);
  };

  // Draw the map. Degrades to counter-only if the CDN load/parse fails.
  const circles = [];
  try {
    const { geo, countries } = await loadMap();
    const americas = countries.filter((f) => isAmericas(geo, f));

    // Fit an equirectangular projection to the view's fixed bbox (deterministic framing;
    // Alaska/Hawaii + the high arctic fall outside and are clipped by the SVG).
    const bbox = view.bbox;
    const bboxPoly = {
      type: 'Polygon',
      coordinates: [
        [
          [bbox.lng0, bbox.lat1],
          [bbox.lng1, bbox.lat1],
          [bbox.lng1, bbox.lat0],
          [bbox.lng0, bbox.lat0],
          [bbox.lng0, bbox.lat1],
        ],
      ],
    };
    const projection = geo.geoEquirectangular().fitExtent(
      [
        [view.pad, view.pad],
        [view.w - view.pad, view.h - view.pad],
      ],
      bboxPoly
    );
    const path = geo.geoPath(projection);

    // All American countries, uniform land style.
    americas.forEach((f) => {
      const d = path(f);
      if (!d) return
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      landG.appendChild(p);
    });

    // Country labels (projected anchors, on-view only).
    COUNTRY_LABELS.forEach(({ name, lng, lat }) => {
      const xy = projection([lng, lat]);
      if (!xy || isNaN(xy[0])) return
      if (xy[0] < 0 || xy[0] > view.w || xy[1] < 0 || xy[1] > view.h) return
      addLabel(xy[0].toFixed(1), xy[1].toFixed(1), name, 'im-country');
    });

    // Dots: spread evenly across the continent, all on land (no water).
    makePoints(geo, projection, americas, DOT_COUNT, view).forEach(([x, y]) => {
      circles.push(createDot(dotsG, x, y, view.dot));
    });
  } catch (e) {
    console.warn('impact-map: map failed to load', e);
  }

  // Static state for reduced motion / no GSAP; otherwise play the perpetual counter.
  if (!hasGSAP || reduce) {
    odo.render(current);
    circles.forEach((c) => {
      c.style.opacity = '1';
    });
    return
  }
  play(odo, circles, current);
}

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='impact-map']
 */
function impactMap (elements) {
  elements.forEach((wrapper) => {
    setup(wrapper).catch((e) => console.warn('impact-map: init failed', e));
  });
}

export { impactMap as default };
//# sourceMappingURL=impact-map-Dti6aQfg.js.map
