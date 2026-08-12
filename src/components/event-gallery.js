/*
  Component: event-gallery · data-component="event-gallery"
  Infinite image strip — the row is cloned until it covers the viewport and driven by ONE
  Web Animations API tween at a constant px/s, so the crawl reads the same whatever the
  image count, image widths or breakpoint.
  CSS → ./styles/event-gallery.css · Docs → .claude/rules/components/event-gallery.md
*/

const SPEED = 60 // px per second — a speed, not a lap time (see the doc)
const SPEED_MOBILE = 35 // ↳ below MOBILE_Q. Same px/s reads FASTER on a narrow screen (see the doc)
const MOBILE_Q = '(max-width: 767px)' // the project's mobile breakpoint
const HOVER_RATE = 0.25 // playbackRate while a mouse is over the strip (0 = stop, 1 = no slowdown)
const RATE_RAMP = 0.45 // seconds to ease between the two rates — an instant swap reads as a stutter
const MIN_COPIES = 2 // fewer than two leaves nothing to loop into
const RESYNC_EPS = 1 // px a re-measure must move before the loop is rebuilt
const NEAR_VIEW = '200px 0px' // start loading + looping just before the strip is on screen

// Hook preferred; falls back to the current Webflow class, so the only Designer edit is
// the root attribute.
const LOOP_SELECTOR = '[data-event-gallery-loop], .event_gallery-loop'
const SPEED_ATTR = 'data-event-gallery-speed'
const SPEED_MOBILE_ATTR = 'data-event-gallery-speed-mobile'
const DIR_ATTR = 'data-event-gallery-direction'
const HOVER_ATTR = 'data-event-gallery-hover'
const FADE_ATTR = 'data-event-gallery-fade'
const BLEED_ATTR = 'data-event-gallery-bleed'
const BLEED_OFF = /^(false|off|container|no)$/i

// Class names — keep in sync with event-gallery.css.
const VIEWPORT = 'event-gallery_viewport'
const ROW = 'event-gallery_row'
const COPY = 'event-gallery_copy'
const SCROLL = 'event-gallery_scroll'
const BLEED = 'is-bleed'

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const canHover = window.matchMedia('(hover: hover)')
const isMobile = window.matchMedia(MOBILE_Q)

function num(el, attr, fallback) {
  const v = parseFloat(el.getAttribute(attr))
  return Number.isFinite(v) ? v : fallback
}

// The Designer's own gap on the loop element, so spacing stays a Webflow decision.
function readGap(el) {
  const g = parseFloat(getComputedStyle(el).columnGap)
  return Number.isFinite(g) && g > 0 ? `${g}px` : ''
}

function prepImage(img) {
  img.loading = 'eager' // a lazy copy only loads as it scrolls in — i.e. a hole in the loop
  img.decoding = 'async'
  img.draggable = false
}

function setup(root) {
  const loop = root.matches(LOOP_SELECTOR)
    ? root
    : root.querySelector(LOOP_SELECTOR)
  if (!loop) {
    console.warn(
      '[event-gallery] no [data-event-gallery-loop] found — skipping'
    )
    return
  }

  const items = Array.from(loop.children)
  if (!items.length) {
    console.warn('[event-gallery] the loop has no children — skipping')
    return
  }

  // Reduced motion (or a browser missing one of the three native APIs this rests on):
  // markup untouched, no clones — the user pans the strip by hand.
  const supported =
    loop.animate && window.ResizeObserver && window.IntersectionObserver
  if (reduceMotion.matches || !supported) {
    root.classList.add('is-static')
    loop.classList.add(SCROLL)
    return
  }

  const speedWide = Math.abs(num(root, SPEED_ATTR, SPEED)) || SPEED
  const speedNarrow =
    Math.abs(num(root, SPEED_MOBILE_ATTR, SPEED_MOBILE)) || SPEED_MOBILE
  const back = (root.getAttribute(DIR_ATTR) || '').toLowerCase() === 'right'
  const hoverRate = num(root, HOVER_ATTR, HOVER_RATE)
  const bleed = !BLEED_OFF.test((root.getAttribute(BLEED_ATTR) || '').trim())
  if (root.hasAttribute(FADE_ATTR)) {
    // A length turns the fade on at that width; any other value (e.g. "True") uses the CSS default.
    const fade = (root.getAttribute(FADE_ATTR) || '').trim()
    if (/^[\d.]/.test(fade)) root.style.setProperty('--evgal-fade', fade)
  }

  // — Build: the strip becomes copy 1 inside the animated row —
  const gap = readGap(loop)
  const row = document.createElement('div')
  const copy = document.createElement('div')
  row.className = ROW
  copy.className = COPY
  if (gap) {
    row.style.gap = gap
    copy.style.gap = gap
  }
  items.forEach((el) => copy.appendChild(el))
  row.appendChild(copy)
  loop.classList.add(VIEWPORT)
  if (bleed) loop.classList.add(BLEED)
  loop.appendChild(row)
  root.classList.add('is-enhanced')

  let anim = null
  let shift = 0 // px the row travels per lap = one copy + one gap
  let speedUsed = 0 // the px/s the live animation was built on
  let inView = false
  let started = false
  let rateNow = 1
  let rateTarget = 1
  let rateRaf = 0
  let pending = 0

  function cloneCopy() {
    const clone = copy.cloneNode(true)
    clone.setAttribute('aria-hidden', 'true')
    clone.inert = true // a duplicated link must never become a second tab stop
    clone.querySelectorAll('img').forEach(prepImage)
    clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'))
    return clone
  }

  // Full bleed: pull the clip box out of its container so the strip is cut at the SCREEN
  // edges, the way the section is drawn. Measured, not `100vw` — that unit includes the
  // scrollbar, so it would push the page sideways by its width on every desktop with one.
  function stretch() {
    if (!bleed) return
    loop.style.transform = '' // rect reads the VISUAL box, so clear it before measuring
    loop.style.width = `${document.documentElement.clientWidth}px`
    const left = loop.getBoundingClientRect().left
    // A transform, not a negative margin: a margin is layout, so a parent that centres its
    // children (which is how a strip ends up spilling both ways) re-centres the box around
    // it and it lands somewhere else. A transform can't be argued with.
    loop.style.transform = `translateX(${-left}px)`
  }

  // Measure one copy and keep enough of them to cover the viewport plus a full lap.
  function fit() {
    const gapPx = parseFloat(getComputedStyle(row).columnGap) || 0
    const width = copy.getBoundingClientRect().width
    if (width < 1) return false // nothing laid out yet — the ResizeObserver will call back
    const next = width + gapPx
    const changed = Math.abs(next - shift) > RESYNC_EPS
    shift = next
    const need = Math.max(
      MIN_COPIES,
      Math.ceil((loop.clientWidth + gapPx) / next) + 1
    )
    while (row.children.length > need) row.lastElementChild.remove()
    while (row.children.length < need) row.appendChild(cloneCopy())
    return changed
  }

  function sync() {
    if (!anim) return
    if (inView && !document.hidden) anim.play()
    else anim.pause()
  }

  // Read live, not captured at init — a phone rotated past 767px has to retime.
  function speedNow() {
    return isMobile.matches ? speedNarrow : speedWide
  }

  function play() {
    if (shift <= 0) return
    speedUsed = speedNow()
    const duration = (shift / speedUsed) * 1000
    // Carry the lap position over, or a re-measure snaps the strip back to its start.
    const progress = anim ? anim.effect.getComputedTiming().progress || 0 : 0
    const from = back ? -shift : 0
    const to = back ? 0 : -shift
    if (anim) anim.cancel()
    anim = row.animate(
      [
        { transform: `translate3d(${from}px, 0, 0)` },
        { transform: `translate3d(${to}px, 0, 0)` },
      ],
      { duration, iterations: Infinity, easing: 'linear' }
    )
    anim.currentTime = progress * duration
    anim.playbackRate = rateNow
    sync()
  }

  function refresh() {
    stretch()
    const changed = fit()
    // The speed check is what catches a breakpoint cross that didn't move the lap at all.
    if (changed || !anim || speedUsed !== speedNow()) play()
  }

  // playbackRate is stepped, so hover is ramped by hand — the strip accelerates from its
  // current speed instead of jumping.
  function rampTo(target) {
    rateTarget = target
    if (rateRaf) return
    let last = window.performance.now()
    const step = (now) => {
      const dt = Math.max(0, (now - last) / 1000)
      last = now
      const by = RATE_RAMP > 0 ? dt / RATE_RAMP : 1
      rateNow =
        Math.abs(rateTarget - rateNow) <= by
          ? rateTarget
          : rateNow + Math.sign(rateTarget - rateNow) * by
      if (anim) anim.playbackRate = rateNow
      rateRaf = rateNow === rateTarget ? 0 : requestAnimationFrame(step)
    }
    rateRaf = requestAnimationFrame(step)
  }

  // Covers image decode, srcset swaps at a breakpoint and font reflow. It does NOT cover a
  // window resize once full-bleed is on — the box's width is pinned to a measured px value,
  // so nothing about it changes on its own. That's what the `resize` hook is for.
  const ro = new window.ResizeObserver(() => {
    if (pending) return
    pending = requestAnimationFrame(() => {
      pending = 0
      refresh()
    })
  })
  ro.observe(copy)
  ro.observe(loop)

  // Nothing downloads or animates until the strip is nearly on screen.
  const io = new window.IntersectionObserver(
    ([entry]) => {
      inView = entry.isIntersecting
      if (inView && !started) {
        started = true
        items.forEach((el) => {
          if (el.tagName === 'IMG') prepImage(el)
          else el.querySelectorAll('img').forEach(prepImage)
        })
        refresh()
      }
      sync()
    },
    { rootMargin: NEAR_VIEW }
  )
  io.observe(root)

  document.addEventListener('visibilitychange', sync)

  // Mouse only: on touch a tap fires mouseenter with no matching mouseleave, which would
  // leave the strip crawling for good.
  if (canHover.matches && hoverRate !== 1) {
    loop.addEventListener('mouseenter', () => rampTo(hoverRate))
    loop.addEventListener('mouseleave', () => rampTo(1))
  }

  return refresh
}

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='event-gallery']
 */
export default function (elements) {
  const strips = []

  elements.forEach((root) => {
    try {
      const refresh = setup(root)
      if (refresh) strips.push(refresh)
    } catch (err) {
      console.error('[event-gallery] init failed', err)
    }
  })

  return {
    // Only fires on a real viewport WIDTH change (main.js ignores height-only resizes),
    // which is exactly when the full-bleed box has to be re-measured.
    resize() {
      strips.forEach((refresh) => refresh())
    },
  }
}
