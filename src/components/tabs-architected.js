/*
  Component: tabs-architected · data-component="tabs-architected"
  ONE shared looping video drives multiple text tabs. As the playhead crosses each tab's
  cue time (data-video-time, seconds), the incoming text de-blurs in and the active tab's
  underline fills across that segment. Video-driven (no timer): plays muted+inline on
  scroll-in, loops, pauses off-screen / hidden tab. Click / keyboard seek the
  video to a segment. No video → text-scaled timer fallback.
  CSS → ./styles/tabs-architected.css (bundled via src/styles.js) · Docs → .claude/rules/components/tabs-architected.md
*/

import { REVEAL_FROM } from '../utils/word-reveal.js'

const { gsap } = window

const ACTIVE_CLASS = 'is-active'
const CUE_ATTR = 'data-video-time' // seconds at which this tab's text becomes active

// Fallback autoplay dwell (only when there is NO video and no cue gap) — text-scaled.
const AUTOPLAY_BASE = 3.5
const AUTOPLAY_PER_WORD = 0.35
const AUTOPLAY_MIN = 4
const AUTOPLAY_MAX = 11

// Content blocks de-blur + fade + rise (REVEAL_FROM = shared paradigm/hero start state).
const CONTENT_TO = {
  autoAlpha: 1,
  filter: 'blur(0px)',
  yPercent: 0,
  duration: 0.9,
  stagger: 0.1,
  ease: 'sine.out',
}
// Outgoing text just fades out underneath the incoming reveal.
const OUT_FADE = { autoAlpha: 0, duration: 0.4, ease: 'power2.out' }
// Text column collapses onto the active panel — matched to CONTENT_TO so the resize and
// the de-blur read as one motion, not two.
const FIT_TWEEN = { duration: 0.9, ease: 'sine.out' }
// Outgoing fill eases out instead of snapping full → empty in one frame (read as a glitch).
const FILL_OUT = {
  scaleX: 0,
  duration: 0.35,
  ease: 'power2.in',
  overwrite: true,
}

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

const clamp01 = (n) => Math.min(1, Math.max(0, n))

// Fallback dwell (no video, no cue gap) from the panel's word count.
function autoplayDuration(el) {
  const words = (el?.textContent || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
  const d = AUTOPLAY_BASE + words * AUTOPLAY_PER_WORD
  return Math.min(AUTOPLAY_MAX, Math.max(AUTOPLAY_MIN, d))
}

// Wire one tabs root. Returns { destroy } for cleanup, or null if the markup is
// incomplete.
function setupTabs(root) {
  const links = gsap.utils.toArray(
    root.querySelectorAll('[tabs-architected="link"]')
  )
  // Text panels = the stacked content blocks (one per tab), paired to the links by index.
  // The section has ONE video + one text-content holding N `.tabs-architected_tab-content-inner`.
  const panels = gsap.utils.toArray(
    root.querySelectorAll('.tabs-architected_tab-content-inner')
  )

  // Need at least two link/panel pairs to do anything useful.
  if (links.length < 2 || panels.length < 2) {
    console.warn('[tabs-architected] need >= 2 links and panels — skipping')
    return null
  }

  const count = Math.min(links.length, panels.length)

  // Enhanced flag — gates the CSS text-block stacking so the blocks only overlap once the
  // bundle runs (Preview / published). In the Designer (no JS) they stay in normal flow,
  // one below the other, editable.
  root.classList.add('is-enhanced')

  // The stacked text column — its height is tweened onto the active panel (see fitPanels).
  const textWrap = root.querySelector('[tabs-architected="text-content"]')

  // The single shared video (hook on the <video> or its wrapper; `image` accepted for
  // back-compat with the original markup; else any video in root).
  const videoHook =
    root.querySelector('[tabs-architected="video"]') ||
    root.querySelector('[tabs-architected="image"]')
  const video =
    (videoHook?.matches('video')
      ? videoHook
      : videoHook?.querySelector('video')) || root.querySelector('video')

  // Turn each underline into a grey TRACK + inject a black FILL child that scales 0→1.
  // Active-only: only the active tab's fill shows; every other tab stays empty (inactive).
  // Reduced motion skips track/fill; `bars` = the fill children.
  const bars = links.map((link) => {
    const track = link.querySelector('.tabs-architected_tab-link-underline')
    if (!track || reduceMotion.matches) return null
    const fill = document.createElement('span')
    fill.className = 'tabs-architected_tab-link-fill'
    track.appendChild(fill)
    track.classList.add('is-track')
    return fill
  })

  // Each panel is a `.tabs-architected_tab-content-inner`; its direct children (heading,
  // paragraph, button) de-blur in, staggered.
  const parts = panels.map((panel) => ({
    content: gsap.utils.toArray(panel.children),
  }))

  let activeIndex = -1
  let isAnimating = false
  let started = false // autoplay kicked off (section reached)
  let onScreen = false
  let progressTween = null // fallback timer (no-video mode only)

  // Cue times (segment starts), seconds. Explicit from data-video-time, else evenly
  // divided across the video duration (resolved once metadata is known).
  let cues = links.map((_, i) => i)
  let duration = 0
  const resolveCues = () => {
    duration = video && isFinite(video.duration) ? video.duration : 0
    cues = links.map((link, i) => {
      const raw = parseFloat(
        link.getAttribute(CUE_ATTR) ?? panels[i]?.getAttribute?.(CUE_ATTR)
      )
      if (isFinite(raw)) return raw
      return duration ? (i * duration) / count : i // even split fallback
    })
  }
  const cueStart = (i) => cues[i] || 0
  const cueEnd = (i) => {
    if (i < count - 1) return cues[i + 1]
    if (duration) return duration
    // No video: last segment mirrors the previous gap so its dwell matches the others.
    return cueStart(i) + (count > 1 ? cueStart(i) - cueStart(i - 1) : 2)
  }

  // Segment the playhead falls into (last cue <= t).
  const indexForTime = (t) => {
    let idx = 0
    for (let i = 0; i < count; i++) if (t >= cueStart(i) - 0.001) idx = i
    return idx
  }

  const playVideo = () => {
    if (!video) return
    const p = video.play()
    if (p && typeof p.catch === 'function') p.catch(() => {})
  }

  // Autoplay runs only while started + on-screen + tab-visible.
  const gated = () => started && onScreen && !document.hidden

  // Play/pause the active clock (video, else the fallback tween) from the gate.
  const sync = () => {
    const go = gated()
    if (video) go ? playVideo() : video.pause()
    else if (progressTween) go ? progressTween.resume() : progressTween.pause()
  }

  // Accessibility scaffolding — tablist / tab / tabpanel with roving tabindex.
  root
    .querySelector('.tabs-architected_tabs-links')
    ?.setAttribute('role', 'tablist')
  links.forEach((link, i) => {
    const panel = panels[i]
    const linkId = link.id || `tabs-architected-tab-${i}`
    const panelId = panel.id || `tabs-architected-panel-${i}`
    link.id = linkId
    panel.id = panelId
    link.setAttribute('role', 'tab')
    link.setAttribute('aria-controls', panelId)
    link.setAttribute('tabindex', '-1')
    panel.setAttribute('role', 'tabpanel')
    panel.setAttribute('aria-labelledby', linkId)
  })

  // Active-only fills: every non-active tab empties out. Tweened, not set — a full bar
  // snapping to empty in one frame read as a flicker on every switch.
  const setStaticFills = (index) => {
    bars.forEach((bar, k) => {
      if (!bar || k === index) return
      gsap.to(bar, FILL_OUT)
    })
  }

  // Collapse the text column onto the active panel, so a short tab doesn't drag the tallest
  // tab's leftover height around with it. Measured off the DOM (the CSS `align-items: start`
  // keeps each stacked panel at its own content height, so a stretched grid item can't
  // report the row height back) rather than counting lines — line-height math is unreliable
  // in rich text. `immediate` skips the tween on load / resize, where there's no switch to
  // ride. Mirrors compouding's fitMessages.
  const fitPanels = (index, immediate) => {
    if (!textWrap || !panels[index]) return
    const h = panels[index].offsetHeight
    if (immediate) gsap.set(textWrap, { height: h })
    else gsap.to(textWrap, { height: h, ...FIT_TWEEN })
  }

  // De-blur the incoming text in (first tab uses this directly on start).
  const revealContent = (index) => {
    const content = parts[index].content
    if (content.length) gsap.fromTo(content, REVEAL_FROM, CONTENT_TO)
  }

  function switchTab(index) {
    if (isAnimating || index === activeIndex) return
    isAnimating = true

    const outLink = links[activeIndex]
    const outPanel = panels[activeIndex]
    const inLink = links[index]
    const inPanel = panels[index]

    // ARIA + active-class state flip
    outLink?.classList.remove(ACTIVE_CLASS)
    outPanel?.classList.remove(ACTIVE_CLASS)
    outLink?.setAttribute('aria-selected', 'false')
    outLink?.setAttribute('tabindex', '-1')
    inLink.classList.add(ACTIVE_CLASS)
    inPanel.classList.add(ACTIVE_CLASS)
    inLink.setAttribute('aria-selected', 'true')
    inLink.setAttribute('tabindex', '0')

    setStaticFills(index)
    if (bars[index]) {
      // Kill any FILL_OUT still easing this bar out (a switch back inside the 0.35s window)
      // — otherwise that tween and the ticker's per-frame set fight over scaleX.
      gsap.killTweensOf(bars[index])
      gsap.set(bars[index], { scaleX: 0, transformOrigin: 'left center' })
    }
    fitPanels(index)

    // Incoming overlays the outgoing (z-index) regardless of DOM order; it shows
    // instantly, its content de-blurs in while the outgoing fades out.
    gsap.set(inPanel, { autoAlpha: 1, zIndex: 2 })
    if (outPanel) gsap.set(outPanel, { zIndex: 1 })

    const tl = gsap.timeline({
      onComplete: () => {
        activeIndex = index
        isAnimating = false
        gsap.set(panels, { clearProps: 'zIndex' })
      },
    })
    if (outPanel) tl.to(outPanel, OUT_FADE, 0)
    const at = outPanel ? 0.15 : 0
    if (parts[index].content.length)
      tl.fromTo(parts[index].content, REVEAL_FROM, CONTENT_TO, at)
  }

  // Reduced motion: no de-blur, no autoplay. Panels toggle instantly via autoAlpha;
  // the active underline shows via CSS.
  function switchTabInstant(index) {
    if (index === activeIndex) return
    panels.forEach((p, i) => {
      const on = i === index
      gsap.set(p, { autoAlpha: on ? 1 : 0 })
      p.classList.toggle(ACTIVE_CLASS, on)
    })
    links.forEach((link, i) => {
      const on = i === index
      link.classList.toggle(ACTIVE_CLASS, on)
      link.setAttribute('aria-selected', on ? 'true' : 'false')
      link.setAttribute('tabindex', on ? '0' : '-1')
    })
    activeIndex = index
    fitPanels(index, true)
  }

  // rAF driver: switch the text when the playhead crosses a cue, and fill the active
  // tab's underline across the current segment. Ticker (not `timeupdate`, ~4×/s) keeps the
  // fill smooth through pause/resume / buffering.
  const tick = () => {
    if (!started || !video || reduceMotion.matches) return
    const t = video.currentTime
    const i = indexForTime(t)
    if (i !== activeIndex && !isAnimating) switchTab(i)
    // Fill the CURRENT segment's bar (i) — not activeIndex, which lags until the switch
    // animation completes, so the fill stays on the incoming tab through the transition.
    const bar = bars[i]
    if (bar) {
      const s = cueStart(i)
      const span = cueEnd(i) - s
      gsap.set(bar, { scaleX: span > 0 ? clamp01((t - s) / span) : 0 })
    }
  }

  // Fallback (no video): timer cycles the tabs and fills the active bar. Dwell = the
  // authored cue gap; else the text-scaled duration.
  function startTimer(index) {
    if (progressTween) progressTween.kill()
    setStaticFills(index)
    const bar = bars[index]
    if (!bar) return
    gsap.killTweensOf(bar) // drop a FILL_OUT still running on this bar
    gsap.set(bar, { scaleX: 0, transformOrigin: 'left center' })
    const gap = cueEnd(index) - cueStart(index)
    const dwell =
      isFinite(gap) && gap > 0 ? gap : autoplayDuration(panels[index])
    progressTween = gsap.to(bar, {
      scaleX: 1,
      duration: dwell,
      ease: 'none',
      overwrite: true,
      onComplete: () => {
        if (!isAnimating) {
          const next = (index + 1) % count
          switchTab(next)
          startTimer(next)
        }
      },
    })
    if (!gated()) progressTween.pause()
  }

  const goTo = (index) => {
    if (reduceMotion.matches) return switchTabInstant(index)
    if (video && started) {
      // Seek the playhead to the segment start; the ticker picks up the text + bar.
      try {
        video.currentTime = cueStart(index)
      } catch {
        /* not seekable yet */
      }
    }
    switchTab(index)
    if (!video && started) startTimer(index)
  }

  // Initial state: first tab visible, rest hidden (before paint, no CLS).
  links.forEach((link) => link.classList.remove(ACTIVE_CLASS))
  panels.forEach((panel) => panel.classList.remove(ACTIVE_CLASS))
  gsap.set(panels, { autoAlpha: 0 })
  gsap.set(panels[0], { autoAlpha: 1 })
  gsap.set(bars.filter(Boolean), { scaleX: 0, transformOrigin: 'left center' })
  links[0].classList.add(ACTIVE_CLASS)
  panels[0].classList.add(ACTIVE_CLASS)
  links.forEach((link, i) => {
    link.setAttribute('aria-selected', i === 0 ? 'true' : 'false')
    link.setAttribute('tabindex', i === 0 ? '0' : '-1')
  })
  activeIndex = 0

  fitPanels(0, true) // no collapse animation on load
  // Webfonts land after init and reflow the copy — re-measure once they're in.
  document.fonts?.ready.then(() => fitPanels(activeIndex, true))

  // Prep the shared video: muted + inline (autoplay-with-sound is blocked), LOOP on so it
  // wraps back to the first text.
  let onMeta = null
  if (video && !reduceMotion.matches) {
    video.muted = true
    video.loop = true
    video.playsInline = true
    video.setAttribute('playsinline', '')
    video.preload = 'auto'
    onMeta = () => resolveCues()
    video.addEventListener('loadedmetadata', onMeta)
    if (isFinite(video.duration) && video.duration > 0) resolveCues()
    gsap.ticker.add(tick)
  }

  // Click — seek to the tab's segment (or switch, in no-video/reduced-motion mode).
  const onClick = links.map((link, i) => {
    const handler = () => {
      if (i === activeIndex) return
      goTo(i)
    }
    link.addEventListener('click', handler)
    return handler
  })

  // Keyboard — arrow/Home/End move focus + activate; Enter/Space activate.
  const onKeydown = (e) => {
    const current = links.indexOf(document.activeElement)
    if (current === -1) return
    let next = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown')
      next = (current + 1) % count
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = (current - 1 + count) % count
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = count - 1
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      goTo(current)
      return
    } else return
    e.preventDefault()
    links[next].focus()
    goTo(next)
  }
  root.addEventListener('keydown', onKeydown)

  // Visibility + scroll-in start (no hover pause — the video keeps playing on hover).
  const onVisibility = () => sync()
  let io = null
  if (!reduceMotion.matches) {
    document.addEventListener('visibilitychange', onVisibility)
    io = new window.IntersectionObserver(
      (entries) => {
        onScreen = entries[0].isIntersecting
        if (onScreen && !started) {
          started = true
          resolveCues()
          revealContent(activeIndex)
          if (video) sync()
          else startTimer(activeIndex)
        } else {
          sync()
        }
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
  }

  return {
    // Column width decides how the copy wraps, so the active panel's height moves with it.
    refit() {
      fitPanels(activeIndex, true)
    },
    destroy() {
      if (progressTween) progressTween.kill()
      if (!reduceMotion.matches) gsap.ticker.remove(tick)
      if (video && !reduceMotion.matches) {
        if (onMeta) video.removeEventListener('loadedmetadata', onMeta)
        video.pause()
      }
      if (io) io.disconnect()
      root.removeEventListener('keydown', onKeydown)
      document.removeEventListener('visibilitychange', onVisibility)
      links.forEach((link, i) => link.removeEventListener('click', onClick[i]))
    },
  }
}

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='tabs-architected']
 */
export default function (elements) {
  if (!gsap) {
    console.warn('[tabs-architected] GSAP not found on window — skipping')
    return
  }

  const instances = elements.map(setupTabs).filter(Boolean)

  return {
    resize() {
      instances.forEach((instance) => instance.refit())
    },
  }
}
