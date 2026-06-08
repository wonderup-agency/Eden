/*
Component: tabs-architected
Webflow attribute: data-component="tabs-architected"

Autoplay tabs (Osmo-style) adapted to the Eden markup. Clickable links drive
content panels; on switch the incoming panel's image reveals via a vertical
clip-path wipe while its content (title, subtitle, button) de-blurs + fades in,
staggered. While a tab is active, its link underline fills left→right as an
autoplay progress bar; when full, it advances to the next tab. Autoplay starts
when the section enters the viewport, pauses on hover, restarts on click.

GSAP + ScrollTrigger are expected as globals (loaded site-wide in Webflow).

The CSS is NOT bundled here — it lives in Webflow's global head custom code.
The source of truth is ./styles/tabs-architected.css (copy/paste it into Webflow).
*/

import { REVEAL_FROM } from '../utils/word-reveal.js'

const { gsap } = window
const ScrollTrigger = window.ScrollTrigger

const ACTIVE_CLASS = 'is-active'
const AUTOPLAY_DURATION = 5 // seconds per tab

// Image: vertical clip-path wipe (top→bottom). Flip the inset() sides to reverse.
const IMG_CLIP_HIDDEN = 'inset(0% 0% 100% 0%)' // clipped from the bottom — nothing shown
const IMG_CLIP_SHOWN = 'inset(0% 0% 0% 0%)' // fully revealed
const IMG_REVEAL = { duration: 1.1, ease: 'power3.inOut' }
// Content blocks (title / subtitle / button): de-blur + fade + rise, staggered.
// REVEAL_FROM is the shared paradigm/hero start state (blur + fade + rise).
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

// Wire one tabs root. Returns { destroy } for cleanup, or null if the markup is
// incomplete.
function setupTabs(root) {
  const links = gsap.utils.toArray(
    root.querySelectorAll('[tabs-architected="link"]')
  )
  const panels = gsap.utils.toArray(
    root.querySelectorAll('.tabs-architected_tab-item')
  )

  // Need at least two link/panel pairs to do anything useful.
  if (links.length < 2 || panels.length < 2) {
    console.warn('[tabs-architected] need >= 2 links and panels — skipping')
    return null
  }

  const count = Math.min(links.length, panels.length)
  const bars = links.map((link) =>
    link.querySelector('.tabs-architected_tab-link-underline')
  )

  // Animatable parts per panel: the image wrapper (vertical clip wipe) and the
  // content blocks — title / subtitle / button — inside the text column (de-blur).
  const parts = panels.map((panel) => ({
    image: panel.querySelector('[tabs-architected="image"]'),
    content: gsap.utils.toArray(
      panel.querySelector(
        '[tabs-architected="text-content"] .tabs-architected_tab-content-inner'
      )?.children ||
        panel.querySelectorAll('[tabs-architected="text-content"] > *')
    ),
  }))

  let activeIndex = -1
  let isAnimating = false
  let progressTween = null
  let started = false // autoplay has been kicked off (section reached)
  let paused = false // hover pause

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

  // Fill the active tab's underline over AUTOPLAY_DURATION, then advance.
  function startProgress(index) {
    if (progressTween) progressTween.kill()
    const bar = bars[index]
    if (!bar || reduceMotion.matches) return

    gsap.set(bar, { scaleX: 0, transformOrigin: 'left center' })
    progressTween = gsap.to(bar, {
      scaleX: 1,
      duration: AUTOPLAY_DURATION,
      ease: 'none',
      onComplete: () => {
        if (!isAnimating) switchTab((index + 1) % count)
      },
    })
  }

  function switchTab(index) {
    if (isAnimating || index === activeIndex) return
    isAnimating = true
    if (progressTween) progressTween.kill()

    const outLink = links[activeIndex]
    const outPanel = panels[activeIndex]
    const outBar = bars[activeIndex]
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

    const inParts = parts[index]

    // Incoming reveals on top of the outgoing; z-index guarantees it overlays
    // regardless of DOM order (e.g. switching to an earlier tab). The panel
    // itself shows instantly — its image + content are what animate in.
    gsap.set(inPanel, { autoAlpha: 1, zIndex: 2 })
    if (outPanel) gsap.set(outPanel, { zIndex: 1 })

    const tl = gsap.timeline({
      onComplete: () => {
        activeIndex = index
        isAnimating = false
        gsap.set(panels, { clearProps: 'zIndex' })
        if (started && !paused) startProgress(index)
      },
    })

    if (outPanel) {
      tl.to(outPanel, OUT_FADE, 0)
      if (outBar)
        tl.set(outBar, { scaleX: 0, transformOrigin: 'left center' }, 0)
    }

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

  // Reduced motion: no crossfade, no progress, no autoplay. Panels toggle
  // instantly via autoAlpha; click/keyboard only.
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

  // Initial state: first tab visible, rest hidden — set before paint to avoid CLS.
  // Clear any pre-existing active classes (the Webflow markup may ship more than
  // one) so exactly one tab/panel is active.
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

  // Hover pause / resume (skipped under reduced motion — no autoplay to pause).
  const onEnter = () => {
    paused = true
    if (progressTween) progressTween.pause()
  }
  const onLeave = () => {
    paused = false
    if (started && progressTween) progressTween.resume()
  }
  if (!reduceMotion.matches) {
    root.addEventListener('mouseenter', onEnter)
    root.addEventListener('mouseleave', onLeave)
  }

  // Autoplay starts when the section enters the viewport (not on load).
  let trigger = null
  if (!reduceMotion.matches) {
    trigger = ScrollTrigger.create({
      trigger: root,
      start: 'top 80%',
      once: true,
      onEnter: () => {
        started = true
        if (!paused) startProgress(activeIndex)
      },
    })
  }

  return {
    destroy() {
      if (progressTween) progressTween.kill()
      if (trigger) trigger.kill()
      root.removeEventListener('keydown', onKeydown)
      root.removeEventListener('mouseenter', onEnter)
      root.removeEventListener('mouseleave', onLeave)
      links.forEach((link, i) => link.removeEventListener('click', onClick[i]))
    },
  }
}

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='tabs-architected']
 */
export default function (elements) {
  if (!gsap || !ScrollTrigger) {
    console.warn(
      '[tabs-architected] GSAP / ScrollTrigger not found on window — skipping'
    )
    return
  }
  gsap.registerPlugin(ScrollTrigger)

  elements.map(setupTabs).filter(Boolean)
}
