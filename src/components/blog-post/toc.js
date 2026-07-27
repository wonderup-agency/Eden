/*
  Module: toc — loaded by the blog-post orchestrator (data-component="blog-post")
  Table of contents built from the article body: indexes the summary blocks + h2/h3/h4,
  plus the out-of-body sections ([data-toc-extra] + the references block), injects
  accordion links (own toc_* classes, styled in
  toc.css), drives a scrollspy .current + auto-expanding branch. Smooth scroll is the
  global Lenis anchor bridge (links are plain <a href="#id">).
  CSS → ./styles/toc.css (paste into Webflow head) · Docs → .claude/rules/components/toc.md
*/

const LEVELS = [2, 3, 4] // heading levels to index (h2/h3/h4)
const SUMMARY_SELECTOR = '.content27_summary' // top-level pseudo-headings (Summary, Key points)
const EXTRA_SELECTOR = '[data-toc-extra]' // sections outside the body (Supplemental files…)
const REFERENCES_LABEL = 'References' // fallback label for the auto-indexed references block
const ID_PREFIX = 'toc-'
const ACTIVE = 'current' // class on the active link (matches the Webflow template)
const SPY_GAP = 24 // px below the nav — the floor of the activation line
const ACTIVATION = 0.3 // + this fraction of the viewport, so a heading flips active as it
// reaches ~30% down the screen (not only when it reaches the nav — that read as "late")
const EXPAND_DURATION = 0.4
const EXPAND_EASE = 'power2.inOut'

const HEADING_SELECTOR = LEVELS.map((l) => `h${l}`).join(', ')

/**
 * @param {HTMLElement} root - A blog-post article root
 * @returns {{resize: () => void} | null}
 */
export function initToc(root) {
  const inst = setup(root)
  return inst ? { resize: () => inst.refresh() } : null
}

function setup(root) {
  try {
    const list =
      root.querySelector('[data-toc-list]') ||
      root.querySelector('.content27_link-content')
    const body =
      root.querySelector('[data-toc-body]') ||
      root.querySelector('.blog-post_body')

    if (!list || !body) {
      console.warn('[toc] missing list container or body — skipping', root)
      return null
    }

    // If the TOC is made scrollable in the Designer (max-height + overflow), stop Lenis
    // from hijacking the wheel over it so it scrolls natively. Lenis honors
    // [data-lenis-prevent] on the wheel target or any ancestor of it.
    markLenisPrevent(root, list)

    const gsap = window.gsap
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const animate = !!gsap && !reduce

    const flat = indexContent(body)
    if (!flat.length) {
      console.warn('[toc] no headings found in the body — skipping', root)
      return null
    }

    const entries = []
    list.replaceChildren() // drop the Webflow template links
    render(buildTree(flat), list, entries)

    // Accordion starts collapsed (animated mode only); scrollspy opens the active branch.
    if (animate) {
      entries.forEach((e) => {
        if (e.childrenBox) {
          e.childrenBox._open = false
          gsap.set(e.childrenBox, { height: 0 })
        }
      })
    }

    let currentId = null

    function setActive(id) {
      if (id === currentId) return
      currentId = id

      entries.forEach((e) => e.link.classList.toggle(ACTIVE, e.id === id))

      if (!animate) return // fallback: everything stays expanded

      const active = entries.find((e) => e.id === id)
      const open = new Set()
      if (active) {
        if (active.childrenBox) open.add(active.childrenBox)
        let el = active.wrapper.parentElement
        while (el && el !== list) {
          if (el.matches('[data-toc-children]')) open.add(el)
          el = el.parentElement
        }
      }
      entries.forEach((e) => {
        if (e.childrenBox)
          toggleBox(e.childrenBox, open.has(e.childrenBox), gsap)
      })
    }

    // The line below the nav where a heading flips active: nav height + a small floor
    // + a slice of the viewport so it activates as the heading nears the top third.
    function navOffset() {
      const nav = document.querySelector('[data-component="nav"]')
      const navH = nav?.getBoundingClientRect().height || 0
      return navH + SPY_GAP + window.innerHeight * ACTIVATION
    }

    function computeActive() {
      // Bottom guard: near the end, the last headings never cross the line — force the
      // last one active so it doesn't stick on a middle heading at the foot of the page.
      const atBottom =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 2
      if (atBottom) {
        setActive(entries[entries.length - 1].id)
        return
      }

      const off = navOffset()
      let id = entries[0].id
      for (const e of entries) {
        if (e.target.getBoundingClientRect().top - off <= 1) id = e.id
        else break
      }
      setActive(id)
    }

    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      window.requestAnimationFrame(() => {
        computeActive()
        ticking = false
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })

    computeActive()

    return { refresh: computeActive }
  } catch (err) {
    console.error('[toc] init failed', err)
    return null
  }
}

// Find the TOC's scroll container (nearest ancestor of the list, up to the root, whose
// computed overflow-y scrolls) and mark it [data-lenis-prevent] so Lenis lets it scroll
// natively. Only marks a real scroll container — never the list when it isn't scrollable
// (that would create a dead zone where the wheel scrolls nothing).
function markLenisPrevent(root, list) {
  let el = list
  while (el && el !== root) {
    const oy = getComputedStyle(el).overflowY
    if (oy === 'auto' || oy === 'scroll') {
      el.setAttribute('data-lenis-prevent', '')
      return
    }
    el = el.parentElement
  }
}

// Walk the body (summary blocks + headings), then add the extra sections that live
// outside it (Supplemental files, References…), and sort everything into document order.
function indexContent(body) {
  const usedIds = new Set()
  const seen = new Set()
  const items = []

  const push = (el, label, level) => {
    if (!label || seen.has(el)) return
    seen.add(el)
    el.id = el.id || uniqueId(label, usedIds)
    el.setAttribute('data-toc-target', '')
    items.push({ id: el.id, label, level, target: el })
  }

  body
    .querySelectorAll(`${SUMMARY_SELECTOR}, ${HEADING_SELECTOR}`)
    .forEach((el) => {
      const isSummary = el.matches(SUMMARY_SELECTOR)
      // A heading nested inside a summary block is already covered by the block.
      if (!isSummary && el.closest(SUMMARY_SELECTOR)) return

      const label = isSummary
        ? (el.firstElementChild?.textContent || el.textContent || '').trim()
        : el.textContent.trim()

      push(el, label, isSummary ? LEVELS[0] : Number(el.tagName.slice(1)))
    })

  extras(body).forEach((x) => push(x.target, x.label, x.level))

  return items.sort(inDocumentOrder)
}

// Sections flagged with [data-toc-extra] (plus the references block, picked up with no
// attribute). Document-scoped: these normally sit outside the article body/root.
function extras(body) {
  const out = []
  const marked = [...document.querySelectorAll(EXTRA_SELECTOR)]

  marked.forEach((el) => {
    const heading = el.matches(HEADING_SELECTOR) ? el : findHeading(el)
    const label = (
      el.getAttribute('data-toc-label') ||
      heading?.textContent ||
      ''
    ).trim()
    if (!label) {
      console.warn(
        '[toc] extra with no heading or data-toc-label — skipping',
        el
      )
      return
    }
    const asked = Number(el.getAttribute('data-toc-level'))
    out.push({
      target: el,
      label,
      level: LEVELS.includes(asked) ? asked : LEVELS[0],
    })
  })

  // References: the block is already hooked for the references module, so index it for
  // free — unless it's inside the body (its headings are indexed) or already marked.
  const list = document.querySelector('[data-references-list]')
  const covered = marked.some((el) => el.contains(list) || list?.contains(el))
  if (list && !body.contains(list) && !covered) {
    const box = list.parentElement || list
    const heading = findHeading(box, list)
    out.push({
      target: heading || box,
      label: heading?.textContent.trim() || REFERENCES_LABEL,
      level: LEVELS[0],
    })
  }

  return out
}

function findHeading(el, skip) {
  return (
    [...el.querySelectorAll('h1, h2, h3, h4')].find(
      (h) => !skip || !skip.contains(h)
    ) || null
  )
}

function inDocumentOrder(a, b) {
  if (a.target === b.target) return 0
  return a.target.compareDocumentPosition(b.target) &
    window.Node.DOCUMENT_POSITION_FOLLOWING
    ? -1
    : 1
}

function uniqueId(label, used) {
  const base =
    ID_PREFIX +
    (label
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section')
  let id = base
  let n = 2
  while (used.has(id) || document.getElementById(id)) id = `${base}-${n++}`
  used.add(id)
  return id
}

// Flat (ordered, level-tagged) list → nested tree by level.
function buildTree(flat) {
  const root = { level: 1, children: [] }
  const stack = [root]
  flat.forEach((item) => {
    while (stack.length > 1 && stack[stack.length - 1].level >= item.level)
      stack.pop()
    const node = { ...item, children: [] }
    stack[stack.length - 1].children.push(node)
    stack.push(node)
  })
  return root.children
}

// Render the tree into the list with our own classes (decoupled from the Finsweet
// content27 template); keep .text-size-medium for site typography. Collect entries.
function render(nodes, container, entries) {
  nodes.forEach((node) => {
    const wrapper = document.createElement('div')
    wrapper.className = `toc_item is-h${node.level}`

    const link = document.createElement('a')
    link.className = 'toc_link'
    link.href = `#${node.id}`

    const label = document.createElement('span')
    label.className = 'toc_label text-size-regular'
    label.textContent = node.label
    link.appendChild(label)

    wrapper.appendChild(link)

    let childrenBox = null
    if (node.children.length) {
      childrenBox = document.createElement('div')
      childrenBox.className = 'toc_children'
      childrenBox.setAttribute('data-toc-children', '')
      wrapper.appendChild(childrenBox)
    }

    container.appendChild(wrapper)
    entries.push({ ...node, wrapper, link, childrenBox })

    if (childrenBox) render(node.children, childrenBox, entries)
  })
}

// Expand/collapse a children box. Measures an explicit px height, then frees to auto
// once open so nested boxes can't clip. No-ops if already in the requested state.
function toggleBox(box, open, gsap) {
  if (box._open === open) return
  box._open = open
  gsap.killTweensOf(box)
  if (open) {
    gsap.set(box, { height: 'auto' })
    const h = box.offsetHeight
    gsap.fromTo(
      box,
      { height: 0 },
      {
        height: h,
        duration: EXPAND_DURATION,
        ease: EXPAND_EASE,
        onComplete: () => (box.style.height = 'auto'),
      }
    )
  } else {
    gsap.fromTo(
      box,
      { height: box.offsetHeight },
      { height: 0, duration: EXPAND_DURATION, ease: EXPAND_EASE }
    )
  }
}
