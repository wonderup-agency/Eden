/*
  Component: tabs-foundation-model · data-component="tabs-foundation-model"
  Autoplay tabs — only the active link's underline fills as a progress bar over a
  text-scaled dwell (others stay empty/inactive), then advances; on switch the incoming image wipes
  open (clip-path) while its content de-blurs in. A panel holding a <video> loops it while
  that tab is active. Starts on scroll-in; hover never pauses it. Clicking a tab LOCKS the
  cycle there with its underline full, until that tab is clicked again.
  CSS → ./styles/tabs-foundation-model.css (bundled via src/styles.js) · Docs → .claude/rules/components/tabs-foundation-model.md
*/

import { REVEAL_FROM } from '../utils/word-reveal.js'
import { armFill, clearFill, lockFill } from '../utils/tab-underline.js'

const { gsap } = window

const ACTIVE_CLASS = 'is-active'
const LOCKED_CLASS = 'is-locked' // hook for CSS / the Designer — no rule ships with it
// Autoplay dwell scales with the tab's text length (more words → longer).
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
    root.querySelectorAll('[tabs-foundation-model="link"]')
  )
  const panels = gsap.utils.toArray(
    root.querySelectorAll('.tabs-foundation-model_tab-item')
  )

  // Need at least two link/panel pairs to do anything useful.
  if (links.length < 2 || panels.length < 2) {
    console.warn(
      '[tabs-foundation-model] need >= 2 links and panels — skipping'
    )
    return null
  }

  const count = Math.min(links.length, panels.length)

  // Inject a black fill into each underline + expand the rail (is-track). Active-only
  // (see setStaticFills): only the active tab's fill shows, every other tab stays empty
  // (inactive). Reduced motion skips track/fill (CSS shows the active underline).
  const bars = links.map((link) => {
    const track = link.querySelector(
      '.tabs-foundation-model_tab-link-underline'
    )
    if (!track || reduceMotion.matches) return null
    const fill = document.createElement('span')
    fill.className = 'tabs-foundation-model_tab-link-fill'
    track.appendChild(fill)
    track.classList.add('is-track')
    return fill
  })

  // Animatable parts per panel: the image wrapper (clip wipe) + content blocks (de-blur)
  // + the panel's video, if it has one (plays while the tab is active).
  const parts = panels.map((panel) => ({
    image: panel.querySelector('[tabs-foundation-model="image"]'),
    content: gsap.utils.toArray(
      panel.querySelector(
        '[tabs-foundation-model="text-content"] .tabs-foundation-model_tab-content-inner'
      )?.children ||
        panel.querySelectorAll('[tabs-foundation-model="text-content"] > *')
    ),
    video:
      panel.querySelector('video.tabs-foundation-model_tab-image') ||
      panel.querySelector('[tabs-foundation-model="image"] video') ||
      panel.querySelector('video'),
  }))

  let activeIndex = -1
  let isAnimating = false
  let progressTl = null // the active tab's progress clock
  let activeVideo = null
  let started = false // autoplay kicked off (section reached)
  let lockedIndex = -1 // >= 0 → the user clicked this tab and the cycle holds on it
  let onScreen = false

  // Prep each panel video: muted + inline (autoplay-with-sound is blocked, so it would
  // never play), LOOP on — the dwell is text-scaled, not video-length, so a shorter video
  // has to keep going until the tab advances (and forever while it's locked). The Webflow
  // `autoplay` attribute is dropped: playback is owned here (starts on scroll-in, follows
  // the active tab), otherwise every hidden panel's video would run from load.
  parts.forEach((part) => {
    const v = part.video
    if (!v) return
    v.muted = true
    v.loop = true
    v.playsInline = true
    v.setAttribute('playsinline', '')
    v.preload = 'auto'
    v.autoplay = false
    v.removeAttribute('autoplay')
    v.pause()
  })

  const playVideo = (v) => {
    const p = v.play()
    if (p && typeof p.catch === 'function') p.catch(() => {})
  }

  // Accessibility scaffolding — tablist / tab / tabpanel with roving tabindex.
  root
    .querySelector('.tabs-foundation-model_tabs-links')
    ?.setAttribute('role', 'tablist')
  links.forEach((link, i) => {
    const panel = panels[i]
    const linkId = link.id || `tabs-foundation-model-tab-${i}`
    const panelId = panel.id || `tabs-foundation-model-panel-${i}`
    link.id = linkId
    panel.id = panelId
    link.setAttribute('role', 'tab')
    link.setAttribute('aria-controls', panelId)
    link.setAttribute('tabindex', '-1')
    panel.setAttribute('role', 'tabpanel')
    panel.setAttribute('aria-labelledby', linkId)
  })

  // Active-only fills: every non-active tab stays empty (inactive); the active one is
  // animated separately. Only the active tab carries a filled underline.
  const setStaticFills = (index) => {
    bars.forEach((bar, k) => k !== index && clearFill(bar))
  }

  // Off-screen / hidden tab pause everything. A LOCKED tab pauses only the underline clock:
  // its video keeps looping (video.loop), so the panel never freezes on the tab the user
  // chose to hold.
  const isLocked = () => lockedIndex >= 0
  const sync = () => {
    const on = started && onScreen && !document.hidden
    if (activeVideo) on ? playVideo(activeVideo) : activeVideo.pause()
    if (progressTl) on && !isLocked() ? progressTl.resume() : progressTl.pause()
  }

  // The underline IS the clock: the active bar grows floor→1 over that tab's text-scaled
  // dwell and its completion advances the tab. The panel's video (if any) restarts with it
  // and loops until the tab changes.
  function startProgress(index) {
    if (progressTl) {
      progressTl.kill()
      progressTl = null
    }
    setStaticFills(index)
    if (reduceMotion.matches) return

    activeVideo = parts[index].video || null
    if (activeVideo) {
      try {
        activeVideo.currentTime = 0
      } catch {
        /* not seekable yet — plays from 0 anyway */
      }
    }

    const bar = bars[index]
    if (bar) armFill(bar) // starts at the visible floor, not 0
    const dwell = autoplayDuration(panels[index])
    // A timeline rather than a bare tween on the bar, so the clock still exists on a tab
    // whose underline is missing from the markup — the bar is optional, advancing isn't.
    progressTl = gsap.timeline({
      onComplete: () => {
        if (!isAnimating) switchTab((index + 1) % count)
      },
    })
    if (bar) progressTl.to(bar, { scaleX: 1, duration: dwell, ease: 'none' }, 0)
    else progressTl.to({}, { duration: dwell }, 0)
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

    // Start the fill immediately (in parallel with the reveal); sync() pauses it right away
    // if the section is off-screen.
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

  // Click-to-lock: the cycle holds on the clicked tab, its underline full. Pause the clock
  // BEFORE filling the bar — lockFill overwrites the timeline's own bar tween, and a
  // timeline emptied while still playing fires onComplete on the next tick.
  const markLocked = () => {
    root.classList.toggle(LOCKED_CLASS, isLocked())
    links.forEach((l, k) => l.classList.toggle(LOCKED_CLASS, k === lockedIndex))
  }
  const lock = (index) => {
    lockedIndex = index
    progressTl?.pause()
    markLocked()
    lockFill(bars[index])
    sync() // the panel's video keeps looping
  }
  // Release: rebuild the clock from this tab (armFill resets the bar to its visible floor,
  // startProgress restarts the video from 0).
  const unlock = () => {
    const index = lockedIndex
    lockedIndex = -1
    markLocked()
    started ? startProgress(index) : sync()
  }

  // Click / keyboard: switch to that tab AND lock it; activating the locked tab releases it.
  // Bails while a switch is animating, so a dropped switch can't leave the bar locked on one
  // tab and the panel on another.
  const activateTab = (index) => {
    if (reduceMotion.matches) return switchTabInstant(index)
    if (isAnimating) return
    if (lockedIndex === index) return unlock()
    if (index !== activeIndex) goTo(index)
    lock(index)
  }

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

  // Click — switch to that tab and lock the cycle on it (a second click releases it).
  const onClick = links.map((link, i) => {
    const handler = () => activateTab(i)
    link.addEventListener('click', handler)
    return handler
  })

  // Keyboard — arrow/Home/End move focus + activate; Enter/Space activate. Every explicit
  // activation locks, same as a click.
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
      activateTab(current)
      return
    } else return
    e.preventDefault()
    links[next].focus()
    activateTab(next)
  }
  root.addEventListener('keydown', onKeydown)

  // Tab-visibility gating (skipped under reduced motion).
  const onVisibility = () => sync()
  let io = null
  if (!reduceMotion.matches) {
    document.addEventListener('visibilitychange', onVisibility)
    // Autoplay starts when the section enters the viewport; pauses while off-screen.
    io = new window.IntersectionObserver(
      (entries) => {
        onScreen = entries[0].isIntersecting
        if (onScreen && !started) {
          started = true
          // A tab clicked before the section was ever reached is already locked — build its
          // clock and re-apply the lock, so it holds instead of starting to cycle.
          const first = isLocked() ? lockedIndex : activeIndex
          startProgress(first)
          if (isLocked()) lock(first)
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
    destroy() {
      if (progressTl) progressTl.kill()
      parts.forEach((part) => part.video?.pause())
      if (io) io.disconnect()
      root.removeEventListener('keydown', onKeydown)
      document.removeEventListener('visibilitychange', onVisibility)
      links.forEach((link, i) => link.removeEventListener('click', onClick[i]))
    },
  }
}

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='tabs-foundation-model']
 */
export default function (elements) {
  if (!gsap) {
    console.warn('[tabs-foundation-model] GSAP not found on window — skipping')
    return
  }

  elements.map(setupTabs).filter(Boolean)
}
