/*
  Component: tabs-headquarters · data-component="tabs-headquarters"
  tabs-stats' chrome with the point cloud taken out: three city tabs, NO autoplay (hover /
  click / keyboard only), an active-only underline that snaps full as a state indicator, and a
  crossfade between the three photo items. The whole tab-item crossfades, not just the <img>,
  so the overlay inside it travels with the photo.
  CSS → ./styles/tabs-headquarters.css (bundled via src/styles.js) · Docs → .claude/rules/components/tabs-headquarters.md
*/

import { fadeOutFill, fillFull } from '../utils/tab-underline.js'

const { gsap } = window

const ACTIVE_CLASS = 'is-active'
// Hooks are shared with tabs-architected / tabs-stats on purpose — tabs-stats already reuses
// that namespace, and it means adding this section is a one-attribute Designer edit.
const LINK_SEL = '[tabs-architected="link"]'

// Item crossfade: the incoming item comes up ON TOP and the outgoing is switched off once it
// is fully covered. Fading both at once dips the combined opacity mid-way; this can't,
// because the two share the same grid cell.
const ITEM_FADE = { duration: 0.7, ease: 'power2.inOut' }

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

// Wire one root. Returns { destroy }, or null if the markup is incomplete.
function setupTabs(root) {
  const links = gsap.utils.toArray(root.querySelectorAll(LINK_SEL))
  // The stacked visuals. The ITEM is the animated unit, not the <img> — it also carries the
  // overlay, which has to crossfade with the photo rather than sit above a changing one.
  const items = gsap.utils.toArray(
    root.querySelectorAll('.tabs-headquarters_tab-item')
  )

  if (links.length < 2 || items.length < 2) {
    console.warn('[tabs-headquarters] need >= 2 links and items — skipping')
    return null
  }

  const count = Math.min(links.length, items.length)

  // Gates the CSS stacking, so with no JS the items stay in normal flow (crawlable) instead of
  // piling into one unreadable stack.
  root.classList.add('is-enhanced')

  // Grey TRACK + injected black FILL. Reduced motion skips both (CSS shows the active bar).
  const bars = links.map((link) => {
    const track = link.querySelector('.tabs-headquarters_tab-link-underline')
    if (!track || reduceMotion.matches) return null
    const fill = document.createElement('span')
    fill.className = 'tabs-headquarters_tab-link-fill'
    track.appendChild(fill)
    track.classList.add('is-track')
    return fill
  })

  let activeIndex = -1
  let isAnimating = false

  // Accessibility scaffolding — tablist / tab / tabpanel with roving tabindex.
  root
    .querySelector('.tabs-headquarters_tabs-links')
    ?.setAttribute('role', 'tablist')
  links.forEach((link, i) => {
    const item = items[i]
    const linkId = link.id || `tabs-headquarters-tab-${i}`
    const itemId = item.id || `tabs-headquarters-panel-${i}`
    link.id = linkId
    item.id = itemId
    link.setAttribute('role', 'tab')
    link.setAttribute('aria-controls', itemId)
    link.setAttribute('tabindex', '-1')
    item.setAttribute('role', 'tabpanel')
    item.setAttribute('aria-labelledby', linkId)
  })

  // The active bar shows FULL immediately and the others fade out where they stand. No 0→1
  // slide: nothing is being timed here, and sliding it in read as a progress bar that isn't
  // one (same call tabs-stats makes).
  const setBars = (index) => {
    bars.forEach((bar, k) => (k === index ? fillFull(bar) : fadeOutFill(bar)))
  }

  const setState = (index) => {
    links.forEach((link, i) => {
      const on = i === index
      link.classList.toggle(ACTIVE_CLASS, on)
      link.setAttribute('aria-selected', on ? 'true' : 'false')
      link.setAttribute('tabindex', on ? '0' : '-1')
    })
    items.forEach((item, i) => item.classList.toggle(ACTIVE_CLASS, i === index))
    setBars(index)
  }

  // Everything hidden but one, before paint — no CLS, and it clears the `is-active` the
  // Designer leaves on every link.
  const reset = (index) => {
    activeIndex = index
    isAnimating = false
    gsap.killTweensOf(items)
    items.forEach((item, i) =>
      gsap.set(item, {
        autoAlpha: i === index ? 1 : 0,
        zIndex: i === index ? 2 : 1,
      })
    )
    setState(index)
  }

  function switchTab(index) {
    if (isAnimating || index === activeIndex) return
    if (reduceMotion.matches) return reset(index)
    isAnimating = true

    const inItem = items[index]
    const outItem = items[activeIndex]
    setState(index)

    // Stacking order outside the timeline: the incoming item has to be on top from the first
    // frame it paints, and it is still at autoAlpha 0 here so nothing shows early.
    items.forEach((item, i) => gsap.set(item, { zIndex: i === index ? 2 : 1 }))

    const tl = gsap.timeline({
      onComplete: () => {
        activeIndex = index
        isAnimating = false
      },
    })
    tl.fromTo(inItem, { autoAlpha: 0 }, { autoAlpha: 1, ...ITEM_FADE }, 0)
    if (outItem) tl.set(outItem, { autoAlpha: 0 }, ITEM_FADE.duration)
  }

  reset(0)

  // Hover previews a city, click commits to it — both just switch, since nothing is running
  // that a hover could disturb.
  const handlers = links.map((link, i) => {
    const onEnter = () => switchTab(i)
    const onClick = () => switchTab(i)
    link.addEventListener('mouseenter', onEnter)
    link.addEventListener('click', onClick)
    return { onEnter, onClick }
  })

  // Keyboard — arrows/Home/End move focus + activate; Enter/Space activate.
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
      switchTab(current)
      return
    } else return
    e.preventDefault()
    links[next].focus()
    switchTab(next)
  }
  root.addEventListener('keydown', onKeydown)

  return {
    destroy() {
      root.removeEventListener('keydown', onKeydown)
      links.forEach((link, i) => {
        link.removeEventListener('mouseenter', handlers[i].onEnter)
        link.removeEventListener('click', handlers[i].onClick)
      })
    },
  }
}

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='tabs-headquarters']
 */
export default function (elements) {
  if (!gsap) {
    console.warn('[tabs-headquarters] GSAP not found on window — skipping')
    return
  }
  elements.map(setupTabs).filter(Boolean)
}
