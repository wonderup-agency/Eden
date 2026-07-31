/*
  Component: research-search · data-component="research-search"
  Header search → hides the intermediate sections and filters the whitepapers
  (Finsweet instance "2") by title, done directly on the rendered DOM (show/hide +
  exact-substring highlight), re-applied on Finsweet's afterRender so it composes
  with category filters. No dependency on fs-list-field / fs-list-highlight / fuzzy.
  While there's text the magnifier becomes a ✕ that clears the search. No auto-scroll.
  CSS → ./styles/research-search.css (highlight style is also injected by JS) · Docs → .claude/rules/components/research-search.md
*/

const FILTER_DEBOUNCE = 220; // ms — debounce the re-filter while typing
const COLLAPSE_DURATION = 0.6; // seconds — hide/show the intermediate sections
const COLLAPSE_EASE = 'power2.inOut';

const TITLE_SELECTOR = 'h3'; // the whitepaper title inside each list item
const HIGHLIGHT_CLASS = 'search-highlight'; // <mark> class on matched substrings

// ✕ glyph swapped into [data-research-clear] while the input has text.
const CLEAR_ICON =
  '<svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='research-search']
 */
function researchSearch (elements) {
  ensureHighlightStyle();
  elements.forEach((wrapper) => {
    try {
      init(wrapper);
    } catch (err) {
      console.error('[research-search] init failed', err);
    }
  });

  return { resize() {} }
}

// The <mark> is JS-generated, so its style ships with the JS (guaranteed to apply,
// no Webflow head paste needed, and immune to a site reset that neutralises <mark>).
// Override look via .search-highlight in the Webflow head if desired.
function ensureHighlightStyle() {
  const id = 'research-search-style';
  if (document.getElementById(id)) return
  const style = document.createElement('style');
  style.id = id;
  style.textContent = `.${HIGHLIGHT_CLASS}{background-color:rgba(199,154,75,.3);border-radius:.2em;padding:0 .08em;color:inherit}`;
  document.head.appendChild(style);
}

function init(wrapper) {
  const input = wrapper.querySelector('[data-research-input]');
  const sections = Array.from(wrapper.querySelectorAll('[data-research-hide]'));

  if (!input) {
    console.warn('[research-search] missing [data-research-input] — skipping');
    return
  }

  const form = input.closest('form');
  // Prefer the [data-research-clear] hook; fall back to the Webflow search icon
  // sitting inside the input component so the ✕ works with no extra attribute.
  const clearBtn =
    wrapper.querySelector('[data-research-clear]') ||
    form?.querySelector('.form-icon-left .w-embed') ||
    form?.querySelector('.form-icon-left');
  const searchIcon = clearBtn ? clearBtn.innerHTML : null; // original magnifier

  // The input lives in a GET form — stop Enter from submitting / reloading.
  form?.addEventListener('submit', (e) => e.preventDefault());

  const gsap = window.gsap;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animate = !!gsap && !reduce;

  let query = ''; // current search term (lowercased, shared with the hooks)
  let list = null; // the Finsweet list instance "2"
  let searching = false; // true while the input has text (sections collapsed)
  let debounce = null;

  // The Finsweet no-results element (author's [data-research-empty] / the
  // fs-list-element="empty" div) — toggled from the visible count.
  let emptyEl = null;

  // Filter + highlight + empty are done directly on the DOM — NOT via a Finsweet
  // `filter` hook or `filters.value` mutation: v2 filters in a Web Worker that
  // ignores the hook's returned items and can't clone a mutated ref (DataCloneError).
  // We show/hide the rendered items ourselves and re-apply after each Finsweet render
  // (category / pagination), so the two compose.
  function applyFilter() {
    if (!list) return
    const listEl = list.listElement;
    if (!listEl) return
    let visible = 0;
    Array.from(listEl.children).forEach((el) => {
      const title = el.querySelector(TITLE_SELECTOR);
      const match =
        !query || (title?.textContent || '').toLowerCase().includes(query);
      // Inline display overrides Finsweet's own inline display on the item.
      el.style.display = match ? '' : 'none';
      if (title) markMatches(title, match ? query : '');
      if (match) visible++;
    });
    if (emptyEl) emptyEl.style.display = visible === 0 ? '' : 'none';
  }

  bindFinsweet((instance) => {
    list = instance;
    emptyEl =
      wrapper.querySelector('[data-research-empty]') ||
      instance.wrapperElement?.querySelector('[fs-list-element="empty"]') ||
      wrapper.querySelector('[fs-list-element="empty"]');
    // Re-apply after every Finsweet render so category filters + pagination compose
    // with our title search instead of wiping the hidden/highlight state.
    instance.addHook('afterRender', (items) => {
      applyFilter();
      return items
    });
    applyFilter(); // initial pass (covers a query typed before Finsweet was ready)
  });

  const refilter = () => applyFilter();

  // Swap the magnifier ↔ ✕ and toggle the icon's clear-button semantics.
  function setClearMode(on) {
    if (!clearBtn) return
    clearBtn.innerHTML = on ? CLEAR_ICON : searchIcon;
    clearBtn.classList.toggle('is-clearable', on);
    if (on) {
      clearBtn.setAttribute('role', 'button');
      clearBtn.setAttribute('tabindex', '0');
      clearBtn.setAttribute('aria-label', 'Clear search');
    } else {
      clearBtn.removeAttribute('role');
      clearBtn.removeAttribute('tabindex');
      clearBtn.removeAttribute('aria-label');
    }
  }

  function clearSearch() {
    if (!input.value) return
    input.value = '';
    input.focus();
    onInput();
  }

  function onInput() {
    const value = input.value.trim();
    const hasText = value.length > 0;
    query = value.toLowerCase();

    // Section + icon transitions fire only on the empty <-> non-empty edge.
    if (hasText && !searching) {
      searching = true;
      sections.forEach((s) => collapse(s, animate, gsap));
      setClearMode(true);
    } else if (!hasText && searching) {
      searching = false;
      sections.forEach((s) => expand(s, animate, gsap));
      setClearMode(false);
    }

    // Debounced so fast typing doesn't re-scan the list every keystroke.
    clearTimeout(debounce);
    debounce = setTimeout(refilter, FILTER_DEBOUNCE);
  }

  input.addEventListener('input', onInput);

  // Esc clears the search; Enter never submits (this is a live filter, not a form).
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault();
    else if (e.key === 'Escape') clearSearch();
  });

  // The ✕ icon clears the search (mouse + keyboard); inert as the magnifier.
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (clearBtn.classList.contains('is-clearable')) clearSearch();
    });
    clearBtn.addEventListener('keydown', (e) => {
      if (!clearBtn.classList.contains('is-clearable')) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        clearSearch();
      }
    });
  }
}

// — Finsweet — resolve the whitepapers list (instance "2") from the async queue.
function bindFinsweet(onReady) {
  window.FinsweetAttributes ||= [];
  window.FinsweetAttributes.push([
    'list',
    (lists) => {
      const instance = lists.find((l) => l.instance === '2');
      if (!instance) {
        console.warn(
          '[research-search] Finsweet list instance "2" not found — filtering disabled'
        );
        return
      }
      onReady(instance);
    },
  ]);
}

// — Highlight — wrap every case-insensitive occurrence of `query` inside `root`
// in a <mark>, walking text nodes so nested markup survives. Idempotent: existing
// marks are unwrapped first, so it re-applies cleanly on each render.
function markMatches(root, query) {
  root.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`).forEach((m) => {
    m.replaceWith(document.createTextNode(m.textContent));
  });
  root.normalize();
  if (!query) return

  const rx = new RegExp(escapeRegExp(query), 'gi');
  const walker = document.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const targets = [];
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeValue && node.nodeValue.toLowerCase().includes(query))
      targets.push(node);
  }

  targets.forEach((textNode) => {
    const text = textNode.nodeValue;
    const frag = document.createDocumentFragment();
    let last = 0;
    text.replace(rx, (match, offset) => {
      if (offset > last)
        frag.appendChild(document.createTextNode(text.slice(last, offset)));
      const mark = document.createElement('mark');
      mark.className = HIGHLIGHT_CLASS;
      mark.textContent = match;
      frag.appendChild(mark);
      last = offset + match.length;
      return match
    });
    if (last < text.length)
      frag.appendChild(document.createTextNode(text.slice(last)));
    textNode.replaceWith(frag);
  });
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
};
const CLEAR_PROPS =
  'height,overflow,opacity,paddingTop,paddingBottom,marginTop,marginBottom';

function collapse(el, animate, gsap) {
  el.setAttribute('aria-hidden', 'true');
  el.inert = true;
  if (!animate) {
    el.hidden = true;
    return
  }
  gsap.killTweensOf(el);
  gsap.set(el, { overflow: 'hidden' });
  gsap.to(el, {
    ...COLLAPSED,
    duration: COLLAPSE_DURATION,
    ease: COLLAPSE_EASE,
  });
}

function expand(el, animate, gsap) {
  el.removeAttribute('aria-hidden');
  el.inert = false;
  if (!animate) {
    el.hidden = false;
    return
  }
  gsap.killTweensOf(el);
  gsap.to(el, {
    ...naturalMetrics(el, gsap),
    duration: COLLAPSE_DURATION,
    ease: COLLAPSE_EASE,
    onComplete: () => gsap.set(el, { clearProps: CLEAR_PROPS }),
  });
}

// Read the element's laid-out height + spacing without flashing it open:
// clear the inline overrides, measure, then restore the collapsed state.
function naturalMetrics(el, gsap) {
  gsap.set(el, { clearProps: CLEAR_PROPS });
  const cs = getComputedStyle(el);
  const metrics = {
    height: el.offsetHeight,
    opacity: 1,
    paddingTop: cs.paddingTop,
    paddingBottom: cs.paddingBottom,
    marginTop: cs.marginTop,
    marginBottom: cs.marginBottom,
  };
  gsap.set(el, { ...COLLAPSED, overflow: 'hidden' });
  return metrics
}

export { researchSearch as default };
//# sourceMappingURL=research-search-DRfpyIlE.js.map
