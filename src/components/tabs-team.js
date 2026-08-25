/*
  Component: tabs-team · data-component="tabs-team"
  Autoplay text tabs with ONE photo per tab, over a ROTATING window of tab links: the active
  tab is always slot 0, the outgoing one leaves through the left edge and the next member
  comes round on the right — so the section takes 4, 6 or 10 members without changing shape.
  Dwell is the panel's READING TIME. Same chrome as tabs-architected (the underline IS the
  clock, click-to-lock, mobile accordion).
  CSS → ./styles/tabs-team.css (bundled via src/styles.js) · Docs → .claude/rules/components/tabs-team.md
*/

import { REVEAL_FROM } from '../utils/word-reveal.js'
import { armFill, clearFill, lockFill } from '../utils/tab-underline.js'
import {
  ACCORDION_CLASS,
  createTabsAccordion,
} from '../utils/tabs-accordion.js'

const { gsap } = window

// Temporary diagnostic for the rotating window. It logs AND parks the same data on
// window.__tabsTeam, because the prod build strips every console.* (Terser drop_console) —
// the global is what survives a deploy, so the section can be diagnosed on the live page.
// Set it back to false before shipping for real.
const DEBUG = false
const dbg = (entry) => {
  if (!DEBUG) return
  ;(window.__tabsTeam ||= []).push(entry)
}

const ACTIVE_CLASS = 'is-active'
const TRACK_CLASS = 'is-track' // grey track — active tab only (must match tabs-team.css)
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

// How many links show at once. Constant at any member count — that's what keeps the layout
// identical with 3 members and with 10.
const VISIBLE_SLOTS = 3
// The row shift. One tween per link, all starting together, so it reads as a strip moving.
const ROTATE = { duration: 0.7, ease: 'power2.inOut' }
// A link that wrapped past the end leaves through the left over this share of the tween and
// (only when it lands back inside the window) comes round on the right over the rest.
const EXIT_SHARE = 0.5
// Enter / exit fade, as a share of that leg. Without it a name pops in at the right edge.
const FADE_SHARE = 0.6
// The sliver of the NEXT name that must always show, in px. This is the invariant the row is
// laid out around: the strip has to read as continuing in EVERY rotation, not only in the ones
// where the names that happen to be on screen are short. `VISIBLE_SLOTS` is a ceiling that
// gives way to it — a row that can't fit three names and still peek shows two and still peeks.
const PEEK_MIN = 48
// Cap on how gradual the right-edge dissolve is. Without it the fade spans whatever is left
// over, and on a short run that's most of the row — the peeking name washes out end to end.
const FADE_MAX = 160
// Floor on the space between slots, in px. The CSS sets a real `column-gap`, but the slot
// width IS the name's own width now — so if that rule ever goes missing, two names would sit
// flush against each other rather than merely close.
const MIN_GAP = 12

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
  if (links.length !== panels.length)
    console.warn(
      `[tabs-team] ${links.length} links vs ${panels.length} text blocks — only the first ${count} cycle; the rest never become active, so they never leave the parked slot`
    )
  // The window that actually runs. A queue only reads as a queue if SOMEBODY is waiting
  // off-stage: with as many slots as members nobody is ever hidden, so the outgoing name has
  // to fly out to the left and come straight back on the right — which reads as a glitch, not
  // as a rotation. So the last member is always parked, and VISIBLE_SLOTS is the ceiling
  // rather than the count. At 4+ members it IS VISIBLE_SLOTS, which is the shipping case.
  let slots = Math.min(VISIBLE_SLOTS, Math.max(1, count - 1))
  if (images.length && images.length < count)
    console.warn(
      `[tabs-team] ${count} tabs but ${images.length} images — the extra tabs keep the last one`
    )

  // Enhanced flag — gates the CSS stacking (text blocks AND images) and the rotating row, so
  // they only take effect once the bundle runs. With no JS everything stays in normal flow,
  // readable and crawlable.
  root.classList.add('is-enhanced')

  // The stacked text column — its height is tweened onto the active panel (see fitPanels).
  const textWrap = root.querySelector('[tabs-team="text-content"]')

  // Turn each underline into a track that can hold a black FILL child scaling 0→1. The grey
  // track itself is added per switch (setTracks) — only the active tab carries one.
  // Reduced motion skips track/fill entirely.
  const bars = links.map((link) => {
    const track = link.querySelector('.tabs-team_tab-link-underline')
    if (!track || reduceMotion.matches) return null
    const fill = document.createElement('span')
    fill.className = 'tabs-team_tab-link-fill'
    track.appendChild(fill)
    return fill
  })

  // Each panel's direct children (heading, paragraph, button) de-blur in, staggered.
  const parts = panels.map((panel) => ({
    content: gsap.utils.toArray(panel.children),
  }))

  let activeIndex = -1
  let pendingIndex = 0 // where a switch is heading — activeIndex only moves on completion
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

  // ---- The rotating links row ----
  // The links row IS the viewport: it already carries the Designer's flex row and its gap, so
  // nothing is injected and there is no new hook to author. Each link is translated into its
  // slot; the DOM order NEVER changes, so the tab order and the a11y tree stay authorial.
  const linksRow = root.querySelector('.tabs-team_tabs-links')
  // Optional: the peek says "there are more", this says how many and where you are.
  const counter = root.querySelector('[tabs-team="counter"]')
  const pad = (n) => String(n).padStart(2, '0')
  const setCounter = (index) => {
    if (!counter) return
    counter.innerHTML = `<span class="tabs-team_counter-current">${pad(index + 1)}</span> / ${pad(count)}`
  }
  if (!linksRow)
    console.warn(
      '[tabs-team] no .tabs-team_tabs-links — the rotating window is off, the links stay in flow'
    )
  const natX = [] // each link's laid-out x inside the row, transforms cleared
  const linkW = []
  let rowGap = 0
  let rowW = 0 // the viewport's own width — anything past it is clipped
  let rowSlots = null // current per-link target, so a rotation knows where each link came from

  // One write (transforms off), then all the reads — never interleaved, or every link costs
  // a forced reflow. Positions are in the row's border-box space.
  function measureRow() {
    if (!linksRow || inAccordion()) return false
    gsap.killTweensOf(links)
    gsap.set(links, { x: 0 })
    const box = linksRow.getBoundingClientRect()
    rowGap = parseFloat(getComputedStyle(linksRow).columnGap) || 0
    rowW = box.width
    links.forEach((link, i) => {
      const r = link.getBoundingClientRect()
      natX[i] = r.left - box.left
      linkW[i] = r.width
    })
    // The spacing between slots is MEASURED off the natural layout, not read from
    // `column-gap`: the Designer can space these links with a flex gap, with margins or with
    // inline whitespace, and only the first of the three shows up in the computed style — the
    // other two would resolve to 0 and the names would jam together. Median, so one odd
    // margin can't skew it.
    const gaps = []
    for (let i = 1; i < links.length; i++) {
      const g = natX[i] - (natX[i - 1] + linkW[i - 1])
      if (g >= 0) gaps.push(g)
    }
    gaps.sort((a, b) => a - b)
    rowGap = Math.max(
      MIN_GAP,
      gaps.length
        ? gaps[Math.floor(gaps.length / 2)]
        : parseFloat(getComputedStyle(linksRow).columnGap) || 0
    )
    // The mask starts where the WIDEST run of fully-visible names ends — widest, not the
    // current one, because the run's width changes as the row rotates and a fade pinned to
    // one arrangement would eat the tail of a name in another.
    slots = fitSlots()
    linksRow.style.setProperty(
      '--tt-fade',
      `${Math.round(Math.max(widestRun() + (natX[0] || 0), rowW - FADE_MAX))}px`
    )
    warnIfCramped()
    if (DEBUG) logRow()
    return rowW > 0
  }

  // How wide a run of n names is at its WORST — the widest arrangement the rotation can put
  // on screen, not the one showing right now. Everything about the window is sized off the
  // worst case, so nothing changes shape as the row turns.
  function runWidth(n) {
    let worst = 0
    for (let a = 0; a < count; a++) {
      let w = 0
      for (let s = 0; s < n; s++) w += linkW[(a + s) % count] + (s ? rowGap : 0)
      worst = Math.max(worst, w)
    }
    return worst
  }
  const widestRun = () => runWidth(slots)

  // The most names that can sit in the clear while STILL leaving PEEK_MIN of the next one
  // showing. VISIBLE_SLOTS is the ceiling; the peek is the floor and always wins.
  function fitSlots() {
    const room = rowW - (natX[0] || 0) - PEEK_MIN
    const ceiling = Math.min(VISIBLE_SLOTS, Math.max(1, count - 1))
    for (let n = ceiling; n > 1; n--) if (runWidth(n) + rowGap <= room) return n
    return 1
  }

  let warnedCramped = false
  function warnIfCramped() {
    const ceiling = Math.min(VISIBLE_SLOTS, Math.max(1, count - 1))
    if (warnedCramped || slots >= ceiling) return
    warnedCramped = true
    console.warn(
      `[tabs-team] showing ${slots} names instead of ${ceiling}: fitting ${ceiling} and still peeking needs ${Math.round(runWidth(ceiling) + rowGap + PEEK_MIN + (natX[0] || 0))}px, and .tabs-team_tabs-links is ${Math.round(rowW)}px. Widen the row or lower --tabs-team-gap.`
    )
  }

  function logRow() {
    const cs = getComputedStyle(linksRow)
    dbg({
      what: 'window',
      links: links.length,
      panels: panels.length,
      images: images.length,
      count,
      slots,
      ceiling: Math.min(VISIBLE_SLOTS, Math.max(1, count - 1)),
      peekMin: PEEK_MIN,
      rowW: Math.round(rowW),
      gapMeasured: Math.round(rowGap),
      gapComputed: cs.columnGap,
      display: cs.display,
      justify: cs.justifyContent,
      overflowX: cs.overflowX,
      widestRun: Math.round(widestRun()),
      names: links.map((l, i) => ({
        i,
        name: (l.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28),
        natX: Math.round(natX[i]),
        width: Math.round(linkW[i]),
        hasPanel: !!panels[i],
        hasImage: !!images[i],
      })),
    })
    console.log(
      `%c[tabs-team] window · ${links.length} links / ${panels.length} blocks / ${images.length} images · count ${count}`,
      'color:#c79a4b;font-weight:bold'
    )
    console.log(
      `  row ${Math.round(rowW)}px · gap measured ${Math.round(rowGap)}px (computed column-gap ${cs.columnGap}) · display ${cs.display} · justify ${cs.justifyContent} · overflow ${cs.overflowX} · widest run ${Math.round(widestRun())}px`
    )
    console.table(
      links.map((l, i) => ({
        i,
        name: (l.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28),
        natX: Math.round(natX[i]),
        width: Math.round(linkW[i]),
        hasPanel: !!panels[i],
        hasImage: !!images[i],
      }))
    )
  }

  // Where every link belongs for a given active tab. Slot 0 is the active one, pinned to the
  // row's content start; slots keep accumulating past the window so a link waiting off-screen
  // sits where the strip would actually continue — clamped past the right edge so it's always
  // clipped, whatever the column width.
  function rowTargets(active) {
    const t = new Array(links.length)
    const off = rowW + rowGap
    let x = natX[0] || 0
    for (let s = 0; s < count; s++) {
      const i = (active + s) % count
      // `slots` names sit in the clear. The one after them is the PEEK: it stands exactly
      // where the strip continues, half inside the row, and the mask dissolves it — that
      // half-name is the whole "there are more of us" signal. Anything past it is parked
      // beyond the right edge with nothing showing.
      const px = s <= slots ? x : Math.max(x, off)
      t[i] = { x: px, slot: s }
      x = px + linkW[i] + rowGap
    }
    // A link with no panel to pair with is never cycled — park it out of the way.
    for (let i = count; i < links.length; i++)
      t[i] = { x: Math.max(x, off), slot: count }
    return t
  }

  // Instant placement — load, resize, reduced motion, and the way back from the accordion.
  function placeRow(active) {
    if (!linksRow || inAccordion() || !measureRow()) return
    const t = rowTargets(active)
    links.forEach((link, i) => {
      // opacity, NOT autoAlpha: visibility:hidden would drop a parked link out of the tab
      // order, and a member waiting off-screen still has to be reachable by keyboard.
      gsap.set(link, {
        x: t[i].x - natX[i],
        opacity: t[i].slot <= slots ? 1 : 0,
      })
    })
    rowSlots = t
  }

  // Rotate the row into `next`, as tweens on the switch's own timeline at position 0 — the
  // row has to read as one strip shifting, not as N elements animating on their own.
  function rotateRow(tl, next) {
    if (!linksRow || inAccordion() || !rowSlots) return
    const prev = rowSlots
    const now = rowTargets(next)
    const steps = (next - activeIndex + count) % count
    const exitAt = ROTATE.duration * EXIT_SHARE
    const backAt = ROTATE.duration - exitAt
    const offRight = rowW + rowGap
    const trace = []

    links.forEach((link, i) => {
      const dx = now[i].x - natX[i]
      // Three regions, not two: `clear` (a name in the open row), `peek` (the one dissolving
      // into the mask at the right edge) and parked. What a link is allowed to do on a
      // rotation depends on which of the three it lands in.
      const wasShown = prev[i].slot <= slots
      const isShown = now[i].slot <= slots
      const isClear = now[i].slot < slots
      // Wrapped past the end of the order: it can never slide sideways across the tabs that
      // stayed put — it has to leave through the LEFT edge.
      const wraps = i < count && prev[i].slot < steps

      if (DEBUG)
        trace.push({
          i,
          name: (link.textContent || '')
            .trim()
            .replace(/\s+/g, ' ')
            .slice(0, 24),
          slot: `${prev[i].slot}→${now[i].slot}`,
          x: `${Math.round(prev[i].x)}→${Math.round(now[i].x)}`,
          move: wraps
            ? isClear
              ? 'exit-left + around'
              : 'exit-left + re-form'
            : !wasShown && isShown
              ? 'enter from right'
              : 'slide',
          dx: Math.round(now[i].x - prev[i].x),
        })

      if (wraps) {
        tl.to(
          link,
          {
            x: -(natX[i] + linkW[i] + rowGap),
            duration: exitAt,
            ease: 'power2.in',
          },
          0
        )
        tl.to(
          link,
          { opacity: 0, duration: exitAt * FADE_SHARE, ease: 'power1.in' },
          0
        )
        if (isClear) {
          // It has to land in the OPEN part of the row, where materialising out of nothing
          // would be seen — so bring it round the outside instead. Only reachable on a
          // multi-step click with few members. fromTo, not set + to: the start value is
          // declared rather than read back off a zero-duration tween at the same position.
          tl.fromTo(
            link,
            { x: offRight - natX[i] },
            { x: dx, duration: backAt, ease: 'power2.out' },
            exitAt
          )
          tl.to(
            link,
            { opacity: 1, duration: backAt * FADE_SHARE, ease: 'power1.out' },
            exitAt
          )
          return
        }
        // It lands under the mask (the peek) or off-screen, so it just re-forms there — no
        // trip around the outside. Travelling would make the whole row read as scrambling
        // once per cycle, which is exactly what it used to do.
        tl.set(link, { x: dx }, exitAt)
        if (isShown)
          tl.to(
            link,
            { opacity: 1, duration: backAt * FADE_SHARE, ease: 'power1.out' },
            exitAt
          )
        return
      }

      tl.to(link, { x: dx, ...ROTATE }, 0)
      if (wasShown === isShown) return
      tl.to(
        link,
        {
          opacity: isShown ? 1 : 0,
          duration: ROTATE.duration * FADE_SHARE,
          ease: isShown ? 'power1.out' : 'power1.in',
        },
        0
      )
    })
    if (DEBUG) {
      dbg({ what: 'rotate', from: activeIndex, to: next, steps, trace })
      console.log(
        `%c[tabs-team] rotate ${activeIndex} → ${next} (${steps} step${steps > 1 ? 's' : ''})`,
        'color:#c79a4b'
      )
      console.table(trace)
    }
    rowSlots = now
  }

  // Accessibility scaffolding — tablist / tab / tabpanel with roving tabindex.
  linksRow?.setAttribute('role', 'tablist')
  links.forEach((link, i) => {
    const panel = panels[i]
    const linkId = link.id || `tabs-team-tab-${i}`
    const panelId = panel?.id || `tabs-team-panel-${i}`
    link.id = linkId
    link.setAttribute('role', 'tab')
    link.setAttribute('tabindex', '-1')
    if (!panel) return
    panel.id = panelId
    link.setAttribute('aria-controls', panelId)
    panel.setAttribute('role', 'tabpanel')
    panel.setAttribute('aria-labelledby', linkId)
  })

  // The underline is the active tab's alone: with the active pinned to slot 0, a grey track
  // under every name stops communicating anything. Everyone else loses track and fill outright
  // — no fade-out, because the link itself is already leaving.
  const setTracks = (index) => {
    bars.forEach((bar, k) => {
      if (!bar) return
      bar.parentElement?.classList.toggle(TRACK_CLASS, k === index)
      if (k !== index) clearFill(bar)
    })
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
    pendingIndex = index

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

    setTracks(index)
    setCounter(index)
    fitPanels(index) // the fill + the clock are startProgress's, called right after this

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
    rotateRow(tl, index) // reads activeIndex — must run before onComplete moves it
    crossfadeImage(tl, index)
    if (outPanel) tl.to(outPanel, OUT_FADE, 0)
    const at = outPanel ? 0.15 : 0
    if (parts[index].content.length)
      tl.fromTo(parts[index].content, REVEAL_FROM, CONTENT_TO, at)
  }

  // Reduced motion: no de-blur, no crossfade, no rotation, no autoplay. Everything snaps.
  function switchTabInstant(index) {
    if (index === activeIndex) return
    resetToTab(index)
  }

  // The underline IS the clock: the active bar grows floor→1 over that tab's reading time and
  // its completion advances the tab. Being a tween is the point — a lock can pause it.
  function startProgress(index) {
    if (progressTl) progressTl.kill()
    setTracks(index)
    const bar = bars[index]
    if (bar) armFill(bar)
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

  // Click / keyboard: rotate straight to that tab AND lock it — however many slots away it
  // is, in one movement. Activating the locked tab releases it.
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
  // paint, no CLS), and the row placed with that tab in slot 0. Used on load, and again when
  // the accordion hands the section back.
  function resetToTab(index) {
    activeIndex = index
    pendingIndex = index
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
    setTracks(index)
    setCounter(index)
    placeRow(index)
    fitPanels(index, true) // no collapse animation on load
  }

  gsap.set(bars.filter(Boolean), { scaleX: 0, transformOrigin: 'left center' })
  resetToTab(0)
  // Webfonts land after init and reflow the copy — and the names' widths ARE the slot
  // geometry, so the row has to be re-measured with them too.
  document.fonts?.ready.then(() => {
    placeRow(pendingIndex)
    fitPanels(activeIndex, true)
  })

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
      // The row is gone: a link now lives in a drawer header and must carry none of its slot
      // transform or its parked opacity.
      gsap.killTweensOf(links)
      gsap.set(links, { clearProps: 'transform,opacity' })
      rowSlots = null
      bars.forEach((bar) => {
        clearFill(bar) // the drawer's hairline is the state indicator
        bar?.parentElement?.classList.remove(TRACK_CLASS)
      })
    },
    onOpen(index) {
      accordionOpen = index
      activeIndex = index
      pendingIndex = index
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
      // disable() drops .is-accordion before calling this, so the row is measurable again.
      resetToTab(wasOpen >= 0 ? wasOpen : 0)
      if (started) startProgress(activeIndex)
    },
  })

  // Click — rotate to that tab and lock the cycle on it (second click releases).
  const onClick = links.map((link, i) => {
    const handler = () => activateTab(i)
    link.addEventListener('click', handler)
    return handler
  })

  // Keyboard — arrow/Home/End move focus + activate; Enter/Space activate. Every explicit
  // activation locks, same as a click. Home/End address the AUTHORIAL order, not the visible
  // slots: the window is presentation, the DOM order is the list.
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
    // Rotate FIRST, then move focus: a link waiting off-screen would otherwise take the focus
    // ring outside the clipped row. preventScroll keeps the viewport from scrolling to it.
    activateTab(next)
    links[next].focus({ preventScroll: true })
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
    // Column width decides how the copy wraps (so the active panel's height moves with it) and
    // the row's own width decides the slot geometry — both are re-measured from scratch.
    refit() {
      placeRow(pendingIndex)
      fitPanels(pendingIndex, true)
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
