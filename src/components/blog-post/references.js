/*
  Module: references — loaded by the blog-post orchestrator (data-component="blog-post")
  Academic citations: matches body <sup>n</sup> markers to a separate references Rich Text
  (the author types the number at the start of each reference — that's the matching key),
  and wires bidirectional anchor links (cite ↔ reference) with "last-read" back-links.
  Scroll is delegated to the global anchor→Lenis bridge (global.js); this only owns matching + state.
  CSS → ./styles/references.css (paste into Webflow head) · Docs → .claude/rules/components/references.md
*/

const BACKLINK_LABEL = 'Go to Citation'
const ACTIVE_RESET = 1600 // ms the .is-active highlight stays on the jump target

// Scraped scientific articles use <sup> for many things besides citations (chemistry,
// figure/table numbers, time ranges). These guards skip the obvious non-citations so we
// never link e.g. "18–24 h" to reference 18 — see .md → "Which <sup> become citations".
const NON_CITE_WORD = // a cross-ref word right before the marker → not a citation
  /^(fig|figs|figure|figures|table|tables|eq|eqn|equation|ref|refs|reaction|reactions|section|sections|step|steps|lane|lanes|panel|panels|chapter|scheme)$/i
const UNIT_AFTER = // a measurement unit right after the marker → a range/quantity, not a cite
  /^[.,)\s]*\d*\.?\d*\s*(h|hr|hrs|min|mins|sec|secs|d|days?|weeks?|months?|years?|nm|µm|um|mm|cm|m|mM|nM|µM|uM|M|mL|ml|µL|uL|L|mg|µg|ug|ng|g|kg|bp|kb|rpm|°c|%)\b/i

let instanceSeq = 0

/**
 * @param {HTMLElement} root - A blog-post article root (holds the list + the body)
 */
export function initReferences(root) {
  setupReferences(root)
}

function setupReferences(root) {
  // The references block is often a sibling section outside the article root (a footer
  // block in the Webflow template), so fall back to document scope — same as the body.
  const list =
    root.querySelector('[data-references-list]') ||
    document.querySelector('[data-references-list]')
  if (!list) {
    console.warn('[references] missing [data-references-list] — skipping')
    return
  }
  // Body is normally inside the article root; fall back to document scope for safety.
  const body =
    root.querySelector('[data-references-body]') ||
    document.querySelector('[data-references-body]')

  // Namespace ids per instance so multiple components on one page never collide.
  const ns = `r${instanceSeq++}`

  const items = buildReferences(list, ns)
  if (!items.size) {
    console.warn('[references] no references found in [data-references-list]')
    return
  }
  if (body) buildCitations(body, items, ns)

  // Each back-link points to the last-read citation (default: first occurrence; none → hidden).
  items.forEach((item, n) => {
    if (!item.citations.length) {
      item.backlink.setAttribute('hidden', '')
      return
    }
    item.lastRead = item.citations[0]
    item.backlink.setAttribute('href', `#${item.lastRead.id}`)
    item.backlink.dataset.refN = n
    item.backlink.dataset.refNs = ns // scope clicks to this instance (list may be outside root)
  })

  // One delegated capture-phase listener: records "last read" + moves focus/highlight.
  // Capture + same-node siblings means the global bridge's stopPropagation doesn't suppress
  // us, and we run after its scroll. No-ops when the click isn't ours.
  document.addEventListener(
    'click',
    (e) => {
      const cite = e.target.closest('.references_cite')
      if (cite && cite.id.startsWith(`${ns}-`)) {
        const item = items.get(Number(cite.dataset.refN))
        if (!item) return
        item.lastRead =
          item.citations.find((c) => c.id === cite.id) || item.lastRead
        item.backlink.setAttribute('href', `#${cite.id}`)
        flagActive(item.block) // highlight the reference we jumped to
        item.block.focus({ preventScroll: true })
        return
      }
      const back = e.target.closest('.references_backlink')
      if (back && back.dataset.refNs === ns) {
        const occ = items.get(Number(back.dataset.refN))?.lastRead
        if (!occ) return
        if (occ.word) flagActive(occ.word) // highlight the word before the marker
        document.getElementById(occ.id)?.focus?.({ preventScroll: true })
      }
    },
    true
  )
}

// Read the author-typed leading number of each reference block (matching key), wrap it in a
// badge span, inject the back-link, and classify the author's links.
function buildReferences(list, ns) {
  const items = new Map()
  const blocks = Array.from(list.children).filter((el) =>
    /^(P|LI|DIV)$/.test(el.tagName)
  )

  blocks.forEach((block, i) => {
    if (block.classList.contains('references_item')) return // idempotent re-init guard
    block.classList.add('references_item')

    const n = wrapLeadingNumber(block) ?? i + 1
    if (items.has(n))
      console.warn(`[references] duplicate reference number ${n}`)

    block.id = `${ns}-ref-${n}`
    block.setAttribute('tabindex', '-1')
    block.setAttribute('role', 'doc-biblioentry')

    classifyLinks(block)

    // Layout: [number column] [content column]. Move everything into content, then lift
    // the leading number back out as its own left column, and stack the back-link under the text.
    const content = document.createElement('div')
    content.className = 'references_content'
    while (block.firstChild) content.appendChild(block.firstChild)

    const numberEl = content.querySelector('.references_number')
    if (numberEl) block.appendChild(numberEl) // left column, out of the text flow
    block.appendChild(content)

    const backlink = document.createElement('a')
    backlink.className = 'references_backlink'
    backlink.textContent = BACKLINK_LABEL
    backlink.setAttribute('role', 'doc-backlink')
    backlink.setAttribute('aria-label', `Back to citation ${n}`)
    content.appendChild(backlink) // below the reference text

    items.set(n, { block, backlink, citations: [], lastRead: null })
  })

  return items
}

// Wrap the leading "1" / "1." digits of a block in .references_number and return the number.
// Returns null if the block doesn't start with digits (caller falls back to index).
function wrapLeadingNumber(block) {
  const node = firstTextNode(block)
  if (!node) return null
  const m = node.nodeValue.match(/^(\s*)(\d+)/)
  if (!m) return null

  const digits = node.splitText(m[1].length) // drop leading whitespace
  digits.splitText(m[2].length) // split off the rest after the digits
  const span = document.createElement('span')
  span.className = 'references_number'
  span.setAttribute('aria-hidden', 'true')
  span.textContent = digits.nodeValue
  digits.replaceWith(span)
  return Number(m[2])
}

// First non-empty text node, descending into inline elements.
function firstTextNode(el) {
  for (const node of el.childNodes) {
    if (node.nodeType === 3 && node.nodeValue.trim()) return node
    if (node.nodeType === 1) {
      const found = firstTextNode(node)
      if (found) return found
    }
  }
  return null
}

// Author writes plain inline links; tag them by host so they can be styled distinctly.
function classifyLinks(block) {
  block.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') || ''
    if (/pubmed/i.test(href)) a.classList.add('is-pubmed')
    else if (/scholar\.google/i.test(href)) a.classList.add('is-scholar')
    else a.classList.add('is-view')
  })
}

// Scan the body for <sup> markers, split grouped numbers, turn each into a cite anchor, and
// wrap the word before the marker so it can be highlighted when the reader jumps back.
function buildCitations(body, items, ns) {
  const counts = new Map()

  body.querySelectorAll('sup').forEach((sup) => {
    if (sup.querySelector('a')) return // already enhanced
    if (!looksLikeCitation(sup)) return // skip figures/tables/units/chemistry superscripts
    const nums = parseNumbers(sup.textContent)
    if (!nums.length) return

    const word = wrapPrecedingWord(sup)
    const frag = document.createDocumentFragment()
    nums.forEach((n, idx) => {
      const item = items.get(n)
      if (!item) {
        frag.appendChild(document.createTextNode(String(n)))
        console.warn(`[references] <sup>${n}</sup> has no matching reference`)
      } else {
        const k = (counts.get(n) || 0) + 1
        counts.set(n, k)
        const id = `${ns}-cite-${n}-${k}`
        const a = document.createElement('a')
        a.className = 'references_cite'
        a.id = id
        a.href = `#${item.block.id}`
        a.dataset.refN = n
        a.textContent = n
        a.setAttribute('aria-label', `Go to reference ${n}`)
        item.citations.push({ id, word })
        frag.appendChild(a)
      }
      if (idx < nums.length - 1) frag.appendChild(document.createTextNode(','))
    })

    sup.textContent = ''
    sup.appendChild(frag)
  })
}

// A <sup> is a citation unless it's clearly a cross-reference (preceded by Figure/Table/…)
// or a quantity (followed by a unit like "h"/"mM"). High precision on purpose: when unsure
// we treat it as a citation, but numbers with no matching reference stay plain text anyway.
function looksLikeCitation(sup) {
  const prev = sup.previousSibling
  if (prev && prev.nodeType === 3) {
    const word = prev.nodeValue.match(/([\p{L}]+)[\s(]*$/u) // last word before the marker
    if (word && NON_CITE_WORD.test(word[1])) return false
  }
  const next = sup.nextSibling
  if (next && next.nodeType === 3 && UNIT_AFTER.test(next.nodeValue))
    return false
  return true
}

// Wrap the last word of the text node right before a <sup> in .references_cited-word.
function wrapPrecedingWord(sup) {
  const prev = sup.previousSibling
  if (!prev || prev.nodeType !== 3) return null
  const m = prev.nodeValue.match(/(\S+)(\s*)$/)
  if (!m) return null

  const word = prev.splitText(prev.nodeValue.length - m[0].length)
  if (m[2]) word.splitText(m[1].length) // keep the trailing whitespace outside the span
  const span = document.createElement('span')
  span.className = 'references_cited-word'
  span.textContent = word.nodeValue
  word.replaceWith(span)
  return span
}

// "1", "1,2", "1, 2" → [1, 2]. Ranges expand: "5–7" (hyphen / en- / em-dash) → [5, 6, 7],
// as academic citations are written both ways. Non-numeric tokens are ignored.
function parseNumbers(text) {
  const out = []
  text.split(/[,\s]+/).forEach((tok) => {
    const range = tok.match(/^(\d+)\s*[–—-]\s*(\d+)$/)
    if (range) {
      const a = +range[1]
      const b = +range[2]
      if (b >= a && b - a <= 50) for (let n = a; n <= b; n++) out.push(n)
      else out.push(a)
    } else {
      const n = parseInt(tok, 10)
      if (Number.isInteger(n)) out.push(n)
    }
  })
  return out
}

function flagActive(el) {
  el.classList.add('is-active')
  window.setTimeout(() => el.classList.remove('is-active'), ACTIVE_RESET)
}
