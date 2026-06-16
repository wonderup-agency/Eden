/*
  Component: share · data-component="share"
  Blog-post share actions: copy the post URL to the clipboard and open a Bluesky compose intent.
  CSS → ./styles/share.css (paste into Webflow head — the "Copied!" tooltip) · Docs → .claude/rules/components/share.md
*/

const COPIED_RESET = 2000 // ms the .is-copied state + "Copied!" label stay on
const COPIED_LABEL = 'Copied!'
const BLUESKY_INTENT = 'https://bsky.app/intent/compose'

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='share']
 */
export default function (elements) {
  elements.forEach((root) => {
    // URL + text default to the current page; override per-post with data-share-url / data-share-text.
    const url = root.getAttribute('data-share-url') || window.location.href
    const text = root.getAttribute('data-share-text') || document.title

    setupCopy(root, url)
    setupBluesky(root, url, text)
  })
}

// Copy button — writes the URL to the clipboard, then shows the "Copied!" tooltip
// (+ flashes .is-copied and swaps an optional [data-share-label]).
function setupCopy(root, url) {
  const btn = root.querySelector('[data-share="copy"]')
  if (!btn) return

  const label = btn.querySelector('[data-share-label]')
  const original = label?.textContent
  const tooltip = ensureTooltip(btn)
  let resetTimer = null

  btn.addEventListener('click', async (e) => {
    e.preventDefault()
    try {
      await copyToClipboard(url)
    } catch {
      console.warn('[share] clipboard write failed')
      return
    }

    btn.classList.add('is-copied')
    if (label) label.textContent = COPIED_LABEL
    tooltip.classList.add('is-visible')

    window.clearTimeout(resetTimer)
    resetTimer = window.setTimeout(() => {
      btn.classList.remove('is-copied')
      if (label) label.textContent = original
      tooltip.classList.remove('is-visible')
    }, COPIED_RESET)
  })
}

// Use a designer-provided [data-share-tooltip] if present, else inject a default
// .share_tooltip (styled by ./styles/share.css). Visibility is toggled via .is-visible.
function ensureTooltip(btn) {
  let tip = btn.querySelector('[data-share-tooltip]')
  if (!tip) {
    tip = document.createElement('span')
    tip.className = 'share_tooltip'
    tip.textContent = COPIED_LABEL
    btn.appendChild(tip)
  }
  tip.setAttribute('role', 'status')
  tip.setAttribute('aria-live', 'polite')
  return tip
}

// Bluesky button — opens the compose intent prefilled with "<title> <url>" in a new tab.
function setupBluesky(root, url, text) {
  const btn = root.querySelector('[data-share="bluesky"]')
  if (!btn) return

  btn.addEventListener('click', (e) => {
    e.preventDefault()
    const composed = `${text} ${url}`.trim()
    const intent = `${BLUESKY_INTENT}?text=${encodeURIComponent(composed)}`
    window.open(intent, '_blank', 'noopener,noreferrer')
  })
}

// Clipboard API with a legacy execCommand fallback (non-secure contexts / older browsers).
async function copyToClipboard(value) {
  if (window.navigator.clipboard?.writeText) {
    return window.navigator.clipboard.writeText(value)
  }
  const ta = document.createElement('textarea')
  ta.value = value
  ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
  document.body.appendChild(ta)
  ta.select()
  const ok = document.execCommand('copy')
  ta.remove()
  if (!ok) throw new Error('execCommand copy failed')
}
