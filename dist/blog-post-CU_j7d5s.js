/*
  Module: toc — loaded by the blog-post orchestrator (data-component="blog-post")
  Table of contents built from the article body: indexes the summary blocks + h2/h3/h4,
  plus the out-of-body sections ([data-toc-extra] + the references block), injects
  accordion links (own toc_* classes, styled in
  toc.css), drives a scrollspy .current + auto-expanding branch. Smooth scroll is the
  global Lenis anchor bridge (links are plain <a href="#id">).
  CSS → ./styles/toc.css (bundled via src/styles.js) · Docs → .claude/rules/components/toc.md
*/

const LEVELS = [2, 3, 4]; // heading levels to index (h2/h3/h4)
const SUMMARY_SELECTOR = '.content27_summary'; // top-level pseudo-headings (Summary, Key points)
const EXTRA_SELECTOR = '[data-toc-extra]'; // sections outside the body (Supplemental files…)
const REFERENCES_LABEL = 'References'; // fallback label for the auto-indexed references block
const ID_PREFIX = 'toc-';
const ACTIVE = 'current'; // class on the active link (matches the Webflow template)
const SPY_GAP = 24; // px below the nav — the floor of the activation line
const ACTIVATION = 0.3; // + this fraction of the viewport, so a heading flips active as it
// reaches ~30% down the screen (not only when it reaches the nav — that read as "late")
const EXPAND_DURATION$1 = 0.4;
const EXPAND_EASE$1 = 'power2.inOut';

const HEADING_SELECTOR = LEVELS.map((l) => `h${l}`).join(', ');

/**
 * @param {HTMLElement} root - A blog-post article root
 * @returns {{resize: () => void} | null}
 */
function initToc(root) {
  const inst = setup$1(root);
  return inst ? { resize: () => inst.refresh() } : null
}

function setup$1(root) {
  try {
    const list =
      root.querySelector('[data-toc-list]') ||
      root.querySelector('.content27_link-content');
    const body =
      root.querySelector('[data-toc-body]') ||
      root.querySelector('.blog-post_body');

    if (!list || !body) {
      console.warn('[toc] missing list container or body — skipping', root);
      return null
    }

    // If the TOC is made scrollable in the Designer (max-height + overflow), stop Lenis
    // from hijacking the wheel over it so it scrolls natively. Lenis honors
    // [data-lenis-prevent] on the wheel target or any ancestor of it.
    markLenisPrevent(root, list);

    const gsap = window.gsap;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animate = !!gsap && !reduce;

    const flat = indexContent(body);
    if (!flat.length) {
      console.warn('[toc] no headings found in the body — skipping', root);
      return null
    }

    const entries = [];
    list.replaceChildren(); // drop the Webflow template links
    render(buildTree(flat), list, entries);

    // Accordion starts collapsed (animated mode only); scrollspy opens the active branch.
    if (animate) {
      entries.forEach((e) => {
        if (e.childrenBox) {
          e.childrenBox._open = false;
          gsap.set(e.childrenBox, { height: 0 });
        }
      });
    }

    let currentId = null;

    function setActive(id) {
      if (id === currentId) return
      currentId = id;

      entries.forEach((e) => e.link.classList.toggle(ACTIVE, e.id === id));

      if (!animate) return // fallback: everything stays expanded

      const active = entries.find((e) => e.id === id);
      const open = new Set();
      if (active) {
        if (active.childrenBox) open.add(active.childrenBox);
        let el = active.wrapper.parentElement;
        while (el && el !== list) {
          if (el.matches('[data-toc-children]')) open.add(el);
          el = el.parentElement;
        }
      }
      entries.forEach((e) => {
        if (e.childrenBox)
          toggleBox(e.childrenBox, open.has(e.childrenBox), gsap);
      });
    }

    // The line below the nav where a heading flips active: nav height + a small floor
    // + a slice of the viewport so it activates as the heading nears the top third.
    function navOffset() {
      const nav = document.querySelector('[data-component="nav"]');
      const navH = nav?.getBoundingClientRect().height || 0;
      return navH + SPY_GAP + window.innerHeight * ACTIVATION
    }

    function computeActive() {
      // Bottom guard: near the end, the last headings never cross the line — force the
      // last one active so it doesn't stick on a middle heading at the foot of the page.
      const atBottom =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 2;
      if (atBottom) {
        setActive(entries[entries.length - 1].id);
        return
      }

      const off = navOffset();
      let id = entries[0].id;
      for (const e of entries) {
        if (e.target.getBoundingClientRect().top - off <= 1) id = e.id;
        else break
      }
      setActive(id);
    }

    let ticking = false;
    const onScroll = () => {
      if (ticking) return
      ticking = true;
      window.requestAnimationFrame(() => {
        computeActive();
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    computeActive();

    return { refresh: computeActive }
  } catch (err) {
    console.error('[toc] init failed', err);
    return null
  }
}

// Find the TOC's scroll container (nearest ancestor of the list, up to the root, whose
// computed overflow-y scrolls) and mark it [data-lenis-prevent] so Lenis lets it scroll
// natively. Only marks a real scroll container — never the list when it isn't scrollable
// (that would create a dead zone where the wheel scrolls nothing).
function markLenisPrevent(root, list) {
  let el = list;
  while (el && el !== root) {
    const oy = getComputedStyle(el).overflowY;
    if (oy === 'auto' || oy === 'scroll') {
      el.setAttribute('data-lenis-prevent', '');
      return
    }
    el = el.parentElement;
  }
}

// Walk the body (summary blocks + headings), then add the extra sections that live
// outside it (Supplemental files, References…), and sort everything into document order.
function indexContent(body) {
  const usedIds = new Set();
  const seen = new Set();
  const items = [];

  const push = (el, label, level) => {
    if (!label || seen.has(el)) return
    seen.add(el);
    el.id = el.id || uniqueId(label, usedIds);
    el.setAttribute('data-toc-target', '');
    items.push({ id: el.id, label, level, target: el });
  };

  body
    .querySelectorAll(`${SUMMARY_SELECTOR}, ${HEADING_SELECTOR}`)
    .forEach((el) => {
      const isSummary = el.matches(SUMMARY_SELECTOR);
      // A heading nested inside a summary block is already covered by the block.
      if (!isSummary && el.closest(SUMMARY_SELECTOR)) return

      const label = isSummary
        ? (el.firstElementChild?.textContent || el.textContent || '').trim()
        : el.textContent.trim();

      push(el, label, isSummary ? LEVELS[0] : Number(el.tagName.slice(1)));
    });

  extras(body).forEach((x) => push(x.target, x.label, x.level));

  return items.sort(inDocumentOrder)
}

// Sections flagged with [data-toc-extra] (plus the references block, picked up with no
// attribute). Document-scoped: these normally sit outside the article body/root.
function extras(body) {
  const out = [];
  const marked = [...document.querySelectorAll(EXTRA_SELECTOR)];

  marked.forEach((el) => {
    const heading = el.matches(HEADING_SELECTOR) ? el : findHeading(el);
    const label = (
      el.getAttribute('data-toc-label') ||
      heading?.textContent ||
      ''
    ).trim();
    if (!label) {
      console.warn(
        '[toc] extra with no heading or data-toc-label — skipping',
        el
      );
      return
    }
    const asked = Number(el.getAttribute('data-toc-level'));
    out.push({
      target: el,
      label,
      level: LEVELS.includes(asked) ? asked : LEVELS[0],
    });
  });

  // References: the block is already hooked for the references module, so index it for
  // free — unless it's inside the body (its headings are indexed) or already marked.
  const list = document.querySelector('[data-references-list]');
  const covered = marked.some((el) => el.contains(list) || list?.contains(el));
  if (list && !body.contains(list) && !covered) {
    const box = list.parentElement || list;
    const heading = findHeading(box, list);
    out.push({
      target: heading || box,
      label: heading?.textContent.trim() || REFERENCES_LABEL,
      level: LEVELS[0],
    });
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
      .replace(/^-+|-+$/g, '') || 'section');
  let id = base;
  let n = 2;
  while (used.has(id) || document.getElementById(id)) id = `${base}-${n++}`;
  used.add(id);
  return id
}

// Flat (ordered, level-tagged) list → nested tree by level.
function buildTree(flat) {
  const root = { level: 1, children: [] };
  const stack = [root];
  flat.forEach((item) => {
    while (stack.length > 1 && stack[stack.length - 1].level >= item.level)
      stack.pop();
    const node = { ...item, children: [] };
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  });
  return root.children
}

// Render the tree into the list with our own classes (decoupled from the Finsweet
// content27 template); keep .text-size-medium for site typography. Collect entries.
function render(nodes, container, entries) {
  nodes.forEach((node) => {
    const wrapper = document.createElement('div');
    wrapper.className = `toc_item is-h${node.level}`;

    const link = document.createElement('a');
    link.className = 'toc_link';
    link.href = `#${node.id}`;

    const label = document.createElement('span');
    label.className = 'toc_label text-size-regular';
    label.textContent = node.label;
    link.appendChild(label);

    wrapper.appendChild(link);

    let childrenBox = null;
    if (node.children.length) {
      childrenBox = document.createElement('div');
      childrenBox.className = 'toc_children';
      childrenBox.setAttribute('data-toc-children', '');
      wrapper.appendChild(childrenBox);
    }

    container.appendChild(wrapper);
    entries.push({ ...node, wrapper, link, childrenBox });

    if (childrenBox) render(node.children, childrenBox, entries);
  });
}

// Expand/collapse a children box. Measures an explicit px height, then frees to auto
// once open so nested boxes can't clip. No-ops if already in the requested state.
function toggleBox(box, open, gsap) {
  if (box._open === open) return
  box._open = open;
  gsap.killTweensOf(box);
  if (open) {
    gsap.set(box, { height: 'auto' });
    const h = box.offsetHeight;
    gsap.fromTo(
      box,
      { height: 0 },
      {
        height: h,
        duration: EXPAND_DURATION$1,
        ease: EXPAND_EASE$1,
        onComplete: () => (box.style.height = 'auto'),
      }
    );
  } else {
    gsap.fromTo(
      box,
      { height: box.offsetHeight },
      { height: 0, duration: EXPAND_DURATION$1, ease: EXPAND_EASE$1 }
    );
  }
}

/*
  Module: lightbox — loaded by the blog-post orchestrator (data-component="blog-post")
  Turns every article image into a PhotoSwipe figure viewer: zoom/pan, inline caption in
  the top bar, prev/next + counter (PhotoSwipe core), plus custom download / share buttons.
  PhotoSwipe (v5) is loaded site-wide from CDN in the Webflow head (window globals) — see the doc.
  CSS → ./styles/lightbox.css (+ PhotoSwipe core CSS via CDN) · Docs → .claude/rules/components/lightbox.md
*/

const READY_TRIES = 160; // × READY_GAP ms ≈ 8s before giving up on the CDN globals
const READY_GAP = 50;
const PADDING = { top: 60, bottom: 60, left: 24, right: 24 }; // breathing room around the image

// Crisp SVG glyphs (currentColor) — replace the mismatched unicode chars.
const ICON_SHARE =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5 8.6 10.5"/></svg>';
const ICON_DOWNLOAD =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>';

/**
 * @param {HTMLElement} root - A blog-post article root (all its <img> become figures)
 */
function initLightbox(root) {
  return setup(root)
}

async function setup(root) {
  try {
    await whenReady(() => window.PhotoSwipeLightbox && window.PhotoSwipe);
  } catch {
    console.warn(
      '[lightbox] PhotoSwipe not found on window — paste the CDN snippet in the Webflow head'
    );
    return
  }

  // Every article image except icons opted out or images that are already links.
  const figures = Array.from(root.querySelectorAll('img')).filter(
    (img) => !img.closest('a') && !img.closest('[data-lightbox-ignore]')
  );
  if (!figures.length) return

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const slides = await Promise.all(
    figures.map(async (img) => {
      const { w, h } = await imageSize(img);
      return {
        src: fullSrc(img),
        width: w,
        height: h,
        alt: img.alt,
        caption: caption(img),
      }
    })
  );

  const lightbox = new window.PhotoSwipeLightbox({
    dataSource: slides,
    pswpModule: window.PhotoSwipe,
    showHideAnimationType: reduce ? 'none' : 'zoom',
    bgOpacity: 0.92,
    padding: PADDING, // keep the image off the top bar and the viewport edges
    zoom: false, // we register our own buttons; core zoom gestures still work
    counter: true,
    arrowKeys: true,
  });

  registerUI(lightbox);
  lightbox.init();

  // Make each image an accessible trigger.
  figures.forEach((img, i) => {
    img.classList.add('lightbox_img');
    img.setAttribute('role', 'button');
    img.setAttribute('tabindex', '0');
    img.setAttribute(
      'aria-label',
      `Open figure${img.alt ? `: ${img.alt}` : ''}`
    );
    const open = () => lightbox.loadAndOpen(i);
    img.addEventListener('click', open);
    img.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
  });
}

// Custom PhotoSwipe UI: inline caption in the top bar (next to the icons), download, share.
function registerUI(lightbox) {
  lightbox.on('uiRegister', () => {
    const ui = lightbox.pswp.ui;

    // Caption lives in the top bar — the counter's margin-right:auto pushes it and the
    // buttons into the right cluster, so the note sits right beside the icons.
    ui.registerElement({
      name: 'caption-bar',
      order: 6,
      appendTo: 'bar',
      onInit: (el, pswp) => {
        el.className = 'pswp__caption-bar';
        const update = () => {
          const cap = pswp.currSlide?.data.caption || '';
          el.textContent = cap;
          el.title = cap;
          el.classList.toggle('is-empty', !cap);
        };
        pswp.on('change', update);
        update(); // populate the first slide too (change doesn't fire on open)
      },
    });

    ui.registerElement({
      name: 'download',
      order: 8,
      isButton: true,
      tagName: 'a',
      title: 'Download',
      html: ICON_DOWNLOAD,
      onInit: (el, pswp) => {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener');
        el.setAttribute('download', '');
        pswp.on('change', () => {
          el.href = pswp.currSlide?.data.src || '';
        });
      },
    });

    ui.registerElement({
      name: 'share',
      order: 7,
      isButton: true,
      title: 'Share',
      html: ICON_SHARE,
      onClick: (e, el, pswp) => share(pswp.currSlide?.data.src),
    });
  });
}

async function share(url) {
  if (!url) return
  if (window.navigator.share) {
    try {
      await window.navigator.share({ url });
    } catch {
      /* user dismissed */
    }
  } else if (window.navigator.clipboard?.writeText) {
    window.navigator.clipboard.writeText(url);
  }
}

// Largest candidate in srcset (by width descriptor), else currentSrc/src.
function fullSrc(img) {
  const set = img.getAttribute('srcset');
  if (set) {
    const best = set
      .split(',')
      .map((part) => {
        const [u, d] = part.trim().split(/\s+/);
        return { u, w: d?.endsWith('w') ? parseInt(d, 10) : 0 }
      })
      .sort((a, b) => b.w - a.w)[0];
    if (best?.u) return best.u
  }
  return img.currentSrc || img.src
}

function caption(img) {
  const fig = img.closest('figure');
  const cap = fig?.querySelector('figcaption');
  return (cap?.textContent || img.alt || '').trim()
}

// Natural dimensions: from the live img if loaded, else probe the full-res source.
function imageSize(img) {
  if (img.naturalWidth)
    return Promise.resolve({ w: img.naturalWidth, h: img.naturalHeight })
  return new Promise((resolve) => {
    const probe = new window.Image();
    probe.onload = () =>
      resolve({ w: probe.naturalWidth, h: probe.naturalHeight });
    probe.onerror = () =>
      resolve({ w: img.width || 1600, h: img.height || 1066 });
    probe.src = fullSrc(img);
  })
}

function whenReady(check, tries = READY_TRIES, gap = READY_GAP) {
  return new Promise((resolve, reject) => {
    if (check()) return resolve()
    let n = 0;
    const id = window.setInterval(() => {
      if (check()) {
        window.clearInterval(id);
        resolve();
      } else if (++n >= tries) {
        window.clearInterval(id);
        reject(new Error('timeout'));
      }
    }, gap);
  })
}

/*
  Module: table-collapse — loaded by the blog-post orchestrator (data-component="blog-post")
  Collapses long article tables to the first few rows behind a "Show more" toggle
  (with a fade), auto-applied to every <table> in the article root. GSAP height anim
  when present, instant otherwise.
  CSS → ./styles/table-collapse.css (bundled via src/styles.js) · Docs → .claude/rules/components/table-collapse.md
*/

const VISIBLE_ROWS = 6; // data rows shown before the fold
const MIN_HIDDEN = 2; // only collapse when it would hide at least this many rows
const EXPAND_DURATION = 0.5;
const EXPAND_EASE = 'power2.inOut';
const LABEL_MORE = 'Show more';
const LABEL_LESS = 'Show less';

let uid = 0;

/**
 * @param {HTMLElement} root - A blog-post article root (all its <table> are processed)
 * @returns {{resize: () => void} | null}
 */
function initTableCollapse(root) {
  const gsap = window.gsap;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animate = !!gsap && !reduce;

  const setups = [];
  root.querySelectorAll('table').forEach((table) => {
    try {
      const s = build(table, animate, gsap);
      if (s) setups.push(s);
    } catch (err) {
      console.error('[table-collapse] setup failed', err);
    }
  });

  if (!setups.length) return null

  return {
    resize() {
      // Recompute the fold height for collapsed tables (row heights reflow on resize).
      setups.forEach((s) => {
        if (s.collapsed) measure(s);
      });
    },
  }
}

function build(table, animate, gsap) {
  if (table.closest('.table-collapse_wrap')) return null // already enhanced

  const rows = table.querySelectorAll('tr');
  const theadRows = table.querySelectorAll('thead tr').length;
  const cutoff = theadRows + VISIBLE_ROWS;
  if (rows.length < cutoff + MIN_HIDDEN) return null // short enough — leave it alone

  const wrap = document.createElement('div');
  wrap.className = 'table-collapse_wrap is-collapsed';
  const wrapId = `table-collapse-${++uid}`;
  wrap.id = wrapId;
  table.parentNode.insertBefore(wrap, table);
  wrap.appendChild(table);

  const fade = document.createElement('div');
  fade.className = 'table-collapse_fade';
  fade.setAttribute('aria-hidden', 'true');
  wrap.appendChild(fade);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'table-collapse_toggle';
  button.textContent = LABEL_MORE;
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', wrapId);
  wrap.after(button);

  const s = {
    table,
    wrap,
    fade,
    button,
    cutoff,
    collapsed: true,
    animate,
    gsap,
  };
  measure(s);
  button.addEventListener('click', () => toggle(s));
  return s
}

// Height (px) that shows the header + the first VISIBLE_ROWS rows, clipping the rest.
function measure(s) {
  s.wrap.style.maxHeight = 'none';
  const wrapTop = s.wrap.getBoundingClientRect().top;
  const cutRow = s.table.querySelectorAll('tr')[s.cutoff];
  s.collapsedHeight = Math.round(cutRow.getBoundingClientRect().top - wrapTop);
  s.wrap.style.maxHeight = s.collapsed ? `${s.collapsedHeight}px` : 'none';
}

function toggle(s) {
  s.collapsed = !s.collapsed;
  s.button.textContent = s.collapsed ? LABEL_MORE : LABEL_LESS;
  s.button.setAttribute('aria-expanded', String(!s.collapsed));
  s.wrap.classList.toggle('is-collapsed', s.collapsed);

  const full = s.wrap.scrollHeight;

  if (!s.animate) {
    s.wrap.style.maxHeight = s.collapsed ? `${s.collapsedHeight}px` : 'none';
    return
  }

  s.gsap.killTweensOf(s.wrap);
  s.gsap.fromTo(
    s.wrap,
    { maxHeight: s.collapsed ? full : s.collapsedHeight },
    {
      maxHeight: s.collapsed ? s.collapsedHeight : full,
      duration: EXPAND_DURATION,
      ease: EXPAND_EASE,
      // Free the open box so a wider table (horizontal scroll) can't clip vertically.
      onComplete: () => {
        if (!s.collapsed) s.wrap.style.maxHeight = 'none';
      },
    }
  );
}

/*
  Module: share — loaded by the blog-post orchestrator (data-component="blog-post")
  Blog-post share actions: copy the post URL to the clipboard and open a Bluesky compose intent.
  CSS → ./styles/share.css (paste into Webflow head — the "Copied!" tooltip) · Docs → .claude/rules/components/share.md
*/

const COPIED_RESET = 2000; // ms the .is-copied state + "Copied!" label stay on
const COPIED_LABEL = 'Copied!';
const BLUESKY_INTENT = 'https://bsky.app/intent/compose';

/**
 * @param {HTMLElement} root - A blog-post article root (holds the share buttons)
 */
function initShare(root) {
  // URL + text default to the current page; override per-post with data-share-url /
  // data-share-text on the blog-post root.
  const url = root.getAttribute('data-share-url') || window.location.href;
  const text = root.getAttribute('data-share-text') || document.title;

  setupCopy(root, url);
  setupBluesky(root, url, text);
}

// Copy button — writes the URL to the clipboard, then shows the "Copied!" tooltip
// (+ flashes .is-copied and swaps an optional [data-share-label]).
function setupCopy(root, url) {
  const btn = root.querySelector('[data-share="copy"]');
  if (!btn) return

  const label = btn.querySelector('[data-share-label]');
  const original = label?.textContent;
  const tooltip = ensureTooltip(btn);
  let resetTimer = null;

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      await copyToClipboard(url);
    } catch {
      console.warn('[share] clipboard write failed');
      return
    }

    btn.classList.add('is-copied');
    if (label) label.textContent = COPIED_LABEL;
    tooltip.classList.add('is-visible');

    window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      btn.classList.remove('is-copied');
      if (label) label.textContent = original;
      tooltip.classList.remove('is-visible');
    }, COPIED_RESET);
  });
}

// Use a designer-provided [data-share-tooltip] if present, else inject a default
// .share_tooltip (styled by ./styles/share.css). Visibility is toggled via .is-visible.
function ensureTooltip(btn) {
  let tip = btn.querySelector('[data-share-tooltip]');
  if (!tip) {
    tip = document.createElement('span');
    tip.className = 'share_tooltip';
    tip.textContent = COPIED_LABEL;
    btn.appendChild(tip);
  }
  tip.setAttribute('role', 'status');
  tip.setAttribute('aria-live', 'polite');
  return tip
}

// Bluesky button — opens the compose intent prefilled with "<title> <url>" in a new tab.
function setupBluesky(root, url, text) {
  const btn = root.querySelector('[data-share="bluesky"]');
  if (!btn) return

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    const composed = `${text} ${url}`.trim();
    const intent = `${BLUESKY_INTENT}?text=${encodeURIComponent(composed)}`;
    window.open(intent, '_blank', 'noopener,noreferrer');
  });
}

// Clipboard API with a legacy execCommand fallback (non-secure contexts / older browsers).
async function copyToClipboard(value) {
  if (window.navigator.clipboard?.writeText) {
    return window.navigator.clipboard.writeText(value)
  }
  const ta = document.createElement('textarea');
  ta.value = value;
  ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  if (!ok) throw new Error('execCommand copy failed')
}

/*
  Module: references — loaded by the blog-post orchestrator (data-component="blog-post")
  Academic citations: matches body <sup>n</sup> markers to a separate references Rich Text
  (the author types the number at the start of each reference — that's the matching key),
  and wires bidirectional anchor links (cite ↔ reference) with "last-read" back-links.
  Scroll is delegated to the global anchor→Lenis bridge (global.js); this only owns matching + state.
  CSS → ./styles/references.css (bundled via src/styles.js) · Docs → .claude/rules/components/references.md
*/

const BACKLINK_LABEL = 'Go to Citation';
const ACTIVE_RESET = 1600; // ms the .is-active highlight stays on the jump target

// Scraped scientific articles use <sup> for many things besides citations (chemistry,
// figure/table numbers, time ranges). These guards skip the obvious non-citations so we
// never link e.g. "18–24 h" to reference 18 — see .md → "Which <sup> become citations".
const NON_CITE_WORD = // a cross-ref word right before the marker → not a citation
  /^(fig|figs|figure|figures|table|tables|eq|eqn|equation|ref|refs|reaction|reactions|section|sections|step|steps|lane|lanes|panel|panels|chapter|scheme)$/i;
const UNIT_AFTER = // a measurement unit right after the marker → a range/quantity, not a cite
  /^[.,)\s]*\d*\.?\d*\s*(h|hr|hrs|min|mins|sec|secs|d|days?|weeks?|months?|years?|nm|µm|um|mm|cm|m|mM|nM|µM|uM|M|mL|ml|µL|uL|L|mg|µg|ug|ng|g|kg|bp|kb|rpm|°c|%)\b/i;

let instanceSeq = 0;

/**
 * @param {HTMLElement} root - A blog-post article root (holds the list + the body)
 */
function initReferences(root) {
  setupReferences(root);
}

function setupReferences(root) {
  // The references block is often a sibling section outside the article root (a footer
  // block in the Webflow template), so fall back to document scope — same as the body.
  const list =
    root.querySelector('[data-references-list]') ||
    document.querySelector('[data-references-list]');
  if (!list) {
    console.warn('[references] missing [data-references-list] — skipping');
    return
  }
  // Body is normally inside the article root; fall back to document scope for safety.
  const body =
    root.querySelector('[data-references-body]') ||
    document.querySelector('[data-references-body]');

  // Namespace ids per instance so multiple components on one page never collide.
  const ns = `r${instanceSeq++}`;

  const items = buildReferences(list, ns);
  if (!items.size) {
    console.warn('[references] no references found in [data-references-list]');
    return
  }
  if (body) buildCitations(body, items, ns);

  // Each back-link points to the last-read citation (default: first occurrence; none → hidden).
  items.forEach((item, n) => {
    if (!item.citations.length) {
      item.backlink.setAttribute('hidden', '');
      return
    }
    item.lastRead = item.citations[0];
    item.backlink.setAttribute('href', `#${item.lastRead.id}`);
    item.backlink.dataset.refN = n;
    item.backlink.dataset.refNs = ns; // scope clicks to this instance (list may be outside root)
  });

  // One delegated capture-phase listener: records "last read" + moves focus/highlight.
  // Capture + same-node siblings means the global bridge's stopPropagation doesn't suppress
  // us, and we run after its scroll. No-ops when the click isn't ours.
  document.addEventListener(
    'click',
    (e) => {
      const cite = e.target.closest('.references_cite');
      if (cite && cite.id.startsWith(`${ns}-`)) {
        const item = items.get(Number(cite.dataset.refN));
        if (!item) return
        item.lastRead =
          item.citations.find((c) => c.id === cite.id) || item.lastRead;
        item.backlink.setAttribute('href', `#${cite.id}`);
        flagActive(item.block); // highlight the reference we jumped to
        item.block.focus({ preventScroll: true });
        return
      }
      const back = e.target.closest('.references_backlink');
      if (back && back.dataset.refNs === ns) {
        const occ = items.get(Number(back.dataset.refN))?.lastRead;
        if (!occ) return
        if (occ.word) flagActive(occ.word); // highlight the word before the marker
        document.getElementById(occ.id)?.focus?.({ preventScroll: true });
      }
    },
    true
  );
}

// Read the author-typed leading number of each reference block (matching key), wrap it in a
// badge span, inject the back-link, and classify the author's links.
function buildReferences(list, ns) {
  const items = new Map();
  const blocks = Array.from(list.children).filter((el) =>
    /^(P|LI|DIV)$/.test(el.tagName)
  );

  blocks.forEach((block, i) => {
    if (block.classList.contains('references_item')) return // idempotent re-init guard
    block.classList.add('references_item');

    const n = wrapLeadingNumber(block) ?? i + 1;
    if (items.has(n))
      console.warn(`[references] duplicate reference number ${n}`);

    block.id = `${ns}-ref-${n}`;
    block.setAttribute('tabindex', '-1');
    block.setAttribute('role', 'doc-biblioentry');

    classifyLinks(block);

    // Layout: [number column] [content column]. Move everything into content, then lift
    // the leading number back out as its own left column, and stack the back-link under the text.
    const content = document.createElement('div');
    content.className = 'references_content';
    while (block.firstChild) content.appendChild(block.firstChild);

    const numberEl = content.querySelector('.references_number');
    if (numberEl) block.appendChild(numberEl); // left column, out of the text flow
    block.appendChild(content);

    const backlink = document.createElement('a');
    backlink.className = 'references_backlink';
    backlink.textContent = BACKLINK_LABEL;
    backlink.setAttribute('role', 'doc-backlink');
    backlink.setAttribute('aria-label', `Back to citation ${n}`);
    content.appendChild(backlink); // below the reference text

    items.set(n, { block, backlink, citations: [], lastRead: null });
  });

  return items
}

// Wrap the leading "1" / "1." digits of a block in .references_number and return the number.
// Returns null if the block doesn't start with digits (caller falls back to index).
function wrapLeadingNumber(block) {
  const node = firstTextNode(block);
  if (!node) return null
  const m = node.nodeValue.match(/^(\s*)(\d+)/);
  if (!m) return null

  const digits = node.splitText(m[1].length); // drop leading whitespace
  digits.splitText(m[2].length); // split off the rest after the digits
  const span = document.createElement('span');
  span.className = 'references_number';
  span.setAttribute('aria-hidden', 'true');
  span.textContent = digits.nodeValue;
  digits.replaceWith(span);
  return Number(m[2])
}

// First non-empty text node, descending into inline elements.
function firstTextNode(el) {
  for (const node of el.childNodes) {
    if (node.nodeType === 3 && node.nodeValue.trim()) return node
    if (node.nodeType === 1) {
      const found = firstTextNode(node);
      if (found) return found
    }
  }
  return null
}

// Author writes plain inline links; tag them by host so they can be styled distinctly.
function classifyLinks(block) {
  block.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (/pubmed/i.test(href)) a.classList.add('is-pubmed');
    else if (/scholar\.google/i.test(href)) a.classList.add('is-scholar');
    else a.classList.add('is-view');
  });
}

// Scan the body for <sup> markers, split grouped numbers, turn each into a cite anchor, and
// wrap the word before the marker so it can be highlighted when the reader jumps back.
function buildCitations(body, items, ns) {
  const counts = new Map();

  body.querySelectorAll('sup').forEach((sup) => {
    if (sup.querySelector('a')) return // already enhanced
    if (!looksLikeCitation(sup)) return // skip figures/tables/units/chemistry superscripts
    const nums = parseNumbers(sup.textContent);
    if (!nums.length) return

    const word = wrapPrecedingWord(sup);
    const frag = document.createDocumentFragment();
    nums.forEach((n, idx) => {
      const item = items.get(n);
      if (!item) {
        frag.appendChild(document.createTextNode(String(n)));
        console.warn(`[references] <sup>${n}</sup> has no matching reference`);
      } else {
        const k = (counts.get(n) || 0) + 1;
        counts.set(n, k);
        const id = `${ns}-cite-${n}-${k}`;
        const a = document.createElement('a');
        a.className = 'references_cite';
        a.id = id;
        a.href = `#${item.block.id}`;
        a.dataset.refN = n;
        a.textContent = n;
        a.setAttribute('aria-label', `Go to reference ${n}`);
        item.citations.push({ id, word });
        frag.appendChild(a);
      }
      if (idx < nums.length - 1) frag.appendChild(document.createTextNode(','));
    });

    sup.textContent = '';
    sup.appendChild(frag);
  });
}

// A <sup> is a citation unless it's clearly a cross-reference (preceded by Figure/Table/…)
// or a quantity (followed by a unit like "h"/"mM"). High precision on purpose: when unsure
// we treat it as a citation, but numbers with no matching reference stay plain text anyway.
function looksLikeCitation(sup) {
  const prev = sup.previousSibling;
  if (prev && prev.nodeType === 3) {
    const word = prev.nodeValue.match(/([\p{L}]+)[\s(]*$/u); // last word before the marker
    if (word && NON_CITE_WORD.test(word[1])) return false
  }
  const next = sup.nextSibling;
  if (next && next.nodeType === 3 && UNIT_AFTER.test(next.nodeValue))
    return false
  return true
}

// Wrap the last word of the text node right before a <sup> in .references_cited-word.
function wrapPrecedingWord(sup) {
  const prev = sup.previousSibling;
  if (!prev || prev.nodeType !== 3) return null
  const m = prev.nodeValue.match(/(\S+)(\s*)$/);
  if (!m) return null

  const word = prev.splitText(prev.nodeValue.length - m[0].length);
  if (m[2]) word.splitText(m[1].length); // keep the trailing whitespace outside the span
  const span = document.createElement('span');
  span.className = 'references_cited-word';
  span.textContent = word.nodeValue;
  word.replaceWith(span);
  return span
}

// "1", "1,2", "1, 2" → [1, 2]. Ranges expand: "5–7" (hyphen / en- / em-dash) → [5, 6, 7],
// as academic citations are written both ways. Non-numeric tokens are ignored.
function parseNumbers(text) {
  const out = [];
  text.split(/[,\s]+/).forEach((tok) => {
    const range = tok.match(/^(\d+)\s*[–—-]\s*(\d+)$/);
    if (range) {
      const a = +range[1];
      const b = +range[2];
      if (b >= a && b - a <= 50) for (let n = a; n <= b; n++) out.push(n);
      else out.push(a);
    } else {
      const n = parseInt(tok, 10);
      if (Number.isInteger(n)) out.push(n);
    }
  });
  return out
}

function flagActive(el) {
  el.classList.add('is-active');
  window.setTimeout(() => el.classList.remove('is-active'), ACTIVE_RESET);
}

/*
  Module: figures — loaded by the blog-post orchestrator (data-component="blog-post")
  Webflow renders each image caption as a .w-embed > .wp-figcaption that is the NEXT sibling
  of the <figure> (not inside it), so it stacks below. This pairs each figure with that caption
  block and wraps the pair in a flex row so the caption sits beside the image.
  CSS → ./styles/figures.css (bundled via src/styles.js) · Docs → .claude/rules/components/figures.md
*/

const WRAP_CLASS = 'figure-aside';

/**
 * @param {HTMLElement} root - A blog-post article root
 */
function initFigures(root) {
  const figures = root.querySelectorAll('figure.w-richtext-figure-type-image');
  figures.forEach((fig) => {
    if (fig.parentElement?.classList.contains(WRAP_CLASS)) return // idempotent
    const cap = captionAfter(fig);
    if (!cap) return
    const wrap = document.createElement('div');
    wrap.className = WRAP_CLASS;
    fig.parentNode.insertBefore(wrap, fig);
    wrap.append(fig, cap);
  });
}

// The caption is the immediately-following .w-embed holding a .wp-figcaption.
function captionAfter(fig) {
  const next = fig.nextElementSibling;
  return next && next.querySelector?.('.wp-figcaption') ? next : null
}

/*
  Component: blog-post · data-component="blog-post"
  Orchestrates the whole article reading experience on one root: table of contents,
  image lightbox, collapsible long tables, share actions and academic references. Each
  behavior is an isolated module (a throw in one never breaks the others). One attribute
  in Webflow drives everything inside the article.
  CSS → the per-module blocks in webflow-head.css · Docs → .claude/rules/components/blog-post.md
*/


/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='blog-post']
 */
function blogPost (elements) {
  const hooks = [];

  // Guard against a mis-tagged CMS template with nested roots (e.g. the attribute left on
  // both an outer wrapper and the article): a root inside another would double-init every
  // module. Keep only the innermost roots — the outer wrapper would over-scan (lightbox
  // grabbing nav/footer images, etc.).
  const roots = elements.filter(
    (el) => !elements.some((other) => other !== el && el.contains(other))
  );

  roots.forEach((root) => {
    run('figures', () => initFigures(root)); // wrap figure + caption before lightbox scans images
    hooks.push(run('toc', () => initToc(root)));
    run('lightbox', () => initLightbox(root)); // async — fire and forget
    hooks.push(run('table-collapse', () => initTableCollapse(root)));
    run('share', () => initShare(root));
    run('references', () => initReferences(root));
  });

  const live = hooks.filter((h) => h && typeof h.resize === 'function');
  if (!live.length) return

  return {
    resize() {
      live.forEach((h) => h.resize());
    },
  }
}

// Isolate each behavior so one throwing doesn't abort the rest of the article.
function run(name, fn) {
  try {
    return fn()
  } catch (err) {
    console.error(`[blog-post] ${name} init failed`, err);
    return null
  }
}

export { blogPost as default };
//# sourceMappingURL=blog-post-CU_j7d5s.js.map
