/*
  Component: tabs-headquarters · data-component="tabs-headquarters"
  Autoplay city tabs, one photo each. The underline IS the clock: a pausable tween per tab over
  a FIXED dwell (no video, no copy to scale it from), whose completion advances the tab. Starts
  on scroll-in, pauses off-screen / hidden tab. Hover never pauses it; clicking a tab LOCKS the
  cycle there with its underline full, until that tab is clicked again.
  The whole tab-item crossfades, not just the <img>, so the overlay inside it travels with it.
  CSS → ./styles/tabs-headquarters.css (bundled via src/styles.js) · Docs → .claude/rules/components/tabs-headquarters.md
*/

import { armFill, fadeOutFill, lockFill } from '../utils/tab-underline.js'

const { gsap } = window

const ACTIVE_CLASS = 'is-active'
const LOCKED_CLASS = 'is-locked' // hook for CSS / the Designer — no rule ships with it
const LINK_SEL = '[tabs-headquarters="link"]'

// Seconds per tab. A FIXED number, unlike the other autoplay sections: there is no video to
// take a cue gap from and the labels are two-word city names, so scaling by text would just
// clamp every tab to the same floor anyway. Overridable per tab from the Designer.
const DWELL = 5
const DWELL_ATTR = 'data-headquarters-dwell'

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
  let started = false // autoplay kicked off (section reached)
  let onScreen = false
  let lockedIndex = -1 // >= 0 → the user clicked this tab and the cycle holds on it
  let progressTl = null // the active tab's clock

  const dwellFor = (i) => {
    const raw = parseFloat(
      links[i]?.getAttribute(DWELL_ATTR) ?? items[i]?.getAttribute(DWELL_ATTR)
    )
    return isFinite(raw) && raw > 0 ? raw : DWELL
  }

  // Off-screen / hidden tab / a locked tab pause the clock. Nothing else does — hover is not a
  // control here, at any breakpoint or pointer type.
  const isLocked = () => lockedIndex >= 0
  const sync = () => {
    if (!progressTl) return
    started && onScreen && !document.hidden && !isLocked()
      ? progressTl.resume()
      : progressTl.pause()
  }

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

  const setState = (index) => {
    links.forEach((link, i) => {
      const on = i === index
      link.classList.toggle(ACTIVE_CLASS, on)
      link.setAttribute('aria-selected', on ? 'true' : 'false')
      link.setAttribute('tabindex', on ? '0' : '-1')
    })
    items.forEach((item, i) => item.classList.toggle(ACTIVE_CLASS, i === index))
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

  // The underline IS the clock: the active bar grows floor→1 over the dwell and its completion
  // advances the tab. Being a tween is the point — a lock can pause it in place.
  function startProgress(index) {
    if (progressTl) progressTl.kill()
    // Every other bar fades out where it stands, so none of them rewinds leftwards while this
    // one fills forwards.
    bars.forEach((bar, k) => k !== index && fadeOutFill(bar))
    const bar = bars[index]
    if (bar) armFill(bar) // at the ~2px visible floor, dropping any fade still on it
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
    const dwell = dwellFor(index)
    if (bar) progressTl.to(bar, { scaleX: 1, duration: dwell, ease: 'none' }, 0)
    else progressTl.to({}, { duration: dwell }, 0)
    sync()
  }

  // Click-to-lock: the cycle holds on the clicked tab, its underline full. Pause the clock
  // BEFORE filling the bar — lockFill overwrites the timeline's own bar tween, and a timeline
  // emptied while still playing fires onComplete on the next tick, i.e. it would advance the
  // tab it just locked.
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
  const unlock = () => {
    const index = lockedIndex
    lockedIndex = -1
    markLocked()
    started ? startProgress(index) : sync()
  }

  // Any explicit activation switches AND locks; activating the locked tab releases it. Bails
  // while a switch is animating, so a dropped switch can't leave the bar locked on one tab and
  // the photo on another.
  const activateTab = (index) => {
    if (reduceMotion.matches) return reset(index)
    if (isAnimating) return
    if (lockedIndex === index) return unlock()
    if (index !== activeIndex) {
      switchTab(index)
      if (started) startProgress(index)
    }
    lock(index)
  }

  reset(0)

  // Click only — hover is deliberately not wired: the cycle must not stop for a reader merely
  // passing the cursor over the section.
  const onClick = links.map((link, i) => {
    const handler = () => activateTab(i)
    link.addEventListener('click', handler)
    return handler
  })

  // Keyboard — arrows/Home/End move focus + activate; Enter/Space activate. Every explicit
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
        // viewportHeight/elementHeight, so a section taller than ~2.5x the viewport never
        // reaches a fixed ratio and this would never fire.
        threshold: 0,
        rootMargin: '-25% 0px -25% 0px',
      }
    )
    io.observe(root)
  }

  return {
    destroy() {
      progressTl?.kill()
      if (io) io.disconnect()
      root.removeEventListener('keydown', onKeydown)
      document.removeEventListener('visibilitychange', onVisibility)
      links.forEach((link, i) => link.removeEventListener('click', onClick[i]))
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
