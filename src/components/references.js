/*
  Component: references · data-component="references"
  Academic citations: matches body <sup>n</sup> markers to a separate references Rich Text
  (the author types the number at the start of each reference — that's the matching key),
  and wires bidirectional anchor links (cite ↔ reference) with "last-read" back-links.
  Scroll is delegated to the global anchor→Lenis bridge (global.js); this only owns matching + state.
  CSS → ./styles/references.css (paste into Webflow head) · Docs → .claude/rules/components/references.md
*/

const BACKLINK_LABEL = 'Go to Citation'
const ACTIVE_RESET = 1600 // ms the .is-active highlight stays on the jump target

let instanceSeq = 0

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='references']
 */
export default function (elements) {
  elements.forEach((root) => setupReferences(root))
}

function setupReferences(root) {
  const list = root.querySelector('[data-references-list]')
  if (!list) {
    console.warn('[references] missing [data-references-list] — skipping')
    return
  }
  // The body lives outside the wrapper by design — single documented document-level lookup.
  const body = document.querySelector('[data-references-body]')

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
      if (back && root.contains(back)) {
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

    // Wrap the reference text so the item can be a flex row (back-link pushed right).
    const content = document.createElement('div')
    content.className = 'references_content'
    while (block.firstChild) content.appendChild(block.firstChild)
    block.appendChild(content)

    const backlink = document.createElement('a')
    backlink.className = 'references_backlink'
    backlink.textContent = BACKLINK_LABEL
    backlink.setAttribute('role', 'doc-backlink')
    backlink.setAttribute('aria-label', `Back to citation ${n}`)
    block.appendChild(backlink)

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

// "1", "1,2", "1, 2" → [1, 2]. Non-numeric sups are ignored.
function parseNumbers(text) {
  return text
    .split(/[,\s]+/)
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isInteger(n))
}

function flagActive(el) {
  el.classList.add('is-active')
  window.setTimeout(() => el.classList.remove('is-active'), ACTIVE_RESET)
}
