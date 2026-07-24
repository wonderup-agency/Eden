/*
  Component: paradigm · data-component="paradigm"
  Autoplay tabs (3): a per-number underline (grey track + black fill, active-only)
  fills as the active tab loads; the active text de-blurs per word and the visual
  crossfades on each switch.
  CSS → ./styles/paradigm.css (paste into Webflow head) · Docs → .claude/rules/components/paradigm.md
*/

import { REVEAL_FROM, REVEAL_TO, splitElement } from '../utils/word-reveal.js'

const { gsap } = window

// Tuning
const CROSSFADE = 0.6 // visual crossfade
const OUT_FADE = 0.3 // outgoing text fade
// Autoplay dwell scales with the tab's text length (more words → longer).
const AUTOPLAY_BASE = 3.5 // seconds baseline per tab
const AUTOPLAY_PER_WORD = 0.35 // extra seconds per word of the tab's message
const AUTOPLAY_MIN = 4 // floor
const AUTOPLAY_MAX = 11 // ceiling

// Per-tab autoplay seconds from its message word count.
function autoplayDuration(el) {
  const words = (el?.textContent || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
  const d = AUTOPLAY_BASE + words * AUTOPLAY_PER_WORD
  return Math.min(AUTOPLAY_MAX, Math.max(AUTOPLAY_MIN, d))
}

// Outgoing tab: plain fade only. The de-blur lives on the words, never the parent —
// a filter on the title element would linger and blur the words on re-entry.
const REVEAL_OUT = { autoAlpha: 0, duration: OUT_FADE }

function setupRoot(root) {
  const titles = gsap.utils.toArray(
    root.querySelectorAll('[data-paradigm="tab-title"]')
  )
  const messages = titles.map(
    (t) => t.querySelector('[data-paradigm-message]') || t
  )
  const links = gsap.utils.toArray(
    root.querySelectorAll('[data-paradigm="tab-link"]')
  )
  const visuals = gsap.utils.toArray(
    root.querySelectorAll('[data-paradigm-visual]')
  )
  const messagesWrap = root.querySelector('[data-paradigm-messages]')
  const visualsWrap = root.querySelector('.tabs-paradigm_visual-wrapper')

  const count = Math.min(titles.length, links.length, visuals.length)
  if (count < 1) {
    console.warn('[paradigm] needs at least one tab-title / tab-link / visual')
    return null
  }

  root.classList.add('is-enhanced')

  // Per-number underline (active-only): inject a grey track + black fill into each number.
  // Only the active number's fill grows 0→1; the rest stay empty (inactive). Replaces the
  // single full-width .tabs_number-underline (hidden via CSS).
  const bars = links.slice(0, count).map((link) => {
    const track = document.createElement('span')
    track.className = 'tabs-paradigm_tab-link-underline is-track'
    const fill = document.createElement('span')
    fill.className = 'tabs-paradigm_tab-link-fill'
    track.appendChild(fill)
    link.appendChild(track)
    return fill
  })

  const wordsByTab = messages.slice(0, count).map(splitElement)

  // Initial states (before autoplay starts)
  gsap.set(titles, { autoAlpha: 0 })
  gsap.set(visuals, { autoAlpha: 0 })
  gsap.set(wordsByTab.flat(), REVEAL_FROM)
  gsap.set(bars, { scaleX: 0, transformOrigin: 'left center' })

  let index = 0
  let started = false
  let progressTl = null
  let onScreen = false
  let hover = false
  let docVisible = !document.hidden

  const shouldPlay = () => started && onScreen && !hover && docVisible
  const sync = () => {
    if (!progressTl) return
    shouldPlay() ? progressTl.play() : progressTl.pause()
  }

  const activate = (i) => {
    links.forEach((l, k) => {
      l.classList.toggle('is-active', k === i)
      l.setAttribute('aria-current', k === i ? 'true' : 'false')
    })

    titles.forEach((t, k) => {
      if (k !== i) gsap.to(t, REVEAL_OUT)
    })
    gsap.set(titles[i], { autoAlpha: 1 })
    gsap.set(wordsByTab[i], REVEAL_FROM)
    gsap.to(wordsByTab[i], REVEAL_TO)

    visuals.forEach((v, k) =>
      gsap.to(v, {
        autoAlpha: k === i ? 1 : 0,
        duration: CROSSFADE,
        ease: 'sine.out',
      })
    )
  }

  // Every non-active number's fill stays empty (inactive).
  const setStaticFills = (i) => {
    bars.forEach((bar, k) => {
      if (k === i) return
      gsap.set(bar, { scaleX: 0, transformOrigin: 'left center' })
    })
  }

  // Underline = autoplay progress, active-only: only the active number's fill grows
  // 0→1 over its text-scaled dwell; the others stay empty. Advances on complete.
  const runProgress = () => {
    progressTl && progressTl.kill()
    setStaticFills(index)
    progressTl = gsap.timeline({ onComplete: () => goTo((index + 1) % count) })
    const bar = bars[index]
    gsap.set(bar, { scaleX: 0, transformOrigin: 'left center' })
    progressTl.to(
      bar,
      {
        scaleX: 1,
        duration: autoplayDuration(messages[index]),
        ease: 'none',
      },
      0
    )
    sync()
  }

  function goTo(i) {
    index = i
    activate(i)
    runProgress()
  }

  const start = () => {
    if (started) return
    started = true
    goTo(0)
  }

  // User-driven switch (click / keyboard) — also kicks off autoplay if not started yet.
  const select = (i) => {
    started = true
    goTo(i)
  }

  const wireButton = (el, onActivate, label) => {
    el.setAttribute('role', 'button')
    el.setAttribute('tabindex', '0')
    el.setAttribute('aria-label', label)
    el.addEventListener('click', onActivate)
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onActivate()
      }
    })
  }

  // Clicking a number in the menu jumps to that tab.
  links.forEach((l, i) =>
    wireButton(l, () => select(i), 'Go to slide ' + (i + 1))
  )

  // Visibility / hover / tab-focus gating
  const io = new window.IntersectionObserver(
    (entries) => {
      onScreen = entries[0].isIntersecting
      if (onScreen && !started) start()
      else sync()
    },
    { threshold: 0.35 }
  )
  io.observe(root)

  // Pause only while hovering the content (text + visual) — not the whole section.
  ;[messagesWrap, visualsWrap].forEach((el) => {
    if (!el) return
    el.addEventListener('mouseenter', () => {
      hover = true
      sync()
    })
    el.addEventListener('mouseleave', () => {
      hover = false
      sync()
    })
  })
  document.addEventListener('visibilitychange', () => {
    docVisible = !document.hidden
    sync()
  })
}

// Static fallback (no GSAP / reduced motion): show the first tab only via classes.
function staticFallback(root) {
  const first = (sel) => root.querySelector(sel)
  first('[data-paradigm="tab-title"]')?.classList.add('is-active')
  first('[data-paradigm="tab-link"]')?.classList.add('is-active')
  first('[data-paradigm-visual]')?.classList.add('is-active')
  root.classList.add('is-static')
}

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='paradigm']
 */
export default function (elements) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (!gsap || reduce) {
    if (!gsap)
      console.warn('[paradigm] GSAP not found on window — static fallback')
    elements.forEach(staticFallback)
    return
  }

  elements.forEach(setupRoot)
}
