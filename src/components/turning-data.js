/*
  Component: turning-data · data-component="turning-data"
  Plays a clip inside the monitor of a still photo, framed to the display.
  CSS lives in WEBFLOW (native Client-First styles), not here · Docs → .claude/rules/components/turning-data.md
*/
console.log('test')
const VIDEO = '[data-turning-data="video"]'
const SCREEN = '[data-turning-data="screen"]'
const GLARE = '[data-turning-data="glare"]'
const OPT_OUT = 'data-turning-data-fit' // "css" = keep the stylesheet's transform
const IN_VIEW = '0px 0px -15% 0px' // ≈ ScrollTrigger's "top 85%"

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='turning-data']
 */
export default function (elements) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  elements.forEach((root) => {
    try {
      setup(root, reduced)
    } catch (err) {
      console.error('[turning-data]', err)
    }
  })
}

function setup(root, reduced) {
  const video = root.querySelector(VIDEO)
  if (!video) {
    console.warn(
      '[turning-data] no [data-turning-data="video"] — nothing to play'
    )
    return
  }

  // Geometry runs regardless of the motion preference: a paused frame has to
  // sit on the monitor just as exactly as a playing one.
  if (root.getAttribute(OPT_OUT) !== 'css') fitToScreen(root, video)

  // Autoplay with sound is blocked outright, so an unmuted video never plays.
  // The autoplay attribute is the markup's no-JS fallback; playback is owned
  // here, or a below-the-fold clip would run from load.
  video.removeAttribute('autoplay')
  video.muted = true
  video.playsInline = true
  video.loop = true

  // Not a shorter animation: none. The photo's own screen carries the section.
  // pause() is required, not tidiness: removeAttribute above cannot stop a
  // clip the autoplay attribute has already started.
  if (reduced) {
    video.pause()
    return
  }

  let visible = false

  const sync = () => {
    if (visible && !document.hidden) {
      // Rejects on a policy block; the poster stays and nothing throws.
      video.play()?.catch(() => {})
    } else {
      video.pause()
    }
  }

  new window.IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting
      sync()
    },
    { threshold: 0, rootMargin: IN_VIEW }
  ).observe(root)

  document.addEventListener('visibilitychange', sync)
}

/* ── Geometry ──────────────────────────────────────────────────────────
   The display is a TRAPEZOID: its top and bottom edges are ~2.5deg apart.
   The stylesheet can only describe a parallelogram (a linear matrix has no
   perspective term), which leaves ~1.26deg on each edge — about 26px of
   drift across the panel. This maps the video's box onto the quad exactly.

   It has to be JS: the projective transform carries px translations, so
   unlike the CSS fallback it is NOT scale-invariant and must be recomputed
   whenever the box changes size.

   The quad is read from the element's own `clip-path`, not from an
   attribute — the polygon already IS the measured silhouette, so there is
   no second copy to drift out of sync.
   ────────────────────────────────────────────────────────────────────── */
function fitToScreen(root, video) {
  const screen = root.querySelector(SCREEN)
  if (!screen) return

  const glare = root.querySelector(GLARE)
  const targets = glare ? [video, glare] : [video]
  let fitted = false

  const apply = () => {
    const w = screen.clientWidth
    const h = screen.clientHeight
    if (!w || !h) return

    const quad = readQuad(screen, w, h)
    if (!quad) return // no polygon → the stylesheet's fallback stands

    const m = homography(w, h, quad)
    if (!m) return // degenerate → same, leave the fallback alone

    const css = `matrix3d(${m.join(', ')})`
    targets.forEach((el) => {
      // matrix3d works in the element's own coordinate space, so the origin
      // must be its top-left — not the `center` the CSS fallback uses.
      el.style.transformOrigin = '0 0'
      el.style.transform = css
    })

    // Dev-only: the one signal that the projective fit ran rather than the
    // CSS fallback. Terser strips it from the production build.
    if (!fitted) {
      fitted = true
      console.log(
        `%c🖥 [turning-data] projective fit on a ${Math.round(w)}×${Math.round(h)} screen, ${targets.length} target(s)`,
        'color: #a78bfa; font-weight: bold'
      )
    }
  }

  apply()
  // ResizeObserver, not the component's resize hook: that one is debounced
  // and width-only, and this box changes height whenever the photo does.
  new window.ResizeObserver(apply).observe(screen)
}

function readQuad(el, w, h) {
  const raw = window.getComputedStyle(el).clipPath || ''
  const inner = raw.match(/polygon\(([^)]*)\)/)
  if (!inner) return null

  const pts = inner[1].split(',').map((pair) => {
    const [x, y] = pair.trim().split(/\s+/)
    return [toPx(x, w), toPx(y, h)]
  })
  const ok =
    pts.length === 4 && pts.every((p) => p.every((n) => Number.isFinite(n)))
  return ok ? pts : null
}

function toPx(value, base) {
  const n = parseFloat(value)
  if (!Number.isFinite(n)) return NaN
  return value.trim().endsWith('%') ? (n / 100) * base : n
}

/** Projective map of the box (0,0)-(w,h) onto `quad`, as CSS matrix3d args. */
function homography(w, h, quad) {
  const src = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ]

  // Solve for [a b c d e f g h] in
  //   u = (a x + b y + c) / (g x + h y + 1)
  //   v = (d x + e y + f) / (g x + h y + 1)
  const A = []
  const rhs = []
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i]
    const [u, v] = quad[i]
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u])
    rhs.push(u)
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v])
    rhs.push(v)
  }

  const s = solve(A, rhs)
  if (!s) return null
  const [a, b, c, d, e, f, g, i] = s

  // CSS matrix3d is COLUMN-major. Nine decimals, not six: the two
  // perspective terms are ~1e-5, so coarser rounding costs half a pixel at
  // the far corner — which is most of the error this function exists to remove.
  return [a, d, 0, g, b, e, 0, i, 0, 0, 1, 0, c, f, 0, 1].map(
    (n) => Math.round(n * 1e9) / 1e9
  )
}

/** Gaussian elimination with partial pivoting. Returns null if singular. */
function solve(A, rhs) {
  const n = rhs.length
  const M = A.map((row, r) => [...row, rhs[r]])

  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r
    }
    if (Math.abs(M[pivot][col]) < 1e-9) return null
    ;[M[col], M[pivot]] = [M[pivot], M[col]]

    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const factor = M[r][col] / M[col][col]
      for (let k = col; k <= n; k++) M[r][k] -= factor * M[col][k]
    }
  }
  return M.map((row, r) => row[n] / row[r])
}
