/*
  Component: paradigm · data-component="paradigm"
  Autoplay tabs with a per-number underline (grey track + black fill, active-only) and a
  per-word text de-blur on each switch. The underline IS the clock: a pausable tween per
  tab, its dwell = the authored data-video-time cue gap (VIDEO mode, one shared <video>
  slaved to the active tab) or the text-scaled duration (legacy TIMER mode + image
  crossfade). Hover never pauses it; clicking a number LOCKS the cycle on that tab with its
  underline full, until the same number is clicked again.
  CSS → ./styles/paradigm.css (bundled via src/styles.js) · Docs → .claude/rules/components/paradigm.md
*/

import { REVEAL_FROM, REVEAL_TO, splitElement } from '../utils/word-reveal.js'
import { armFill, fadeOutFill, lockFill } from '../utils/tab-underline.js'

const { gsap } = window

// Tuning
const CUE_ATTR = 'data-video-time' // seconds at which this tab's text becomes active
const CROSSFADE = 0.6 // visual crossfade (timer mode only)
const OUT_FADE = 0.3 // outgoing text fade
// Timer-mode autoplay dwell scales with the tab's text length (more words → longer).
const AUTOPLAY_BASE = 3.5 // seconds baseline per tab
const AUTOPLAY_PER_WORD = 0.35 // extra seconds per word of the tab's message
const AUTOPLAY_MIN = 4 // floor
const AUTOPLAY_MAX = 11 // ceiling
// Playhead slack (video mode). SEEK_SLACK: drift tolerated at a switch before the footage
// is re-synced — under it the video is left playing through untouched, so with nobody
// locking a tab nothing is ever seeked. SEG_SLACK: tolerance on the segment's lower edge
// (a seek lands a few ms short of the cue).
const SEEK_SLACK = 0.25
const SEG_SLACK = 0.05
const LOCKED_CLASS = 'is-locked' // hook for CSS / the Designer — no rule ships with it

// Per-tab autoplay seconds from its message word count (timer mode).
function autoplayDuration(el) {
  const words = (el?.textContent || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
  const d = AUTOPLAY_BASE + words * AUTOPLAY_PER_WORD
  return Math.min(AUTOPLAY_MAX, Math.max(AUTOPLAY_MIN, d))
}

// Outgoing tab: plain fade only. The de-blur lives on the words, never the parent —
// a filter on the title element would linger and blur the words on re-entry.
const REVEAL_OUT = { autoAlpha: 0, duration: OUT_FADE }

// The single shared video: explicit hook (on the <video> or its wrapper) → any video in
// the visual wrapper → any video in the root.
function resolveVideo(root) {
  const hook = root.querySelector('[data-paradigm-video]')
  if (hook) return hook.matches('video') ? hook : hook.querySelector('video')
  return (
    root.querySelector('.tabs-paradigm_visual-wrapper video') ||
    root.querySelector('video')
  )
}

function setupRoot(root) {
  const titles = gsap.utils.toArray(
    root.querySelectorAll('[data-paradigm="tab-title"]')
  )
  const messages = titles.map(
    (t) => t.querySelector('[data-paradigm-message]') || t
  )
  const links = gsap.utils.toArray(
    root.querySelectorAll('[data-paradigm="tab-link"]')
  )
  const visuals = gsap.utils.toArray(
    root.querySelectorAll('[data-paradigm-visual]')
  )
  const video = resolveVideo(root)
  // Video mode: the playhead owns the timing, so the visuals aren't paired per tab and
  // don't count towards the tab count.
  const count = video
    ? Math.min(titles.length, links.length)
    : Math.min(titles.length, links.length, visuals.length)
  if (count < 1) {
    console.warn(
      video
        ? '[paradigm] needs at least one tab-title / tab-link'
        : '[paradigm] needs at least one tab-title / tab-link / visual'
    )
    return null
  }

  root.classList.add('is-enhanced')

  // Per-number underline (active-only): inject a grey track + black fill into each number.
  // Only the active number's fill grows 0→1; the rest stay empty (inactive). Replaces the
  // single full-width .tabs_number-underline (hidden via CSS).
  const bars = links.slice(0, count).map((link) => {
    const track = document.createElement('span')
    track.className = 'tabs-paradigm_tab-link-underline is-track'
    const fill = document.createElement('span')
    fill.className = 'tabs-paradigm_tab-link-fill'
    track.appendChild(fill)
    link.appendChild(track)
    return fill
  })

  const wordsByTab = messages.slice(0, count).map(splitElement)

  // Initial states (before autoplay starts)
  gsap.set(titles, { autoAlpha: 0 })
  gsap.set(wordsByTab.flat(), REVEAL_FROM)
  gsap.set(bars, { scaleX: 0, transformOrigin: 'left center' })
  if (video) {
    // One asset for the whole section: show the visual holding the video, hide any leftover.
    const videoVisual = visuals.find((v) => v.contains(video))
    gsap.set(visuals, { autoAlpha: 0 })
    gsap.set(videoVisual || visuals, { autoAlpha: 1 })
  } else {
    gsap.set(visuals, { autoAlpha: 0 })
  }

  let index = 0
  let started = false
  let progressTl = null // the active tab's progress clock (both modes)
  let dwellUsed = 0 // seconds the running clock was built with
  let onScreen = false
  let lockedIndex = -1 // >= 0 → the user clicked this tab and the cycle holds on it
  let docVisible = !document.hidden

  const isLocked = () => lockedIndex >= 0

  // Cue times (segment starts), seconds. Explicit from data-video-time on the link (title as
  // fallback), else the video duration split evenly — resolved once metadata is known.
  let cues = links.map((_, i) => i)
  let duration = 0
  const evenSplit = (i) => (duration ? (i * duration) / count : i)
  const resolveCues = () => {
    duration = video && isFinite(video.duration) ? video.duration : 0
    cues = links.slice(0, count).map((link, i) => {
      const raw = parseFloat(
        link.getAttribute(CUE_ATTR) ?? titles[i]?.getAttribute(CUE_ATTR)
      )
      return isFinite(raw) ? raw : evenSplit(i)
    })
    // Cues must strictly increase — they're segment STARTS. The same value on every tab
    // (a Webflow class/component edit applying one attribute to all of them) makes every
    // segment zero-length and strands the last tab active with the others empty. Warn and
    // fall back to an even split rather than shipping a section that looks broken.
    if (cues.some((c, i) => i > 0 && c <= cues[i - 1])) {
      console.warn(
        `[paradigm] ${CUE_ATTR} must increase per tab (got ${cues.join(', ')}) — falling back to an even split`
      )
      cues = links.slice(0, count).map((_, i) => evenSplit(i))
    }
  }
  const cueStart = (i) => cues[i] || 0
  const cueEnd = (i) => (i < count - 1 ? cues[i + 1] : duration || cueStart(i))

  const playVideo = () => {
    const p = video.play()
    if (p && typeof p.catch === 'function') p.catch(() => {})
  }
  const seek = (t) => {
    try {
      video.currentTime = t
    } catch {
      /* not seekable yet */
    }
  }

  // Off-screen / hidden tab pause everything. A LOCKED tab pauses only the underline clock:
  // the video keeps looping its segment (holdSegment), so the visual never freezes on the
  // tab the user chose to hold.
  const visible = () => started && onScreen && docVisible
  const sync = () => {
    const on = visible()
    if (video) on ? playVideo() : video.pause()
    if (progressTl) on && !isLocked() ? progressTl.play() : progressTl.pause()
  }

  const activate = (i) => {
    links.forEach((l, k) => {
      l.classList.toggle('is-active', k === i)
      l.setAttribute('aria-current', k === i ? 'true' : 'false')
    })

    titles.forEach((t, k) => {
      if (k !== i) gsap.to(t, REVEAL_OUT)
    })
    gsap.set(titles[i], { autoAlpha: 1 })
    gsap.set(wordsByTab[i], REVEAL_FROM)
    gsap.to(wordsByTab[i], REVEAL_TO)

    // Timer mode only — in video mode the single asset stays put.
    if (!video)
      visuals.forEach((v, k) =>
        gsap.to(v, {
          autoAlpha: k === i ? 1 : 0,
          duration: CROSSFADE,
          ease: 'sine.out',
        })
      )
  }

  // Every non-active number's fill fades out where it stands (see tab-underline.js).
  const setStaticFills = (i) => {
    bars.forEach((bar, k) => k !== i && fadeOutFill(bar))
  }

  // Dwell for a tab: the authored cue gap in video mode (so the underline still measures the
  // segment the footage was cut to), the text-scaled duration otherwise.
  const dwellFor = (i) => {
    const gap = video ? cueEnd(i) - cueStart(i) : 0
    return isFinite(gap) && gap > 0 ? gap : autoplayDuration(messages[i])
  }

  // The underline IS the clock: only the active number's fill grows floor→1 over that tab's
  // dwell (the others stay empty) and its completion advances the tab. Being a tween is the
  // point — it can be paused by a lock while the video plays on, which reading the playhead
  // every frame could never do.
  const runProgress = () => {
    progressTl && progressTl.kill()
    setStaticFills(index)
    armFill(bars[index]) // starts at the visible floor, not 0
    dwellUsed = dwellFor(index)
    progressTl = gsap.timeline({ onComplete: () => goTo((index + 1) % count) })
    progressTl.to(
      bars[index],
      { scaleX: 1, duration: dwellUsed, ease: 'none' },
      0
    )
    sync()
  }

  // Re-sync the footage to the tab it belongs to — but only once it has actually drifted,
  // which only a lock can cause. Unlocked, the playhead is already at the cue, so the video
  // is never seeked and plays through as one continuous shot. A seek that IS needed lands
  // here, hidden under the text transition, instead of out in the open.
  const syncPlayhead = (i) => {
    if (!video) return
    const target = cueStart(i)
    if (Math.abs(video.currentTime - target) > SEEK_SLACK) seek(target)
  }

  function goTo(i) {
    index = i
    activate(i)
    syncPlayhead(i)
    runProgress()
  }

  // Click-to-lock: the cycle holds on the clicked tab, its underline full. Pause the clock
  // BEFORE filling the bar — lockFill overwrites the timeline's own bar tween, and a
  // timeline emptied while still playing fires onComplete on the next tick.
  const markLocked = () => {
    root.classList.toggle(LOCKED_CLASS, isLocked())
    links.forEach((l, k) => l.classList.toggle(LOCKED_CLASS, k === lockedIndex))
  }
  const lock = (i) => {
    lockedIndex = i
    progressTl?.pause()
    markLocked()
    lockFill(bars[i])
    sync() // the video keeps playing — holdSegment loops it inside this tab's segment
  }
  // Release: rebuild the clock from this tab (armFill resets the bar to its visible floor).
  // The playhead is deliberately NOT seeked — it's already inside the right segment, and the
  // next switch re-syncs it under the text transition rather than jump-cutting here.
  const unlock = () => {
    lockedIndex = -1
    markLocked()
    runProgress()
  }

  // Video mode, rAF: the playhead is slaved to the active tab. While the underline clock is
  // paused (locked tab) the video would otherwise run on into the next tab's footage — or
  // wrap to 0 on the last tab — so it loops the active segment instead. Nothing to do while
  // the clock runs: the tween owns the switch and the playhead is in step with it.
  const holdSegment = () => {
    if (!started || !progressTl || !progressTl.paused()) return
    const s = cueStart(index)
    const e = cueEnd(index)
    if (!(e > s)) return // last tab before metadata lands: span still unknown
    const t = video.currentTime
    if (t < s - SEG_SLACK || t >= e) seek(s)
  }

  const start = () => {
    if (started) return
    started = true
    if (video) resolveCues()
    goTo(0)
  }

  // User-driven switch (click / keyboard): jumps to that tab AND locks it. Activating the
  // locked tab again releases it. Kicks off autoplay if it hasn't started yet.
  const select = (i) => {
    if (lockedIndex === i) return unlock()
    if (!started && video) resolveCues()
    started = true
    // Already on this tab (and running): lock it in place — re-running goTo would replay the
    // word reveal for nothing.
    if (i !== index || !progressTl) goTo(i)
    lock(i)
  }

  const wireButton = (el, onActivate, label) => {
    el.setAttribute('role', 'button')
    el.setAttribute('tabindex', '0')
    el.setAttribute('aria-label', label)
    el.addEventListener('click', onActivate)
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onActivate()
      }
    })
  }

  // Clicking a number in the menu jumps to that tab.
  links.forEach((l, i) =>
    wireButton(l, () => select(i), 'Go to slide ' + (i + 1))
  )

  // Prep the shared video: muted + inline (autoplay-with-sound is blocked, so it would never
  // play at all), LOOP on so it wraps back to the first segment.
  if (video) {
    video.muted = true
    video.loop = true
    video.playsInline = true
    video.setAttribute('playsinline', '')
    video.preload = 'auto'
    video.addEventListener('loadedmetadata', () => {
      resolveCues()
      // The last tab's cue gap needs the duration, and an unauthored cue set needs it for all
      // of them — so if metadata lands after autoplay started, re-run the active tab on the
      // corrected dwell instead of letting it finish on the placeholder gap. Never while
      // locked: there's no running clock to correct, and re-running would reset the full bar.
      if (
        started &&
        !isLocked() &&
        Math.abs(dwellFor(index) - dwellUsed) > SEEK_SLACK
      )
        runProgress()
    })
    if (isFinite(video.duration) && video.duration > 0) resolveCues()
    gsap.ticker.add(holdSegment)
  }

  // Visibility / tab-focus gating
  const io = new window.IntersectionObserver(
    (entries) => {
      onScreen = entries[0].isIntersecting
      if (onScreen && !started) start()
      else sync()
    },
    {
      // threshold stays 0 + a negative rootMargin: intersectionRatio is capped at
      // viewportHeight/elementHeight, so a section taller than ~2.5x the viewport
      // (routine on mobile) never reaches a 0.4 threshold and this never fires.
      threshold: 0,
      rootMargin: '-25% 0px -25% 0px',
    }
  )
  io.observe(root)

  document.addEventListener('visibilitychange', () => {
    docVisible = !document.hidden
    sync()
  })
}

// Static fallback (no GSAP / reduced motion): show the first tab only via classes.
function staticFallback(root) {
  const first = (sel) => root.querySelector(sel)
  first('[data-paradigm="tab-title"]')?.classList.add('is-active')
  first('[data-paradigm="tab-link"]')?.classList.add('is-active')
  first('[data-paradigm-visual]')?.classList.add('is-active')
  root.classList.add('is-static')
}

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='paradigm']
 */
export default function (elements) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (!gsap || reduce) {
    if (!gsap)
      console.warn('[paradigm] GSAP not found on window — static fallback')
    elements.forEach(staticFallback)
    return
  }

  elements.forEach(setupRoot)
}
