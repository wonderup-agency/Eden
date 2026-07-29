/*
  Module: table-collapse — loaded by the blog-post orchestrator (data-component="blog-post")
  Collapses long article tables to the first few rows behind a "Show more" toggle
  (with a fade), auto-applied to every <table> in the article root. GSAP height anim
  when present, instant otherwise.
  CSS → ./styles/table-collapse.css (bundled via src/styles.js) · Docs → .claude/rules/components/table-collapse.md
*/

const VISIBLE_ROWS = 6 // data rows shown before the fold
const MIN_HIDDEN = 2 // only collapse when it would hide at least this many rows
const EXPAND_DURATION = 0.5
const EXPAND_EASE = 'power2.inOut'
const LABEL_MORE = 'Show more'
const LABEL_LESS = 'Show less'

let uid = 0

/**
 * @param {HTMLElement} root - A blog-post article root (all its <table> are processed)
 * @returns {{resize: () => void} | null}
 */
export function initTableCollapse(root) {
  const gsap = window.gsap
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const animate = !!gsap && !reduce

  const setups = []
  root.querySelectorAll('table').forEach((table) => {
    try {
      const s = build(table, animate, gsap)
      if (s) setups.push(s)
    } catch (err) {
      console.error('[table-collapse] setup failed', err)
    }
  })

  if (!setups.length) return null

  return {
    resize() {
      // Recompute the fold height for collapsed tables (row heights reflow on resize).
      setups.forEach((s) => {
        if (s.collapsed) measure(s)
      })
    },
  }
}

function build(table, animate, gsap) {
  if (table.closest('.table-collapse_wrap')) return null // already enhanced

  const rows = table.querySelectorAll('tr')
  const theadRows = table.querySelectorAll('thead tr').length
  const cutoff = theadRows + VISIBLE_ROWS
  if (rows.length < cutoff + MIN_HIDDEN) return null // short enough — leave it alone

  const wrap = document.createElement('div')
  wrap.className = 'table-collapse_wrap is-collapsed'
  const wrapId = `table-collapse-${++uid}`
  wrap.id = wrapId
  table.parentNode.insertBefore(wrap, table)
  wrap.appendChild(table)

  const fade = document.createElement('div')
  fade.className = 'table-collapse_fade'
  fade.setAttribute('aria-hidden', 'true')
  wrap.appendChild(fade)

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'table-collapse_toggle'
  button.textContent = LABEL_MORE
  button.setAttribute('aria-expanded', 'false')
  button.setAttribute('aria-controls', wrapId)
  wrap.after(button)

  const s = {
    table,
    wrap,
    fade,
    button,
    cutoff,
    collapsed: true,
    animate,
    gsap,
  }
  measure(s)
  button.addEventListener('click', () => toggle(s))
  return s
}

// Height (px) that shows the header + the first VISIBLE_ROWS rows, clipping the rest.
function measure(s) {
  s.wrap.style.maxHeight = 'none'
  const wrapTop = s.wrap.getBoundingClientRect().top
  const cutRow = s.table.querySelectorAll('tr')[s.cutoff]
  s.collapsedHeight = Math.round(cutRow.getBoundingClientRect().top - wrapTop)
  s.wrap.style.maxHeight = s.collapsed ? `${s.collapsedHeight}px` : 'none'
}

function toggle(s) {
  s.collapsed = !s.collapsed
  s.button.textContent = s.collapsed ? LABEL_MORE : LABEL_LESS
  s.button.setAttribute('aria-expanded', String(!s.collapsed))
  s.wrap.classList.toggle('is-collapsed', s.collapsed)

  const full = s.wrap.scrollHeight

  if (!s.animate) {
    s.wrap.style.maxHeight = s.collapsed ? `${s.collapsedHeight}px` : 'none'
    return
  }

  s.gsap.killTweensOf(s.wrap)
  s.gsap.fromTo(
    s.wrap,
    { maxHeight: s.collapsed ? full : s.collapsedHeight },
    {
      maxHeight: s.collapsed ? s.collapsedHeight : full,
      duration: EXPAND_DURATION,
      ease: EXPAND_EASE,
      // Free the open box so a wider table (horizontal scroll) can't clip vertically.
      onComplete: () => {
        if (!s.collapsed) s.wrap.style.maxHeight = 'none'
      },
    }
  )
}
