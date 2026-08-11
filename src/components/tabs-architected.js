/*
  Component: tabs-architected · data-component="tabs-architected"
  ONE shared looping video behind multiple text tabs. The underline IS the clock: a pausable
  tween per tab whose dwell is that tab's authored cue gap (data-video-time, seconds); on
  completion the incoming text de-blurs in and the video is re-synced to the new cue. Plays
  muted+inline on scroll-in, loops, pauses off-screen / hidden tab. Hover never pauses it;
  clicking a tab LOCKS the cycle there with its underline full, until that tab is clicked
  again — the video keeps looping the locked tab's segment meanwhile.
  Below 767px the section becomes an accordion instead (no cycle) — see tabs-accordion.js.
  CSS → ./styles/tabs-architected.css (bundled via src/styles.js) · Docs → .claude/rules/components/tabs-architected.md
*/

import { REVEAL_FROM } from '../utils/word-reveal.js'
import {
  armFill,
  clearFill,
  fadeOutFill,
  lockFill,
} from '../utils/tab-underline.js'
import {
  ACCORDION_CLASS,
  createTabsAccordion,
} from '../utils/tabs-accordion.js'

const { gsap } = window

const ACTIVE_CLASS = 'is-active'
const LOCKED_CLASS = 'is-locked' // hook for CSS / the Designer — no rule ships with it
const CUE_ATTR = 'data-video-time' // seconds at which this tab's text becomes active

// Fallback autoplay dwell (only when a tab has no cue gap) — text-scaled.
const AUTOPLAY_BASE = 3.5
const AUTOPLAY_PER_WORD = 0.35
const AUTOPLAY_MIN = 4
const AUTOPLAY_MAX = 11
// Playhead slack. SEEK_SLACK: drift tolerated at a switch before the footage is re-synced —
// under it the video is left playing through untouched, so with nobody locking a tab
// nothing is ever seeked. SEG_SLACK: tolerance on the segment's lower edge (a seek lands a
// few ms short).
const SEEK_SLACK = 0.25
const SEG_SLACK = 0.05

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

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

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
  let lockedIndex = -1 // >= 0 → the user clicked this tab and the cycle holds on it
  let accordion = null // mobile drawers (≤767px); while active there is no cycle at all
  let accordionOpen = -1 // which drawer is open, -1 = all collapsed (accordion mode only)
  let progressTl = null // the active tab's progress clock
  let dwellUsed = 0 // seconds the running clock was built with
  // Set the instant a tab takes over, unlike activeIndex which lags until the switch
  // animation completes — the playhead has to be held against the incoming segment at once.
  let segIndex = 0

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

  const playVideo = () => {
    if (!video) return
    const p = video.play()
    if (p && typeof p.catch === 'function') p.catch(() => {})
  }
  const seek = (t) => {
    if (!video) return
    try {
      video.currentTime = t
    } catch {
      /* not seekable yet */
    }
  }

  // Off-screen / hidden tab pause everything. A LOCKED tab pauses only the underline clock:
  // the video keeps looping its segment (holdSegment), so the visual never freezes on the
  // tab the user chose to hold.
  const isLocked = () => lockedIndex >= 0
  // Read off the root, not off the handle: the first enable runs inside createTabsAccordion,
  // while `accordion` here is still null (see ACCORDION_CLASS).
  const inAccordion = () => root.classList.contains(ACCORDION_CLASS)
  const visible = () => started && onScreen && !document.hidden
  const sync = () => {
    // In accordion mode there is no clock, and the video lives inside the open drawer — so
    // with every drawer collapsed there is nothing to play.
    const on = visible() && (!inAccordion() || accordionOpen >= 0)
    if (video) on ? playVideo() : video.pause()
    if (progressTl) on && !isLocked() ? progressTl.resume() : progressTl.pause()
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

  // Active-only fills: every non-active tab's bar fades out where it stands (see
  // tab-underline.js).
  const setStaticFills = (index) => {
    bars.forEach((bar, k) => k !== index && fadeOutFill(bar))
  }

  // Collapse the text column onto the active panel, so a short tab doesn't drag the tallest
  // tab's leftover height around with it. Measured off the DOM (the CSS `align-items: start`
  // keeps each stacked panel at its own content height, so a stretched grid item can't
  // report the row height back) rather than counting lines — line-height math is unreliable
  // in rich text. `immediate` skips the tween on load / resize, where there's no switch to
  // ride. (compouding had the same thing and dropped it — this section still wants it.)
  const fitPanels = (index, immediate) => {
    // In accordion mode the panels live in the drawers, so the column is empty and whatever
    // a panel measures there says nothing about it.
    if (inAccordion() || !textWrap || !panels[index]) return
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

    fitPanels(index) // the bars + the clock are startProgress's, called right after this

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

  // rAF: the playhead is slaved to the active tab. While the underline clock is paused (a
  // locked tab) the video would otherwise run on into the next tab's footage — or wrap to 0
  // on the last tab — so it loops the active segment instead. Nothing to do while the clock
  // runs: the tween owns the switch and the playhead is already in step with it.
  const holdSegment = () => {
    if (!started || !video || reduceMotion.matches) return
    // Hold whenever the clock isn't running the switch itself: a locked tab, or accordion
    // mode, where there is no clock at all and the open drawer owns the segment.
    if (!inAccordion() && (!progressTl || !progressTl.paused())) return
    const s = cueStart(segIndex)
    const e = cueEnd(segIndex)
    if (!(e > s)) return // last tab before metadata lands: span still unknown
    const t = video.currentTime
    if (t < s - SEG_SLACK || t >= e) seek(s)
  }

  // The underline IS the clock: the active bar grows floor→1 over that tab's dwell (the
  // authored cue gap, else the text-scaled duration) and its completion advances the tab.
  // Being a tween is the point — it can be paused by a lock while the video plays on, which
  // reading the playhead every frame could never do.
  function startProgress(index) {
    if (progressTl) progressTl.kill()
    segIndex = index
    setStaticFills(index)
    const bar = bars[index]
    if (bar) armFill(bar) // drop a FILL_OUT still fading this bar out
    const gap = cueEnd(index) - cueStart(index)
    dwellUsed = isFinite(gap) && gap > 0 ? gap : autoplayDuration(panels[index])
    // A timeline rather than a bare tween on the bar, so the clock still exists on a tab
    // whose underline is missing from the markup — the bar is optional, advancing isn't.
    progressTl = gsap.timeline({
      onComplete: () => {
        if (isAnimating) return
        const next = (index + 1) % count
        switchTab(next)
        startProgress(next)
      },
    })
    if (bar)
      progressTl.to(bar, { scaleX: 1, duration: dwellUsed, ease: 'none' }, 0)
    else progressTl.to({}, { duration: dwellUsed }, 0)
    sync()
  }

  // Re-sync the footage to the tab it belongs to — but only once it has actually drifted,
  // which only a lock can cause. Unlocked, the playhead is already at the cue, so the video
  // is never seeked and plays through as one continuous shot. A seek that IS needed lands
  // here, hidden under the text transition, instead of out in the open.
  const syncPlayhead = (index) => {
    if (!video) return
    const target = cueStart(index)
    if (Math.abs(video.currentTime - target) > SEEK_SLACK) seek(target)
  }

  const goTo = (index) => {
    if (reduceMotion.matches) return switchTabInstant(index)
    // Dropped mid-transition on purpose: switchTab guards itself on isAnimating, so without
    // this the clock and the playhead would move to a tab whose panel switch was skipped —
    // bar on one tab, panel on another. The transition is ~1s.
    if (isAnimating) return
    if (started) syncPlayhead(index)
    switchTab(index)
    if (started) startProgress(index)
  }

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
    sync() // the video keeps playing — holdSegment loops it inside this tab's segment
  }
  // Release: rebuild the clock from this tab (armFill resets the bar to its visible floor).
  // The playhead is deliberately NOT seeked — it's already inside the right segment, and the
  // next switch re-syncs it under the text transition rather than jump-cutting here.
  const unlock = () => {
    const index = lockedIndex
    lockedIndex = -1
    markLocked()
    started ? startProgress(index) : sync()
  }

  // Click / keyboard: jump to that tab AND lock it; activating the locked tab releases it.
  // Bails while a switch is animating, so a dropped switch can't leave the bar locked on one
  // tab and the panel on another.
  const activateTab = (index) => {
    // Accordion mode: the drawer header owns the interaction. A tap landing on the link
    // inside it bubbles here, so this has to stand down.
    if (inAccordion()) return
    if (reduceMotion.matches) return switchTabInstant(index)
    if (isAnimating) return
    if (lockedIndex === index) return unlock()
    if (index !== activeIndex) goTo(index)
    lock(index)
  }

  // The stacked-tabs state from scratch: one tab visible, the rest hidden (before paint, no
  // CLS). Used on load, and again when the accordion hands the section back on the way up.
  const resetToTab = (index) => {
    activeIndex = index
    segIndex = index
    isAnimating = false
    gsap.killTweensOf(panels)
    links.forEach((link, i) => {
      const on = i === index
      link.classList.toggle(ACTIVE_CLASS, on)
      link.setAttribute('aria-selected', on ? 'true' : 'false')
      link.setAttribute('tabindex', on ? '0' : '-1')
    })
    panels.forEach((panel, i) => {
      const on = i === index
      panel.classList.toggle(ACTIVE_CLASS, on)
      gsap.set(panel, { autoAlpha: on ? 1 : 0 })
    })
    gsap.set(panels, { clearProps: 'zIndex' })
    fitPanels(index, true) // no collapse animation on load
  }

  gsap.set(bars.filter(Boolean), { scaleX: 0, transformOrigin: 'left center' })
  resetToTab(0)
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
    onMeta = () => {
      resolveCues()
      // The last tab's cue gap needs the duration, and an unauthored cue set needs it for all
      // of them — so if metadata lands after autoplay started, re-run the active tab on the
      // corrected dwell instead of letting it finish on the placeholder gap. Never while
      // locked: there's no running clock to correct, and re-running would reset the full bar.
      const gap = cueEnd(segIndex) - cueStart(segIndex)
      if (
        started &&
        !isLocked() &&
        !inAccordion() && // no clock to correct in accordion mode
        isFinite(gap) &&
        Math.abs(gap - dwellUsed) > SEEK_SLACK
      )
        startProgress(segIndex)
    }
    video.addEventListener('loadedmetadata', onMeta)
    if (isFinite(video.duration) && video.duration > 0) resolveCues()
    gsap.ticker.add(holdSegment)
  }

  // ---- Mobile accordion (≤767px) ----
  // Drawers instead of tabs: every text block sits in its own drawer, so there is nothing for
  // a cycle to switch between. The clock is dropped entirely and the section's ONE shared
  // video is MOVED into whichever drawer is open, looping that tab's own segment
  // (holdSegment) — the same idea as a permanent lock, minus the bar to fill.
  accordion = createTabsAccordion({
    root,
    name: 'tabs-architected',
    links,
    bodies: panels.map((panel) => [panel]),
    // The wrapper, not the <video>: the Designer's video box has to travel with it.
    shared: videoHook || video,
    anchor: root.querySelector('.tabs-architected_tabs-links'),
    onEnable() {
      progressTl?.kill()
      progressTl = null
      lockedIndex = -1
      markLocked()
      isAnimating = false
      // Drop everything the stacked layout wrote: the panels are visible inside their own
      // drawers now, and a switch caught mid-flight would otherwise strand content blurred.
      gsap.killTweensOf(panels)
      gsap.set(panels, { clearProps: 'opacity,visibility,zIndex' })
      parts.forEach(({ content }) => {
        gsap.killTweensOf(content)
        gsap.set(content, {
          clearProps: 'opacity,visibility,filter,transform,willChange',
        })
      })
      if (textWrap) gsap.set(textWrap, { clearProps: 'height' })
      bars.forEach((bar) => clearFill(bar)) // the drawer's hairline is the state indicator
    },
    onOpen(index) {
      accordionOpen = index
      activeIndex = index
      segIndex = index
      links.forEach((link, i) =>
        link.classList.toggle(ACTIVE_CLASS, i === index)
      )
      panels.forEach((panel, i) =>
        panel.classList.toggle(ACTIVE_CLASS, i === index)
      )
      seek(cueStart(index)) // holdSegment keeps it there; a pre-metadata seek no-ops
      sync()
    },
    onClose(index) {
      if (accordionOpen === index) accordionOpen = -1
      sync() // nothing open → nothing to play
    },
    onDisable(wasOpen) {
      accordionOpen = -1
      resetToTab(wasOpen >= 0 ? wasOpen : 0)
      if (started) startProgress(activeIndex)
    },
  })

  // Click — switch to that tab's segment and lock the cycle on it (second click releases).
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

  // Visibility + scroll-in start.
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
          // Accordion mode has no cycle to start — sync() just lets the open drawer's video
          // run now that the section is on screen.
          if (inAccordion()) return sync()
          // A tab clicked before the section was ever reached is already locked — build its
          // clock and re-apply the lock, so it holds instead of starting to cycle.
          const first = isLocked() ? lockedIndex : activeIndex
          revealContent(first)
          // The first tab never goes through switchTab, so this is what arms its bar and
          // starts its clock.
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
    // Column width decides how the copy wraps, so the active panel's height moves with it.
    refit() {
      fitPanels(activeIndex, true)
    },
    destroy() {
      if (progressTl) progressTl.kill()
      accordion?.destroy()
      if (!reduceMotion.matches) gsap.ticker.remove(holdSegment)
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
