/*
  Component: tabs-foundation-model · data-component="tabs-foundation-model"
  Autoplay tabs (same engine as tabs-architected / tabs-imaging): on switch the incoming
  image wipes open (clip-path) while its content de-blurs in; the active underline fills
  as a progress bar, then advances. Starts on scroll-in, pauses on hover, restarts on click.
  CSS → ./styles/tabs-foundation-model.css (paste into Webflow head) · Docs → .claude/rules/components/tabs-foundation-model.md
*/

import { REVEAL_FROM } from '../utils/word-reveal.js'

const { gsap } = window
const ScrollTrigger = window.ScrollTrigger

const ACTIVE_CLASS = 'is-active'
const AUTOPLAY_DURATION = 5 // seconds per tab

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

  // Turn each underline into a grey TRACK + inject a black FILL child that scales 0→1.
  // The fill is cumulative across tabs (see setStaticFills) so the row reads as total
  // autoplay progress. Reduced motion skips track/fill; `bars` = the fill children.
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

  // Animatable parts per panel: the image wrapper (clip wipe) + content blocks (de-blur).
  const parts = panels.map((panel) => ({
    image: panel.querySelector('[tabs-foundation-model="image"]'),
    content: gsap.utils.toArray(
      panel.querySelector(
        '[tabs-foundation-model="text-content"] .tabs-foundation-model_tab-content-inner'
      )?.children ||
        panel.querySelectorAll('[tabs-foundation-model="text-content"] > *')
    ),
  }))

  let activeIndex = -1
  let isAnimating = false
  let progressTween = null
  let started = false // autoplay has been kicked off (section reached)
  let paused = false // hover pause

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

  // Cumulative fills: tabs before the active one stay full, the ones after stay empty
  // (the active one is animated separately). The row = total autoplay progress.
  const setStaticFills = (index) => {
    bars.forEach((bar, k) => {
      if (!bar || k === index) return
      gsap.set(bar, {
        scaleX: k < index ? 1 : 0,
        transformOrigin: 'left center',
      })
    })
  }

  // Fill the active tab's underline over AUTOPLAY_DURATION, then advance.
  function startProgress(index) {
    if (progressTween) progressTween.kill()
    setStaticFills(index)
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

    // Start the fill immediately (in parallel with the reveal). Always create the tween
    // — even when hovered — so a click while the cursor is over the section still leaves
    // a live tween to resume on mouseleave; pause it right away if currently hovered.
    if (started) {
      startProgress(index)
      if (paused && progressTween) progressTween.pause()
    }

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

  // Initial state: first tab visible, rest hidden (before paint, no CLS). Clear any
  // pre-existing active classes so exactly one tab/panel is active.
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
        startProgress(activeIndex)
        if (paused && progressTween) progressTween.pause()
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
 * @param {HTMLElement[]} elements - All elements matching [data-component='tabs-foundation-model']
 */
export default function (elements) {
  if (!gsap || !ScrollTrigger) {
    console.warn(
      '[tabs-foundation-model] GSAP / ScrollTrigger not found on window — skipping'
    )
    return
  }
  gsap.registerPlugin(ScrollTrigger)

  elements.map(setupTabs).filter(Boolean)
}
