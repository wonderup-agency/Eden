/*
  Component: tabs-imaging · data-component="tabs-imaging"
  Tabs (NO autoplay) — click/keyboard switches; on switch the incoming image wipes open
  (clip-path) while its content de-blurs in. Only the ACTIVE link is underlined (a black
  bar that slides in); the rest show none.
  CSS → ./styles/tabs-imaging.css (paste into Webflow head) · Docs → .claude/rules/components/tabs-imaging.md
*/

import { REVEAL_FROM } from '../utils/word-reveal.js'

const { gsap } = window

const ACTIVE_CLASS = 'is-active'
const UNDERLINE = { duration: 0.45, ease: 'power2.out' } // active-underline grow/clear

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

  // Inject a black fill into each underline + expand the rail (is-track). Only the
  // ACTIVE link's fill is shown (scaleX 1); the rest stay 0 — so just the active tab
  // is underlined. Reduced motion skips track/fill (CSS shows the active underline).
  const bars = links.map((link) => {
    const track = link.querySelector('.tabs-imaging_tab-link-underline')
    if (!track || reduceMotion.matches) return null
    const fill = document.createElement('span')
    fill.className = 'tabs-imaging_tab-link-fill'
    track.appendChild(fill)
    track.classList.add('is-track')
    return fill
  })

  // Animatable parts per panel: the image wrapper (clip wipe) + content blocks (de-blur).
  const parts = panels.map((panel) => ({
    image: panel.querySelector('[tabs-imaging="image"]'),
    content: gsap.utils.toArray(
      panel.querySelector(
        '[tabs-imaging="text-content"] .tabs-imaging_tab-content-inner'
      )?.children || panel.querySelectorAll('[tabs-imaging="text-content"] > *')
    ),
  }))

  let activeIndex = -1
  let isAnimating = false

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

  // Underline only the active tab: its fill scales to 1, every other to 0 (smooth).
  const setActiveUnderline = (index) => {
    bars.forEach((bar, k) => {
      if (!bar) return
      gsap.to(bar, {
        scaleX: k === index ? 1 : 0,
        transformOrigin: 'left center',
        ...UNDERLINE,
      })
    })
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

    setActiveUnderline(index)

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

  // Reduced motion: no crossfade. Panels toggle instantly via autoAlpha; the active
  // underline shows via CSS.
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

  // Initial state: first tab visible + underlined, rest hidden (before paint, no CLS).
  links.forEach((link) => link.classList.remove(ACTIVE_CLASS))
  panels.forEach((panel) => panel.classList.remove(ACTIVE_CLASS))
  gsap.set(panels, { autoAlpha: 0 })
  gsap.set(panels[0], { autoAlpha: 1 })
  gsap.set(bars.filter(Boolean), { scaleX: 0, transformOrigin: 'left center' })
  if (bars[0]) gsap.set(bars[0], { scaleX: 1, transformOrigin: 'left center' })
  links[0].classList.add(ACTIVE_CLASS)
  panels[0].classList.add(ACTIVE_CLASS)
  links.forEach((link, i) => {
    link.setAttribute('aria-selected', i === 0 ? 'true' : 'false')
    link.setAttribute('tabindex', i === 0 ? '0' : '-1')
  })
  activeIndex = 0

  // Click — switch to the clicked tab.
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

  return {
    destroy() {
      root.removeEventListener('keydown', onKeydown)
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
