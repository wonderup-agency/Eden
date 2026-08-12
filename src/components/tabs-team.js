/*
  Component: tabs-team · data-component="tabs-team"
  Autoplay text tabs with ONE photo per tab. Same chrome as tabs-architected (the underline IS
  the clock, click-to-lock, mobile accordion), but the visual is a stack of photos that
  crossfade — so the dwell is the panel's READING TIME (words ÷ READ_WPM), not a video cue gap.
  CSS → ./styles/tabs-team.css (bundled via src/styles.js) · Docs → .claude/rules/components/tabs-team.md
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
// Per-tab override in seconds (escape hatch). Deliberately NOT data-tabs-team-dwell — it's
// typed by hand in the Designer and nothing else on the site claims the name.
const DWELL_ATTR = 'data-team-dwell'

// Dwell = reading time. Words ÷ READ_WPM is the reading itself; READ_BASE covers the switch
// (the de-blur runs ~0.9s) plus the beat before the eye starts on the new copy. Clamped so a
// one-line tab still holds long enough to be read and a long one doesn't stall the cycle.
// READ_MAX is deliberately above the real copy's dwell (a ~56-word bio lands at ~16s): a cap
// the normal case hits would flatten every tab to the same number and the scaling would do
// nothing. It's an outlier guard, not the timing.
const READ_WPM = 240
const READ_BASE = 2
const READ_MIN = 4
const READ_MAX = 18

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
// Text column collapses onto the active panel — matched to CONTENT_TO so the resize and the
// de-blur read as one motion, not two.
const FIT_TWEEN = { duration: 0.9, ease: 'sine.out' }
// Image crossfade: the incoming photo fades in ON TOP and the outgoing is snapped off once
// it's fully covered. Fading both at once dips the combined opacity mid-way (the classic
// crossfade hole); this can't, because the two share the same box.
const IMG_FADE = { duration: 0.8, ease: 'power2.inOut' }

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

// Reading time for one text block, in seconds.
function readingTime(el) {
  const words = (el?.textContent || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
  const d = READ_BASE + (words / READ_WPM) * 60
  return Math.min(READ_MAX, Math.max(READ_MIN, d))
}

// Wire one tabs root. Returns { refit, destroy }, or null if the markup is incomplete.
function setupTabs(root) {
  const links = gsap.utils.toArray(root.querySelectorAll('[tabs-team="link"]'))
  // Text panels = the stacked content blocks (one per tab), paired to the links by index.
  const panels = gsap.utils.toArray(
    root.querySelectorAll('.tabs-team_tab-content-inner')
  )
  // One photo per tab, paired by index — the hook sits on the <img> itself. Optional: with
  // none, the section is a plain text cycle and everything else still works. The container
  // (.tabs-team_image-wrapper) is only the CSS's business, so it is never resolved here.
  const images = gsap.utils.toArray(
    root.querySelectorAll('[tabs-team="image"]')
  )

  // Need at least two link/panel pairs to do anything useful.
  if (links.length < 2 || panels.length < 2) {
    console.warn('[tabs-team] need >= 2 links and panels — skipping')
    return null
  }

  const count = Math.min(links.length, panels.length)
  if (images.length && images.length < count)
    console.warn(
      `[tabs-team] ${count} tabs but ${images.length} images — the extra tabs keep the last one`
    )

  // Enhanced flag — gates the CSS stacking (text blocks AND images) so they only overlap once
  // the bundle runs. With no JS they stay in normal flow, readable and crawlable.
  root.classList.add('is-enhanced')

  // The stacked text column — its height is tweened onto the active panel (see fitPanels).
  const textWrap = root.querySelector('[tabs-team="text-content"]')

  // Turn each underline into a grey TRACK + inject a black FILL child that scales 0→1.
  // Active-only: only the active tab's fill shows. Reduced motion skips track/fill.
  const bars = links.map((link) => {
    const track = link.querySelector('.tabs-team_tab-link-underline')
    if (!track || reduceMotion.matches) return null
    const fill = document.createElement('span')
    fill.className = 'tabs-team_tab-link-fill'
    track.appendChild(fill)
    track.classList.add('is-track')
    return fill
  })

  // Each panel's direct children (heading, paragraph, button) de-blur in, staggered.
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

  // Dwell: the panel's reading time, unless the tab authors an explicit override.
  const dwellFor = (i) => {
    const raw = parseFloat(
      links[i]?.getAttribute(DWELL_ATTR) ?? panels[i]?.getAttribute(DWELL_ATTR)
    )
    return isFinite(raw) && raw > 0 ? raw : readingTime(panels[i])
  }

  // Off-screen / hidden tab / a locked tab all pause the clock. Nothing else does — hover is
  // not a control.
  const isLocked = () => lockedIndex >= 0
  // Read off the root, not off the handle: the first enable runs inside createTabsAccordion,
  // while `accordion` here is still null (see ACCORDION_CLASS).
  const inAccordion = () => root.classList.contains(ACCORDION_CLASS)
  const visible = () => started && onScreen && !document.hidden
  const sync = () => {
    if (!progressTl) return
    visible() && !isLocked() && !inAccordion()
      ? progressTl.resume()
      : progressTl.pause()
  }

  // Accessibility scaffolding — tablist / tab / tabpanel with roving tabindex.
  root.querySelector('.tabs-team_tabs-links')?.setAttribute('role', 'tablist')
  links.forEach((link, i) => {
    const panel = panels[i]
    const linkId = link.id || `tabs-team-tab-${i}`
    const panelId = panel.id || `tabs-team-panel-${i}`
    link.id = linkId
    panel.id = panelId
    link.setAttribute('role', 'tab')
    link.setAttribute('aria-controls', panelId)
    link.setAttribute('tabindex', '-1')
    panel.setAttribute('role', 'tabpanel')
    panel.setAttribute('aria-labelledby', linkId)
  })

  // Active-only fills: every non-active tab's bar fades out where it stands.
  const setStaticFills = (index) => {
    bars.forEach((bar, k) => k !== index && fadeOutFill(bar))
  }

  // Collapse the text column onto the active panel, so a short tab doesn't drag the tallest
  // tab's leftover height around with it. Measured off the DOM (the CSS `align-items: start`
  // keeps each stacked panel at its own content height) rather than counting lines.
  // `immediate` skips the tween on load / resize, where there's no switch to ride.
  const fitPanels = (index, immediate) => {
    // In accordion mode the panels live in the drawers, so the column is empty and whatever a
    // panel measures there says nothing about it.
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

  // Crossfade the photo. The incoming one comes up on top and the outgoing is switched off
  // only once it is fully covered — no dip, and no edge peeking (both share the same box).
  const crossfadeImage = (tl, index) => {
    const inImg = images[index]
    if (!inImg) return
    const outImg = images[activeIndex]
    // Stacking order set outside the timeline: the incoming photo has to be on top from the
    // first frame it paints, and it is still at autoAlpha 0 here so nothing shows early.
    images.forEach((img, i) => gsap.set(img, { zIndex: i === index ? 2 : 1 }))
    inImg.classList.add(ACTIVE_CLASS)
    outImg?.classList.remove(ACTIVE_CLASS)
    tl.fromTo(inImg, { autoAlpha: 0 }, { autoAlpha: 1, ...IMG_FADE }, 0)
    if (outImg && outImg !== inImg)
      tl.set(outImg, { autoAlpha: 0 }, IMG_FADE.duration)
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

    // Incoming overlays the outgoing (z-index) regardless of DOM order; it shows instantly,
    // its content de-blurs in while the outgoing fades out.
    gsap.set(inPanel, { autoAlpha: 1, zIndex: 2 })
    if (outPanel) gsap.set(outPanel, { zIndex: 1 })

    const tl = gsap.timeline({
      onComplete: () => {
        activeIndex = index
        isAnimating = false
        gsap.set(panels, { clearProps: 'zIndex' })
      },
    })
    crossfadeImage(tl, index) // reads activeIndex — must run before onComplete moves it
    if (outPanel) tl.to(outPanel, OUT_FADE, 0)
    const at = outPanel ? 0.15 : 0
    if (parts[index].content.length)
      tl.fromTo(parts[index].content, REVEAL_FROM, CONTENT_TO, at)
  }

  // Reduced motion: no de-blur, no crossfade, no autoplay. Everything toggles instantly.
  function switchTabInstant(index) {
    if (index === activeIndex) return
    resetToTab(index)
  }

  // The underline IS the clock: the active bar grows floor→1 over that tab's reading time and
  // its completion advances the tab. Being a tween is the point — a lock can pause it.
  function startProgress(index) {
    if (progressTl) progressTl.kill()
    setStaticFills(index)
    const bar = bars[index]
    if (bar) armFill(bar) // drop a FILL_OUT still fading this bar out
    const dwell = dwellFor(index)
    // A timeline rather than a bare tween on the bar, so the clock still exists on a tab whose
    // underline is missing from the markup — the bar is optional, advancing isn't.
    progressTl = gsap.timeline({
      onComplete: () => {
        if (isAnimating) return
        const next = (index + 1) % count
        switchTab(next)
        startProgress(next)
      },
    })
    if (bar) progressTl.to(bar, { scaleX: 1, duration: dwell, ease: 'none' }, 0)
    else progressTl.to({}, { duration: dwell }, 0)
    sync()
  }

  const goTo = (index) => {
    if (reduceMotion.matches) return switchTabInstant(index)
    // Dropped mid-transition on purpose: switchTab guards itself on isAnimating, so without
    // this the clock would move to a tab whose panel switch was skipped — bar on one tab,
    // panel on another. The transition is ~1s.
    if (isAnimating) return
    switchTab(index)
    if (started) startProgress(index)
  }

  // Click-to-lock: the cycle holds on the clicked tab, its underline full. Pause the clock
  // BEFORE filling the bar — lockFill overwrites the timeline's own bar tween, and a timeline
  // emptied while still playing fires onComplete on the next tick.
  const markLocked = () => {
    root.classList.toggle(LOCKED_CLASS, isLocked())
    links.forEach((l, k) => l.classList.toggle(LOCKED_CLASS, k === lockedIndex))
  }
  const lock = (index) => {
    lockedIndex = index
    progressTl?.pause()
    markLocked()
    lockFill(bars[index])
  }
  // Release: rebuild the clock from this tab (armFill resets the bar to its visible floor).
  const unlock = () => {
    const index = lockedIndex
    lockedIndex = -1
    markLocked()
    started ? startProgress(index) : sync()
  }

  // Click / keyboard: jump to that tab AND lock it; activating the locked tab releases it.
  const activateTab = (index) => {
    // Accordion mode: the drawer header owns the interaction. A tap landing on the link inside
    // it bubbles here, so this has to stand down.
    if (inAccordion()) return
    if (reduceMotion.matches) return switchTabInstant(index)
    if (isAnimating) return
    if (lockedIndex === index) return unlock()
    if (index !== activeIndex) goTo(index)
    lock(index)
  }

  // The stacked-tabs state from scratch: one tab + one image visible, the rest hidden (before
  // paint, no CLS). Used on load, and again when the accordion hands the section back.
  function resetToTab(index) {
    activeIndex = index
    isAnimating = false
    gsap.killTweensOf(panels)
    gsap.killTweensOf(images)
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
    images.forEach((img, i) => {
      const on = i === index
      img.classList.toggle(ACTIVE_CLASS, on)
      gsap.set(img, { autoAlpha: on ? 1 : 0, zIndex: on ? 2 : 1 })
    })
    gsap.set(panels, { clearProps: 'zIndex' })
    fitPanels(index, true) // no collapse animation on load
  }

  gsap.set(bars.filter(Boolean), { scaleX: 0, transformOrigin: 'left center' })
  resetToTab(0)
  // Webfonts land after init and reflow the copy — re-measure once they're in.
  document.fonts?.ready.then(() => fitPanels(activeIndex, true))

  // ---- Mobile accordion (≤767px) ----
  // Drawers instead of tabs: each drawer holds its own text block AND its own image, so there
  // is nothing for a cycle to switch between and the clock is dropped entirely.
  accordion = createTabsAccordion({
    root,
    name: 'tabs-team',
    links,
    bodies: panels.map((panel, i) => [panel, images[i]].filter(Boolean)),
    anchor: root.querySelector('.tabs-team_tabs-links'),
    onEnable() {
      progressTl?.kill()
      progressTl = null
      lockedIndex = -1
      markLocked()
      isAnimating = false
      // Drop everything the stacked layout wrote: the panels and images are visible inside
      // their own drawers now, and a switch caught mid-flight would strand content blurred.
      gsap.killTweensOf(panels)
      gsap.killTweensOf(images)
      gsap.set(panels, { clearProps: 'opacity,visibility,zIndex' })
      gsap.set(images, { clearProps: 'opacity,visibility,zIndex' })
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
      links.forEach((link, i) =>
        link.classList.toggle(ACTIVE_CLASS, i === index)
      )
      panels.forEach((panel, i) =>
        panel.classList.toggle(ACTIVE_CLASS, i === index)
      )
      images.forEach((img, i) =>
        img.classList.toggle(ACTIVE_CLASS, i === index)
      )
    },
    onClose(index) {
      if (accordionOpen === index) accordionOpen = -1
    },
    onDisable(wasOpen) {
      accordionOpen = -1
      resetToTab(wasOpen >= 0 ? wasOpen : 0)
      if (started) startProgress(activeIndex)
    },
  })

  // Click — switch to that tab and lock the cycle on it (second click releases).
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
          // Accordion mode has no cycle to start.
          if (inAccordion()) return
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
        // viewportHeight/elementHeight, so a section taller than ~2.5x the viewport (routine
        // on mobile) never reaches a 0.4 threshold and this never fires.
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
      if (io) io.disconnect()
      root.removeEventListener('keydown', onKeydown)
      document.removeEventListener('visibilitychange', onVisibility)
      links.forEach((link, i) => link.removeEventListener('click', onClick[i]))
    },
  }
}

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='tabs-team']
 */
export default function (elements) {
  if (!gsap) {
    console.warn('[tabs-team] GSAP not found on window — skipping')
    return
  }

  const instances = elements.map(setupTabs).filter(Boolean)

  return {
    resize() {
      instances.forEach((instance) => instance.refit())
    },
  }
}
