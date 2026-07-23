/*
  Component: tabs-imaging · data-component="tabs-imaging"
  Autoplay tabs — the active tab's dwell = its own VIDEO's duration (advances on the
  video's `ended`); the underline tracks the video playhead. Tabs with no video fall back
  to a text-scaled timer. On switch the incoming image wipes open (clip-path) while its
  content de-blurs in. Starts on scroll-in, pauses on hover, restarts from the clicked tab.
  Click / keyboard also switch.
  CSS → ./styles/tabs-imaging.css (paste into Webflow head) · Docs → .claude/rules/components/tabs-imaging.md
*/

import { REVEAL_FROM } from '../utils/word-reveal.js'

const { gsap } = window

const ACTIVE_CLASS = 'is-active'
// Fallback autoplay dwell (tabs with no video) — scales with the tab's text length.
const AUTOPLAY_BASE = 3.5 // seconds baseline per tab
const AUTOPLAY_PER_WORD = 0.35 // extra seconds per word of the panel's text
const AUTOPLAY_MIN = 4 // floor (also keeps it ≥ the reveal)
const AUTOPLAY_MAX = 11 // ceiling

// Image: vertical clip-path wipe (top→bottom). Flip the inset() sides to reverse.
const IMG_CLIP_HIDDEN = 'inset(0% 0% 100% 0%)' // clipped from the bottom
const IMG_CLIP_SHOWN = 'inset(0% 0% 0% 0%)' // fully revealed
const IMG_REVEAL = { duration: 1.1, ease: 'power3.inOut' }
// Content blocks de-blur + fade + rise (REVEAL_FROM = shared paradigm/hero start state).
const CONTENT_TO = {
  autoAlpha: 1,
  filter: 'blur(0px)',
  yPercent: 0,
  duration: 0.9,
  stagger: 0.1,
  ease: 'sine.out',
}
// Outgoing panel just fades out underneath the incoming reveal.
const OUT_FADE = { autoAlpha: 0, duration: 0.4, ease: 'power2.out' }

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

// Per-tab autoplay seconds from its panel's word count.
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
    root.querySelectorAll('[tabs-imaging="link"]')
  )
  const panels = gsap.utils.toArray(
    root.querySelectorAll('.tabs-imaging_tab-item')
  )

  // Need at least two link/panel pairs to do anything useful.
  if (links.length < 2 || panels.length < 2) {
    console.warn('[tabs-imaging] need >= 2 links and panels — skipping')
    return null
  }

  const count = Math.min(links.length, panels.length)

  // Inject a black fill into each underline + expand the rail (is-track). Active-only
  // (see setStaticFills): only the active tab's fill shows, every other tab stays empty
  // (inactive). Reduced motion skips track/fill (CSS shows the active underline).
  const bars = links.map((link) => {
    const track = link.querySelector('.tabs-imaging_tab-link-underline')
    if (!track || reduceMotion.matches) return null
    const fill = document.createElement('span')
    fill.className = 'tabs-imaging_tab-link-fill'
    track.appendChild(fill)
    track.classList.add('is-track')
    return fill
  })

  // Animatable parts per panel: the image wrapper (clip wipe) + content blocks (de-blur)
  // + the tab's video (drives the dwell).
  const parts = panels.map((panel) => ({
    image: panel.querySelector('[tabs-imaging="image"]'),
    content: gsap.utils.toArray(
      panel.querySelector(
        '[tabs-imaging="text-content"] .tabs-imaging_tab-content-inner'
      )?.children || panel.querySelectorAll('[tabs-imaging="text-content"] > *')
    ),
    video:
      panel.querySelector('video.tabs-imaging_tab-image') ||
      panel.querySelector('[tabs-imaging="image"] video') ||
      panel.querySelector('video'),
  }))

  let activeIndex = -1
  let isAnimating = false
  let progressTween = null // fallback timer (tabs with no video)
  let activeVideo = null
  let activeBar = null
  let started = false // autoplay kicked off (section reached)
  let hover = false
  let onScreen = false

  // Prep each tab video: muted inline autoplay (autoplay-with-sound is blocked, so the
  // video would never play and the tab would never advance), no loop so `ended` fires →
  // advance. The tab's dwell = the video's own duration.
  const endedHandlers = []
  parts.forEach((part, i) => {
    const v = part.video
    if (!v) return
    v.muted = true
    v.loop = false
    v.playsInline = true
    v.setAttribute('playsinline', '')
    v.preload = 'auto'
    const onEnded = () => {
      if (i === activeIndex && !isAnimating && !reduceMotion.matches) {
        switchTab((i + 1) % count)
      }
    }
    v.addEventListener('ended', onEnded)
    endedHandlers[i] = onEnded
  })

  // Underline fill tracks the active video's playhead — smooth + always in sync (a fixed
  // tween would drift from the video under pause/resume + buffering).
  const tickBar = () => {
    if (!activeVideo || !activeBar) return
    const d = activeVideo.duration
    if (isFinite(d) && d > 0) {
      gsap.set(activeBar, { scaleX: Math.min(1, activeVideo.currentTime / d) })
    }
  }
  if (!reduceMotion.matches) gsap.ticker.add(tickBar)

  const playVideo = (v) => {
    const p = v.play()
    if (p && typeof p.catch === 'function') p.catch(() => {})
  }

  // Accessibility scaffolding — tablist / tab / tabpanel with roving tabindex.
  root
    .querySelector('.tabs-imaging_tabs-links')
    ?.setAttribute('role', 'tablist')
  links.forEach((link, i) => {
    const panel = panels[i]
    const linkId = link.id || `tabs-imaging-tab-${i}`
    const panelId = panel.id || `tabs-imaging-panel-${i}`
    link.id = linkId
    panel.id = panelId
    link.setAttribute('role', 'tab')
    link.setAttribute('aria-controls', panelId)
    link.setAttribute('tabindex', '-1')
    panel.setAttribute('role', 'tabpanel')
    panel.setAttribute('aria-labelledby', linkId)
  })

  // Active-only fills: every non-active tab stays empty (inactive); the active one is
  // animated separately (tracks the video playhead). Only the active tab carries a fill.
  const setStaticFills = (index) => {
    bars.forEach((bar, k) => {
      if (!bar || k === index) return
      gsap.set(bar, {
        scaleX: 0,
        transformOrigin: 'left center',
      })
    })
  }

  // Pause/resume the active clock (video, else the fallback tween) from on-screen +
  // not-hovered + tab-visible.
  const sync = () => {
    const play = started && onScreen && !hover && !document.hidden
    if (activeVideo) {
      play ? playVideo(activeVideo) : activeVideo.pause()
    } else if (progressTween) {
      play ? progressTween.resume() : progressTween.pause()
    }
  }

  // Start the active tab's dwell: video-driven when the tab has one (advance on `ended`,
  // bar tracks the playhead), else the text-scaled fallback timer.
  function startProgress(index) {
    if (progressTween) {
      progressTween.kill()
      progressTween = null
    }
    setStaticFills(index)
    if (reduceMotion.matches) return

    const bar = bars[index]
    const video = parts[index].video
    activeVideo = video || null
    activeBar = bar || null

    if (video) {
      if (bar) gsap.set(bar, { scaleX: 0, transformOrigin: 'left center' })
      try {
        video.currentTime = 0
      } catch {
        /* not seekable yet — plays from 0 anyway */
      }
      sync() // plays now if on-screen + not hovered
      return
    }

    // No video → text-scaled timer (advance on complete).
    if (!bar) return
    gsap.set(bar, { scaleX: 0, transformOrigin: 'left center' })
    progressTween = gsap.to(bar, {
      scaleX: 1,
      duration: autoplayDuration(panels[index]),
      ease: 'none',
      onComplete: () => {
        if (!isAnimating) switchTab((index + 1) % count)
      },
    })
    sync()
  }

  function switchTab(index) {
    if (isAnimating || index === activeIndex) return
    isAnimating = true

    const outLink = links[activeIndex]
    const outPanel = panels[activeIndex]
    const inLink = links[index]
    const inPanel = panels[index]

    // Stop the outgoing video so only the active one ever plays.
    parts[activeIndex]?.video?.pause()

    // ARIA + active-class state flip
    outLink?.classList.remove(ACTIVE_CLASS)
    outPanel?.classList.remove(ACTIVE_CLASS)
    outLink?.setAttribute('aria-selected', 'false')
    outLink?.setAttribute('tabindex', '-1')
    inLink.classList.add(ACTIVE_CLASS)
    inPanel.classList.add(ACTIVE_CLASS)
    inLink.setAttribute('aria-selected', 'true')
    inLink.setAttribute('tabindex', '0')

    // Start the fill immediately (in parallel with the reveal). Always create the tween
    // — even when hovered — so a click while the cursor is over the section still leaves
    // a live tween to resume on mouseleave; sync() pauses it right away if needed.
    if (started) startProgress(index)

    const inParts = parts[index]

    // Incoming overlays the outgoing (z-index) regardless of DOM order; the panel shows
    // instantly, its image + content animate in.
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

    // Image wipes open vertically; content blocks de-blur in, slightly after.
    const at = outPanel ? 0.15 : 0
    if (inParts.image) {
      tl.fromTo(
        inParts.image,
        { clipPath: IMG_CLIP_HIDDEN },
        { clipPath: IMG_CLIP_SHOWN, ...IMG_REVEAL },
        at
      )
    }
    if (inParts.content.length) {
      tl.fromTo(inParts.content, REVEAL_FROM, CONTENT_TO, at + 0.1)
    }
  }

  // Reduced motion: no crossfade, no autoplay. Panels toggle instantly via autoAlpha;
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
  }

  const goTo = (index) =>
    reduceMotion.matches ? switchTabInstant(index) : switchTab(index)

  // Initial state: first tab visible, rest hidden (before paint, no CLS). Fills start
  // empty; the active underline fills once autoplay starts (on scroll-in).
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

  // Click — switch and (re)start the autoplay cycle from there.
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

  // Hover pause / resume + tab-visibility gating (skipped under reduced motion).
  const onEnter = () => {
    hover = true
    sync()
  }
  const onLeave = () => {
    hover = false
    sync()
  }
  const onVisibility = () => sync()
  let io = null
  if (!reduceMotion.matches) {
    root.addEventListener('mouseenter', onEnter)
    root.addEventListener('mouseleave', onLeave)
    document.addEventListener('visibilitychange', onVisibility)
    // Autoplay starts when the section enters the viewport; pauses while off-screen.
    io = new window.IntersectionObserver(
      (entries) => {
        onScreen = entries[0].isIntersecting
        if (onScreen && !started) {
          started = true
          startProgress(activeIndex)
        } else {
          sync()
        }
      },
      { threshold: 0.4 }
    )
    io.observe(root)
  }

  return {
    destroy() {
      if (progressTween) progressTween.kill()
      if (!reduceMotion.matches) gsap.ticker.remove(tickBar)
      parts.forEach((part, i) => {
        if (part.video && endedHandlers[i]) {
          part.video.removeEventListener('ended', endedHandlers[i])
          part.video.pause()
        }
      })
      if (io) io.disconnect()
      root.removeEventListener('keydown', onKeydown)
      root.removeEventListener('mouseenter', onEnter)
      root.removeEventListener('mouseleave', onLeave)
      document.removeEventListener('visibilitychange', onVisibility)
      links.forEach((link, i) => link.removeEventListener('click', onClick[i]))
    },
  }
}

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='tabs-imaging']
 */
export default function (elements) {
  if (!gsap) {
    console.warn('[tabs-imaging] GSAP not found on window — skipping')
    return
  }

  elements.map(setupTabs).filter(Boolean)
}
