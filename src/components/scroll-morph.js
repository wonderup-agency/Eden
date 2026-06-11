/*
Component: scroll-morph
Webflow attribute: data-component="scroll-morph"

Pinned, scroll-driven section. A PROCEDURAL ring of ~2,500 light-grey dots is
drawn on a <canvas> behind a single line of text. As the section scrubs the
cloud assembles: fully dispersed across the section at the start, it coalesces
into the ring across the scroll and then holds, assembled and in view, as the
sticky track releases. The single text stays revealed and held the whole time —
ONLY the background (the ring) animates. The assembled ring never freezes: it
breathes with a radial sine wave + a slight tangential wobble. Hovering the
cloud pushes nearby points away (eased nebula).

The ring + scatter + breathing + mouse-push are ported from the reference
prototype (a fixed-overlay native-scroll sketch) and adapted to this section's
sticky, normalized-coordinate engine. No image is sampled — the shape is
generated in code, so there is no source <img> and no CORS concern.

GSAP + ScrollTrigger are expected as globals (loaded site-wide in Webflow).

Fallbacks: no GSAP/ScrollTrigger or prefers-reduced-motion → no canvas / no pin;
the messages show in a readable stacked layout.

The CSS is NOT bundled here — it lives in Webflow's global head custom code.
The source of truth is ./styles/scroll-morph.css (copy/paste it into Webflow).
*/

const { gsap } = window
const ScrollTrigger = window.ScrollTrigger

// ---- Point cloud (procedural ring, ported from the prototype) ----
const TARGET_POINTS = 2500 // dot count
const DOT_COLOR = '180,185,190' // premium light slate grey (tuned for a light bg)
// Per-point radius (CSS px): mostly small, ~15% slightly bigger.
const BIG_DOT_CHANCE = 0.15
const SMALL_R = [0.5, 1.7] // common small dots: min..max radius
const BIG_R = [1.5, 3.0] // the ~15% bigger dots: min..max radius
// Ring geometry — normalized so the ring radius is 1; thickness is a soft
// gaussian band around it (varied per point).
const RING_THICKNESS = 0.1 // gaussian spread of the band (fraction of radius)
const FIT = 1 // fraction of the half-stage the ring fills (auto-fit)
// Alpha: soft when dispersed/idle, brighter once assembled.
const ALPHA_MIN = 0.15 // dispersed base alpha (lower bound)
const ALPHA_MAX = 0.4 // dispersed base alpha (upper bound)
const ALPHA_PEAK = 0.55 // alpha when fully assembled
// Dispersed scatter — a slow drifting, edge-bouncing wander across the section.
const SCATTER = 1.0 // dispersed coverage (1 = fills the whole section)
const SCATTER_DRIFT = 0.0015 // unit-space velocity magnitude (slow wander)
const STAGGER = 0.45 // spread of per-point assemble timing (organic)
// Continuous breathing of the assembled ring (never freezes). Amped up for a more
// alive, looser ring — raise the AMPs further for even more motion (the ring keeps
// its shape up to ~0.08 radial), the SPEEDs for a faster pulse.
const RING_WAVE_AMP = 0.05 // radial wobble amplitude (fraction of ring radius)
const RING_WAVE_SPEED = 1.5 // radial wave speed (rad/s, base)
const RING_WOBBLE_AMP = 0.05 // tangential angle wobble (rad)
const RING_WOBBLE_SPEED = 0.95 // tangential wobble speed (rad/s, base)
// Scroll choreography — the cloud starts fully dispersed across the section and
// assembles into the ring across the scroll, then holds assembled.
const PIN_LEN = 3 // sticky scroll length in viewport heights (root height) — longer = gentler
const SCRUB = 0.5 // ScrollTrigger catch-up lag (s) — lower = more dynamic / tracks scroll tighter
const HOLD = 0.3 // beat held fully dispersed before the ring starts forming
const ASSEMBLE = 1.9 // duration of the dispersed → ring assembly (the forming moment — the bulk of the scroll)
const END_HOLD = 0.3 // short tail: once the ring is formed the animation is done and the section moves on
// Hover push (pixel feel — converted to normalized units via `scale` at runtime).
const HOVER_RADIUS_PX = 110 // cursor influence radius
const HOVER_PUSH_PX = 26 // how far nearby dots are pushed away
const HOVER_EASE_IN = 0.15 // easing toward the pushed position
const HOVER_EASE_OUT = 0.06 // easing back to rest

// DEV diagnostics — set false (or remove the gated blocks) before deploy.
// Production builds strip console.* via Terser, but this also skips the work.
const DEBUG = true
const DEBUG_BOUND = 220 // px window around the pin start/end to log per-frame
const DEBUG_JUMP = 60 // single-frame scroll delta (px) flagged as a JUMP

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

// Deterministic RNG so the ring is stable across reloads.
function mulberry32(seed) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Standard-normal sample (Box–Muller) for the soft ring-band thickness.
function gaussian(rng) {
  const u = Math.max(rng(), 1e-6)
  const v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

// Static fallback: reveal the single text readable. No canvas.
function setupStatic(root, message) {
  gsap && gsap.set(message, { clearProps: 'all' })
  root.classList.add('is-ready')
}

// Wire one section root. Returns { resize } or null (static / incomplete).
function setupRoot(root) {
  const track = root.querySelector('[data-scroll-morph-track]')
  const stage = root.querySelector('[data-scroll-morph-stage]') || track
  const messages = Array.from(
    root.querySelectorAll('[data-scroll-morph-message]')
  )

  if (!track || !messages.length) {
    console.warn(
      '[scroll-morph] missing [data-scroll-morph-track] or [data-scroll-morph-message]'
    )
    return null
  }

  // Single-text section: only the first message is used. Any extra message
  // elements left in the markup are hidden so they can't stack on top.
  const message = messages[0]
  messages.slice(1).forEach((m) => (m.style.display = 'none'))

  // No GSAP / ScrollTrigger / reduced motion → static, readable layout.
  if (!gsap || !ScrollTrigger || reduceMotion.matches) {
    setupStatic(root, message)
    return null
  }

  // ---- Canvas + procedural-ring engine ----
  const canvas = document.createElement('canvas')
  canvas.className = 'scroll-morph_canvas'
  canvas.setAttribute('aria-hidden', 'true')
  stage.appendChild(canvas)
  const ctx = canvas.getContext('2d')

  const N = TARGET_POINTS
  // Per-point buffers.
  const angle = new Float32Array(N) // base angle on the ring
  const baseR = new Float32Array(N) // ring radius incl. gaussian thickness
  const speedMod = new Float32Array(N) // per-point breathing speed multiplier
  const pointR = new Float32Array(N) // dot radius (CSS px)
  const baseAlpha = new Float32Array(N) // dispersed/idle alpha
  const scatterX = new Float32Array(N) // dispersed position, unit space [-1,1]
  const scatterY = new Float32Array(N)
  const velX = new Float32Array(N) // dispersed drift velocity (unit/frame)
  const velY = new Float32Array(N)
  const offX = new Float32Array(N) // eased hover push offset (normalized)
  const offY = new Float32Array(N)
  const assembleDelay = new Float32Array(N)
  let ringExt = 1 // max |coord| of the static ring (for auto-fit)

  let cssW = 0
  let cssH = 0
  let scale = 0
  let coverX = 1
  let coverY = 1
  let dpr = 1
  const form = { t: 0 } // 0 = dispersed across the section, 1 = assembled ring
  let inView = false
  let looping = false
  let ready = false
  let hovActive = false
  let mx = 0
  let my = 0

  function buildPointBuffers() {
    const rng = mulberry32(7)
    ringExt = 0
    for (let i = 0; i < N; i++) {
      const a = rng() * Math.PI * 2
      const r = 1 + gaussian(rng) * RING_THICKNESS
      angle[i] = a
      baseR[i] = r
      speedMod[i] = 0.5 + rng() * 0.5
      // Varied dot size: ~15% slightly bigger, the rest fine.
      pointR[i] =
        rng() < BIG_DOT_CHANCE
          ? BIG_R[0] + rng() * (BIG_R[1] - BIG_R[0])
          : SMALL_R[0] + rng() * (SMALL_R[1] - SMALL_R[0])
      baseAlpha[i] = ALPHA_MIN + rng() * (ALPHA_MAX - ALPHA_MIN)
      // Dispersed start: random across the section, slow drifting velocity.
      scatterX[i] = rng() * 2 - 1
      scatterY[i] = rng() * 2 - 1
      const da = rng() * Math.PI * 2
      velX[i] = Math.cos(da) * SCATTER_DRIFT
      velY[i] = Math.sin(da) * SCATTER_DRIFT
      assembleDelay[i] = rng() * STAGGER
      const ax = Math.abs(Math.cos(a) * r)
      const ay = Math.abs(Math.sin(a) * r)
      if (ax > ringExt) ringExt = ax
      if (ay > ringExt) ringExt = ay
    }
    // Leave headroom for the radial breathing so it never clips at the edge.
    ringExt += RING_WAVE_AMP
  }

  function resize() {
    cssW = stage.clientWidth
    cssH = stage.clientHeight
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = cssW * dpr
    canvas.height = cssH * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // Auto-fit the ring to the smaller half-extent so it never clips.
    scale = (Math.min(cssW * 0.5, cssH * 0.5) / ringExt) * FIT
    coverX = scale ? (cssW * 0.5) / scale : 1
    coverY = scale ? (cssH * 0.5) / scale : 1
    if (ready) draw()
  }

  function draw() {
    ctx.clearRect(0, 0, cssW, cssH)
    if (!ready) return
    const cx = cssW / 2
    const cy = cssH / 2
    const f = form.t
    const span = 1 + STAGGER
    const now = window.performance.now() * 0.001
    const covX = coverX * SCATTER
    const covY = coverY * SCATTER
    // Hover influence expressed in normalized units (keeps the px feel at any scale).
    const hr = scale ? HOVER_RADIUS_PX / scale : 0
    const hr2 = hr * hr
    const hpush = scale ? HOVER_PUSH_PX / scale : 0
    ctx.fillStyle = `rgb(${DOT_COLOR})`
    for (let i = 0; i < N; i++) {
      // Slow drifting scatter that bounces off the section edges.
      let sxu = scatterX[i] + velX[i]
      let syu = scatterY[i] + velY[i]
      if (sxu < -1 || sxu > 1) {
        velX[i] = -velX[i]
        sxu = sxu < -1 ? -1 : 1
      }
      if (syu < -1 || syu > 1) {
        velY[i] = -velY[i]
        syu = syu < -1 ? -1 : 1
      }
      scatterX[i] = sxu
      scatterY[i] = syu

      // Per-point assembly progress (staggered, smoothstepped).
      let pp = f * span - assembleDelay[i]
      pp = pp < 0 ? 0 : pp > 1 ? 1 : pp
      pp = pp * pp * (3 - 2 * pp)

      // Dynamic ring position — breathes radially + wobbles tangentially so the
      // assembled ring never freezes (matches the prototype's living ring).
      const wave =
        Math.sin(now * RING_WAVE_SPEED * speedMod[i] + angle[i] * 5) *
        RING_WAVE_AMP
      const aa =
        angle[i] +
        Math.cos(now * RING_WOBBLE_SPEED * speedMod[i]) * RING_WOBBLE_AMP
      const rr = baseR[i] + wave
      const ringX = Math.cos(aa) * rr
      const ringY = Math.sin(aa) * rr

      // Dispersed position fills the section; converge to the ring as pp → 1.
      const dispX = sxu * covX
      const dispY = syu * covY
      const bx = dispX + (ringX - dispX) * pp
      const by = dispY + (ringY - dispY) * pp

      // Hover push: dots within the cursor radius are pushed away, eased back.
      let txo = 0
      let tyo = 0
      if (hovActive) {
        const ddx = bx - mx
        const ddy = by - my
        const d2 = ddx * ddx + ddy * ddy
        if (d2 < hr2) {
          const d = Math.sqrt(d2) || 1e-4
          const force = (hr - d) / hr
          txo = (ddx / d) * force * hpush
          tyo = (ddy / d) * force * hpush
        }
      }
      const ease = txo || tyo ? HOVER_EASE_IN : HOVER_EASE_OUT
      offX[i] += (txo - offX[i]) * ease
      offY[i] += (tyo - offY[i]) * ease

      const alpha = baseAlpha[i] + (ALPHA_PEAK - baseAlpha[i]) * pp
      ctx.globalAlpha = alpha
      ctx.beginPath()
      ctx.arc(
        cx + (bx + offX[i]) * scale,
        cy + (by + offY[i]) * scale,
        pointR[i],
        0,
        Math.PI * 2
      )
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  function loop() {
    draw()
    debugFrame()
    if (inView) window.requestAnimationFrame(loop)
    else looping = false
  }
  function ensureLoop() {
    if (!looping && inView) {
      looping = true
      window.requestAnimationFrame(loop)
    }
  }

  // ---- DEV diagnostics: snapshot the pin + Lenis state to chase the "jump" ----
  let stRef = null
  let lastDebugY = window.scrollY

  // A full snapshot at key pin transitions: scroll positions (native + Lenis
  // smoothed/target/actual), Lenis velocity, pin progress, and the pinned
  // track's live geometry (top, position, transform).
  function debugSnap(self, tag, color) {
    if (!DEBUG) return
    const l = window.lenis
    const r = track.getBoundingClientRect()
    const cs = window.getComputedStyle(track)
    console.log(`%c[scroll-morph] ${tag}`, `color:${color};font-weight:bold`, {
      progress: +self.progress.toFixed(4),
      isActive: self.isActive,
      stStart: Math.round(self.start),
      stEnd: Math.round(self.end),
      'scrollY (native)': Math.round(window.scrollY),
      'lenis.scroll': l ? Math.round(l.scroll) : 'no-lenis',
      'lenis.targetScroll': l ? Math.round(l.targetScroll) : '—',
      'lenis.actualScroll': l ? Math.round(l.actualScroll) : '—',
      'lenis.velocity': l ? +l.velocity.toFixed(2) : '—',
      'track.top': Math.round(r.top),
      'track.position': cs.position,
      'track.transform': cs.transform,
    })
  }

  // One-time layout audit on refresh: the #1 cause of pin jumps in Webflow is a
  // flex/grid wrapper around the pinned section (the pin-spacer can't size), so
  // log the spacer height and the display of the spacer's parent + track parent.
  function debugLayout(self) {
    if (!DEBUG) return
    const sp = self.spacer
    const trackParent = track.parentElement
    const spacerParent = sp && sp.parentElement
    console.log(
      '%c[scroll-morph] layout audit',
      'color:#0ea5e9;font-weight:bold',
      {
        pinSpacerHeight: sp ? Math.round(sp.offsetHeight) : 'none',
        'track.parent': trackParent ? trackParent.tagName : null,
        'track.parent.display': trackParent
          ? window.getComputedStyle(trackParent).display
          : null,
        'spacer.parent': spacerParent ? spacerParent.tagName : null,
        'spacer.parent.display': spacerParent
          ? window.getComputedStyle(spacerParent).display
          : null,
        'spacer.parent.flex/grid?':
          spacerParent &&
          /flex|grid/.test(window.getComputedStyle(spacerParent).display)
            ? '⚠️ YES — likely the jump'
            : 'no',
      }
    )
  }

  // Per-frame logger, active only within DEBUG_BOUND px of either pin boundary.
  // Flags any single-frame scroll skip (> DEBUG_JUMP px) in red — that's the jump.
  function debugFrame() {
    if (!DEBUG || !stRef) return
    const y = window.scrollY
    const dy = y - lastDebugY
    lastDebugY = y
    if (dy === 0) return
    const nearStart = Math.abs(y - stRef.start) < DEBUG_BOUND
    const nearEnd = Math.abs(y - stRef.end) < DEBUG_BOUND
    if (!nearStart && !nearEnd) return
    // Only surface actual single-frame scroll skips (the "jump") — don't flood
    // the console with every smooth frame near the boundary.
    if (Math.abs(dy) <= DEBUG_JUMP) return
    const l = window.lenis
    console.log(
      `%c[scroll-morph] ⚠️ JUMP @${nearStart ? 'START' : 'END'}`,
      'color:#ef4444;font-weight:bold',
      {
        dy: Math.round(dy),
        scrollY: Math.round(y),
        progress: +stRef.progress.toFixed(4),
        'lenis.vel': l ? +l.velocity.toFixed(2) : '—',
        'track.top': Math.round(track.getBoundingClientRect().top),
        'track.position': window.getComputedStyle(track).position,
      }
    )
  }

  // ---- Scroll timeline: scrub the ring assembly. Text stays revealed. ----
  let tl = null
  function buildScroll() {
    if (tl) {
      if (tl.scrollTrigger) tl.scrollTrigger.kill(true)
      tl.kill()
    }

    // The single text is revealed and held the whole time — only the ring moves.
    gsap.set(message, { autoAlpha: 1 })
    gsap.set(form, { t: 0 })

    tl = gsap.timeline({ defaults: { ease: 'power2.inOut' } })
    // Hold briefly fully dispersed, assemble the ring across the scroll, then
    // hold it assembled and in view as the sticky track releases.
    tl.to({}, { duration: HOLD })
    tl.to(form, { t: 1, duration: ASSEMBLE })
    tl.to({}, { duration: END_HOLD })

    // No GSAP pin: the track is CSS `position: sticky` (set in scroll-morph.css)
    // and the root is made tall (--scroll-morph-len = PIN_LEN×100vh) to give the
    // scroll distance. ScrollTrigger here only READS progress (scrub) to drive
    // the timeline — it never manipulates layout, so there's no pin-spacer, no
    // refresh-order dependency, and the sticky track can't overlap other
    // sections (it's clipped to the root). Range: root top→top until bottom→
    // bottom, which is exactly the span the sticky track stays in view.
    root.style.setProperty('--scroll-morph-len', PIN_LEN * 100 + 'vh')
    tl.scrollTrigger ||
      (stRef = ScrollTrigger.create({
        trigger: root,
        start: 'top top',
        end: 'bottom bottom',
        scrub: SCRUB,
        animation: tl,
        onUpdate: ensureLoop,
        onEnter: (self) => debugSnap(self, '▶ onEnter (pin start)', '#22c55e'),
        onLeave: (self) => debugSnap(self, '■ onLeave (pin end)', '#f97316'),
        onEnterBack: (self) =>
          debugSnap(self, '◀ onEnterBack (re-pin from below)', '#22c55e'),
        onLeaveBack: (self) =>
          debugSnap(self, '□ onLeaveBack (unpin to top)', '#f97316'),
        onRefresh: (self) => {
          debugSnap(self, '↻ onRefresh', '#a78bfa')
          debugLayout(self)
        },
      }))
    ScrollTrigger.refresh()
  }

  // ---- Boot: build the ring, then arm the scene ----
  function boot() {
    buildPointBuffers()
    ready = true
    // Upgrade the layout BEFORE measuring. `.is-canvas` is what makes the track
    // `position: sticky; height: 100vh` — measure beforehand and the canvas is
    // sized against the collapsed (`:not(.is-canvas)`) track, so its backing-store
    // aspect ratio won't match the painted box and the ring renders as an ellipse
    // at the wrong scale (only self-correcting on a later resize). Measure after.
    root.classList.add('is-canvas') // CSS clips the track + switches off the static layout
    resize()
    buildScroll()
    root.classList.add('is-ready') // lift the anti-FOUC gate
    ensureLoop()
  }

  // Visibility: only render while the section is on screen. When it leaves the
  // viewport the rAF loop stops — but the canvas keeps its last painted frame
  // and the messages stay revealed (autoAlpha:1), which would otherwise bleed
  // into the background of other sections. So on exit we clear the canvas and
  // flag the root .is-offscreen (CSS hides the messages); on re-entry we redraw.
  const io = new window.IntersectionObserver(
    (entries) => {
      inView = entries[0].isIntersecting
      root.classList.toggle('is-offscreen', !inView)
      if (inView) {
        ensureLoop()
      } else if (ready) {
        ctx.clearRect(0, 0, cssW, cssH)
      }
    },
    { threshold: 0 }
  )
  io.observe(root)

  // Localized hover push over the cloud stage.
  stage.addEventListener('pointermove', (e) => {
    const rect = stage.getBoundingClientRect()
    mx = (e.clientX - rect.left - cssW / 2) / scale
    my = (e.clientY - rect.top - cssH / 2) / scale
  })
  stage.addEventListener('pointerenter', () => {
    hovActive = true
  })
  stage.addEventListener('pointerleave', () => {
    hovActive = false
  })

  boot()

  return {
    resize() {
      if (!ready) return
      resize()
      ScrollTrigger.refresh()
    },
  }
}

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='scroll-morph']
 */
export default function (elements) {
  if (!gsap || !ScrollTrigger) {
    console.warn(
      '[scroll-morph] GSAP / ScrollTrigger not found on window — static fallback'
    )
  } else {
    gsap.registerPlugin(ScrollTrigger)
  }

  const instances = elements.map(setupRoot).filter(Boolean)
  if (!instances.length) return

  return {
    resize() {
      instances.forEach((inst) => inst.resize())
    },
  }
}
