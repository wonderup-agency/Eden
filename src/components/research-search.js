/*
  Component: research-search · data-component="research-search"
  Header search → collapses the intermediate sections and filters the whitepapers
  (Finsweet instance "2") by title through Finsweet's own `filter` hook, so the match
  runs over EVERY item (all paginated pages), not just the rendered page. Finsweet then
  owns pagination + the empty state; our gold <mark> highlight rides on afterRender.
  While there's text the magnifier becomes a ✕ that clears the search. No auto-scroll.
  CSS → ./styles/research-search.css (highlight style is also injected by JS) · Docs → .claude/rules/components/research-search.md
*/

const FILTER_DEBOUNCE = 220 // ms — debounce the re-filter while typing
const COLLAPSE_DURATION = 0.6 // seconds — hide/show the intermediate sections
const COLLAPSE_EASE = 'power2.inOut'

const LIST_INSTANCE = '2' // the whitepapers Finsweet list
const TITLE_SELECTOR = 'h3' // the whitepaper title inside each list item
const TITLE_FIELD = 'title' // fs-list-field="title", on that same h3
const HIGHLIGHT_CLASS = 'search-highlight' // <mark> class on matched substrings
const PAGINATION_MARK = 'data-research-pagination' // written by JS — keep in sync with the CSS

// Scrolled back into view on a page change. [data-research-anchor] wins; the Webflow
// class is the fallback so it works with no Designer edit.
const ANCHOR_FALLBACK = '.whitepapers_browse'
const ANCHOR_GAP = 16 // px below the nav — keep in sync with global.js

// ✕ glyph swapped into [data-research-clear] while the input has text.
const CLEAR_ICON =
  '<svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='research-search']
 */
export default function (elements) {
  ensureHighlightStyle()
  elements.forEach((wrapper) => {
    try {
      init(wrapper)
    } catch (err) {
      console.error('[research-search] init failed', err)
    }
  })
}

// The <mark> is JS-generated, so its style ships with the JS (guaranteed to apply,
// no Webflow head paste needed, and immune to a site reset that neutralises <mark>).
// Override look via .search-highlight in the Webflow head if desired.
function ensureHighlightStyle() {
  const id = 'research-search-style'
  if (document.getElementById(id)) return
  const style = document.createElement('style')
  style.id = id
  style.textContent = `.${HIGHLIGHT_CLASS}{background-color:rgba(199,154,75,.3);border-radius:.2em;padding:0 .08em;color:inherit}`
  document.head.appendChild(style)
}

function init(wrapper) {
  const input = wrapper.querySelector('[data-research-input]')
  const sections = Array.from(wrapper.querySelectorAll('[data-research-hide]'))
  const anchor =
    wrapper.querySelector('[data-research-anchor]') ||
    wrapper.querySelector(ANCHOR_FALLBACK)

  if (!input) {
    console.warn('[research-search] missing [data-research-input] — skipping')
    return
  }

  const form = input.closest('form')
  // Prefer the [data-research-clear] hook; fall back to the Webflow search icon
  // sitting inside the input component so the ✕ works with no extra attribute.
  const clearBtn =
    wrapper.querySelector('[data-research-clear]') ||
    form?.querySelector('.form-icon-left .w-embed') ||
    form?.querySelector('.form-icon-left')
  const searchIcon = clearBtn ? clearBtn.innerHTML : null // original magnifier

  // The input lives in a GET form — stop Enter from submitting / reloading.
  form?.addEventListener('submit', (e) => e.preventDefault())

  // The input carries only a placeholder, which is not an accessible name.
  if (!input.getAttribute('aria-label'))
    input.setAttribute('aria-label', input.placeholder || 'Search papers')
  if (form && !form.getAttribute('role')) form.setAttribute('role', 'search')

  const gsap = window.gsap
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const animate = !!gsap && !reduce

  let query = '' // current search term (lowercased, shared with the hooks)
  let list = null // the Finsweet list instance "2"
  let searching = false // true while the input has text (sections collapsed)
  let debounce = null
  let pageBeforeSearch = 1 // page to return to once the search is cleared
  let pagination = null // Finsweet's pagination wrapper (hidden when 0 results)

  // Match on the title only. `fields` is populated from fs-list-field="title" and is
  // available for EVERY item — including the ones from pages Finsweet prefetched but
  // has not rendered — which is the whole point of filtering here instead of in the DOM.
  function itemTitle(item) {
    const field = item?.fields?.[TITLE_FIELD]?.value
    const text = Array.isArray(field) ? field.join(' ') : field
    if (text) return String(text)
    return item?.element?.querySelector(TITLE_SELECTOR)?.textContent || ''
  }

  function matchesQuery(item) {
    return !query || itemTitle(item).toLowerCase().includes(query)
  }

  // Finsweet keeps the "next" arrow enabled whenever currentPage !== totalPages, and
  // totalPages is 0 on an empty result — so the pagination has to be hidden by hand.
  // `hidden` (not a class) so it also leaves the a11y tree and the tab order, and still
  // works if the bundled CSS is stale; the CSS rule only outranks Webflow's own display.
  function setPaginationHidden(hide) {
    if (!pagination) return
    pagination.hidden = hide
    pagination.inert = hide
    if (hide) pagination.setAttribute('aria-hidden', 'true')
    else pagination.removeAttribute('aria-hidden')
  }

  // Page change → bring the list header back into view. Finsweet does this natively with
  // fs-list-element="scroll-anchor-pagination", but only via scrollIntoView, which fights
  // desktop Lenis and ignores the fixed nav — so it goes through the same Lenis +
  // nav-offset path as every other anchor on the site (see global.js).
  function scrollToAnchor() {
    if (!anchor) return
    const nav = document.querySelector('[data-component="nav"]')
    const offset = (nav?.getBoundingClientRect().height || 0) + ANCHOR_GAP
    if (window.lenis) {
      window.lenis.scrollTo(anchor, { offset: -offset })
      return
    }
    // Lenis is absent on mobile and under reduced motion.
    window.scrollTo({
      top: anchor.getBoundingClientRect().top + window.scrollY - offset,
      behavior: reduce ? 'auto' : 'smooth',
    })
  }

  // Bound to a real click rather than to `currentPage`, so the page resets our own filter
  // triggers cause (search → page 1, clear → restore) never scroll the user around.
  function watchPagination() {
    if (!pagination) return
    pagination.addEventListener('click', (e) => {
      if (e.target?.closest?.('a')) scrollToAnchor()
    })
  }

  // Filtering happens inside Finsweet's own pipeline (hook `filter`, index 1), NOT on the
  // rendered DOM. Its callbacks' return value IS used, so a subset propagates through
  // sort → static → pagination → render: totalPages recomputes, the page buttons follow
  // and the empty state toggles itself. It also composes with the category checkboxes for
  // free — their filter callback is registered first, so we narrow whatever they left.
  // Never mutate `filters.value` instead: that ref is cloned into a Web Worker and throws.
  bindFinsweet((instance) => {
    list = instance
    pagination = instance.paginationWrapperElement || null
    if (pagination) pagination.setAttribute(PAGINATION_MARK, '')
    watchPagination()

    // Hand an authored [data-research-empty] to Finsweet so it owns the toggle.
    const authored = wrapper.querySelector('[data-research-empty]')
    if (
      authored &&
      instance.emptyElement &&
      instance.emptyElement.value !== authored
    )
      instance.emptyElement.value = authored
    const emptyEl = instance.emptyElement?.value || authored
    if (emptyEl && !emptyEl.getAttribute('role'))
      emptyEl.setAttribute('role', 'status')

    instance.addHook('filter', (items) => items.filter(matchesQuery))

    // Highlight only what is on screen, after Finsweet has placed it. Re-running on every
    // render is what keeps the marks correct across pagination and category changes — and
    // what strips them again once the query is cleared.
    instance.addHook('afterRender', (items) => {
      items.forEach((item) => {
        const title = item?.element?.querySelector(TITLE_SELECTOR)
        if (title) markMatches(title, query)
      })
      setPaginationHidden(items.length === 0)
      return items
    })

    // A query typed before Finsweet resolved, and again once the background prefetch of
    // the remaining CMS pages lands (until then `items` holds page 1 only).
    if (query) refilter()
    Promise.resolve(instance.loadingPaginatedItems)
      .then(() => {
        if (query) refilter()
      })
      .catch(() => {})
  })

  function refilter() {
    if (!list) return
    list.triggerHook('filter', { resetCurrentPage: true })
    // Clearing the search puts the user back on the page they were reading.
    if (!query && pageBeforeSearch > 1 && list.currentPage)
      list.currentPage.value = pageBeforeSearch
  }

  // Swap the magnifier ↔ ✕ and toggle the icon's clear-button semantics.
  function setClearMode(on) {
    if (!clearBtn) return
    clearBtn.innerHTML = on ? CLEAR_ICON : searchIcon
    clearBtn.classList.toggle('is-clearable', on)
    if (on) {
      clearBtn.setAttribute('role', 'button')
      clearBtn.setAttribute('tabindex', '0')
      clearBtn.setAttribute('aria-label', 'Clear search')
    } else {
      clearBtn.removeAttribute('role')
      clearBtn.removeAttribute('tabindex')
      clearBtn.removeAttribute('aria-label')
    }
  }

  function clearSearch() {
    if (!input.value) return
    input.value = ''
    input.focus()
    onInput()
  }

  function onInput() {
    const value = input.value.trim()
    const hasText = value.length > 0
    query = value.toLowerCase()

    // Section + icon transitions fire only on the empty <-> non-empty edge.
    if (hasText && !searching) {
      searching = true
      pageBeforeSearch = list?.currentPage?.value || 1
      sections.forEach((s) => collapse(s, animate, gsap))
      setClearMode(true)
    } else if (!hasText && searching) {
      searching = false
      sections.forEach((s) => expand(s, animate, gsap))
      setClearMode(false)
    }

    // Debounced so fast typing doesn't re-run the whole Finsweet pipeline per keystroke.
    clearTimeout(debounce)
    debounce = setTimeout(refilter, FILTER_DEBOUNCE)
  }

  input.addEventListener('input', onInput)

  // Esc clears the search; Enter never submits (this is a live filter, not a form).
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault()
    else if (e.key === 'Escape') clearSearch()
  })

  // The ✕ icon clears the search (mouse + keyboard); inert as the magnifier.
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (clearBtn.classList.contains('is-clearable')) clearSearch()
    })
    clearBtn.addEventListener('keydown', (e) => {
      if (!clearBtn.classList.contains('is-clearable')) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        clearSearch()
      }
    })
  }
}

// — Finsweet — resolve the whitepapers list (instance "2") from the async queue.
function bindFinsweet(onReady) {
  window.FinsweetAttributes ||= []
  window.FinsweetAttributes.push([
    'list',
    (lists) => {
      const instance = lists.find((l) => l.instance === LIST_INSTANCE)
      if (!instance) {
        console.warn(
          `[research-search] Finsweet list instance "${LIST_INSTANCE}" not found — filtering disabled`
        )
        return
      }
      onReady(instance)
    },
  ])
}

// — Highlight — wrap every case-insensitive occurrence of `query` inside `root`
// in a <mark>, walking text nodes so nested markup survives. Idempotent: existing
// marks are unwrapped first, so it re-applies cleanly on each render.
function markMatches(root, query) {
  root.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`).forEach((m) => {
    m.replaceWith(document.createTextNode(m.textContent))
  })
  root.normalize()
  if (!query) return

  const rx = new RegExp(escapeRegExp(query), 'gi')
  const walker = document.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */)
  const targets = []
  let node
  while ((node = walker.nextNode())) {
    if (node.nodeValue && node.nodeValue.toLowerCase().includes(query))
      targets.push(node)
  }

  targets.forEach((textNode) => {
    const text = textNode.nodeValue
    const frag = document.createDocumentFragment()
    let last = 0
    text.replace(rx, (match, offset) => {
      if (offset > last)
        frag.appendChild(document.createTextNode(text.slice(last, offset)))
      const mark = document.createElement('mark')
      mark.className = HIGHLIGHT_CLASS
      mark.textContent = match
      frag.appendChild(mark)
      last = offset + match.length
      return match
    })
    if (last < text.length)
      frag.appendChild(document.createTextNode(text.slice(last)))
    textNode.replaceWith(frag)
  })
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// — Section hide / show —

// Props zeroed on collapse — height alone leaves the element's own vertical
// padding/margin taking up space, so those are animated to 0 too.
const COLLAPSED = {
  height: 0,
  opacity: 0,
  paddingTop: 0,
  paddingBottom: 0,
  marginTop: 0,
  marginBottom: 0,
}
const CLEAR_PROPS =
  'height,overflow,opacity,paddingTop,paddingBottom,marginTop,marginBottom'

function collapse(el, animate, gsap) {
  el.setAttribute('aria-hidden', 'true')
  el.inert = true
  if (!animate) {
    el.hidden = true
    return
  }
  gsap.killTweensOf(el)
  gsap.set(el, { overflow: 'hidden' })
  gsap.to(el, {
    ...COLLAPSED,
    duration: COLLAPSE_DURATION,
    ease: COLLAPSE_EASE,
  })
}

function expand(el, animate, gsap) {
  el.removeAttribute('aria-hidden')
  el.inert = false
  if (!animate) {
    el.hidden = false
    return
  }
  gsap.killTweensOf(el)
  gsap.to(el, {
    ...naturalMetrics(el, gsap),
    duration: COLLAPSE_DURATION,
    ease: COLLAPSE_EASE,
    onComplete: () => gsap.set(el, { clearProps: CLEAR_PROPS }),
  })
}

// Read the element's laid-out height + spacing without flashing it open:
// clear the inline overrides, measure, then restore the collapsed state.
function naturalMetrics(el, gsap) {
  gsap.set(el, { clearProps: CLEAR_PROPS })
  const cs = getComputedStyle(el)
  const metrics = {
    height: el.offsetHeight,
    opacity: 1,
    paddingTop: cs.paddingTop,
    paddingBottom: cs.paddingBottom,
    marginTop: cs.marginTop,
    marginBottom: cs.marginBottom,
  }
  gsap.set(el, { ...COLLAPSED, overflow: 'hidden' })
  return metrics
}
