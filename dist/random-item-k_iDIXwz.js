/*
  Component: random-item · data-component="random-item"
  Two modes: POOL (several CMS collections merged into one pool — each static card slot
  gets its fields copied from a random item of a different collection, re-rolled each
  load) and LEGACY per-list (N random items inside each list).
  CSS → ./styles/random-item.css (bundled via src/styles.js) · Docs → .claude/rules/components/random-item.md
*/

const LIST = '.w-dyn-items'; // Webflow's rendered collection list
const ITEM = '.w-dyn-item';
const WRAP = '.w-dyn-list';
const BIND_EMPTY = 'w-dyn-bind-empty'; // Webflow's marker for an unfilled CMS field
const COUNT_ATTR = 'data-random-count'; // legacy: how many items to show (per list, or on the root as default)
const KEY_ATTR = 'data-random-key';
const POOL_ATTR = 'data-random-pool'; // pool mode: on a source list — the value IS the type
const FIELD_ATTR = 'data-random-item'; // a field: source inside an item, target inside a slot (on a .w-dyn-list it's a POOL_ATTR alias)
const LABEL_ATTR = 'data-random-label'; // optional tag label override for that type
const SLOT_ATTR = 'data-random-slot'; // pool mode: a static card (value = pinned type, optional)
const TYPE_ATTR = 'data-random-type'; // written by JS on a filled slot (CSS/QA hook)
const READY = 'is-random'; // added to the root once JS owns the visibility
const FILLED = 'is-filled';
const EMPTY = 'is-empty';
const STORE_PREFIX = 'random-item:'; // localStorage key namespace

// A field left empty in the CMS would render a broken card, so an item missing any of
// these is dropped from the pool rather than shown.
const REQUIRED = ['title', 'subtitle', 'img', 'link'];
// Tag text per type — overridable per list with data-random-label.
const TAG_LABELS = {
  whitepapers: 'Whitepaper',
  papers: 'Paper',
  customers: 'Customer story',
};

// Remember the last picks so a reload never shows the same set twice in a row.
// Wrapped: localStorage throws in some privacy modes.
const readStore = (key) => {
  try {
    return (window.localStorage.getItem(STORE_PREFIX + key) || '')
      .split(',')
      .filter(Boolean)
  } catch {
    return []
  }
};
const writeStore = (key, values) => {
  try {
    window.localStorage.setItem(STORE_PREFIX + key, values.join(','));
  } catch {
    /* storage unavailable — randomness still works, repeats just aren't excluded */
  }
};

const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr
};

// Split [0, count) into fresh (not shown last load) and reused, each shuffled —
// fresh first, so the visible set always changes while the pool has margin.
const rollOrder = (count, skip) => {
  const stale = new Set(skip);
  const fresh = [];
  const reuse = [];
  for (let i = 0; i < count; i++) (stale.has(i) ? reuse : fresh).push(i);
  return shuffle(fresh).concat(shuffle(reuse))
};

const itemsOf = (el) => {
  const list = el.matches(LIST) ? el : el.querySelector(LIST);
  return list ? Array.from(list.children).filter((n) => n.matches(ITEM)) : []
};

/* ===== Pool mode ===== */

// name -> element, for both the source fields of an item and the targets of a slot.
const fieldsOf = (el) => {
  const map = new Map();
  el.querySelectorAll(`[${FIELD_ATTR}]`).forEach((node) => {
    const name = (node.getAttribute(FIELD_ATTR) || '').trim();
    if (name && !map.has(name)) map.set(name, node);
  });
  return map
};

const isEmpty = (el) => {
  if (!el) return true
  if (el.classList.contains(BIND_EMPTY)) return true // Webflow marks unfilled fields
  if (el.tagName === 'IMG') return !el.getAttribute('src')
  if (el.tagName === 'A') return !el.getAttribute('href')
  return !el.textContent.trim()
};

const usable = (fields) => REQUIRED.every((name) => !isEmpty(fields.get(name)));

// type -> { label, entries }. Empty collections are dropped (Webflow renders its empty
// state instead of items); the same type declared twice merges its items.
function readPools(root) {
  const pools = new Map();
  root
    .querySelectorAll(`[${POOL_ATTR}], ${WRAP}[${FIELD_ATTR}]`)
    .forEach((el) => {
      // On a .w-dyn-list, FIELD_ATTR is accepted as a POOL_ATTR alias — everywhere
      // else it names a field, so the list check is what keeps the two apart.
      const type = (
        el.getAttribute(POOL_ATTR) ||
        el.getAttribute(FIELD_ATTR) ||
        ''
      ).trim();
      if (!type) {
        console.warn(`[random-item] empty ${POOL_ATTR} value on`, el);
        return
      }

      const all = itemsOf(el).map(fieldsOf);
      const entries = all.filter(usable);
      if (all.length > entries.length)
        console.warn(
          `[random-item] "${type}": ${all.length - entries.length} item(s) skipped — empty ${REQUIRED.join('/')} field`
        );
      if (!entries.length) return

      const pool = pools.get(type);
      if (pool) pool.entries.push(...entries);
      else
        pools.set(type, {
          label: el.getAttribute(LABEL_ATTR) || TAG_LABELS[type] || type,
          entries,
        });
    });
  return pools
}

// One distinct type per slot: pinned slots (data-random-slot="papers") first, the rest
// get a shuffled type each. More slots than types → the bag refills, so a type repeats
// rather than leaving a card empty (documented degradation).
function assignTypes(slots, types) {
  const taken = new Set();
  const pinned = slots.map((slot) => {
    const want = (slot.getAttribute(SLOT_ATTR) || '').trim();
    if (!want) return null
    if (!types.includes(want)) {
      console.warn(`[random-item] no content for pinned type "${want}"`, slot);
      return null
    }
    taken.add(want);
    return want
  });

  let bag = shuffle(types.filter((t) => !taken.has(t)));
  return pinned.map((type) => {
    if (type) return type
    if (!bag.length) bag = shuffle(types.slice());
    return bag.shift()
  })
}

// Copy one CMS field onto its slot target. Images carry srcset/sizes too: copying src
// alone would leave the template's own srcset winning and paint the placeholder asset.
function copyField(source, target) {
  if (target.tagName === 'IMG') {
['src', 'srcset', 'sizes', 'alt'].forEach((name) => {
      const value = source.getAttribute(name);
      if (value === null) target.removeAttribute(name);
      else target.setAttribute(name, value);
    });
    // Intrinsic size belongs to the template's placeholder, not to the CMS asset —
    // the wrapper's aspect-ratio + object-fit own the box.
    target.removeAttribute('width');
    target.removeAttribute('height');
    target.classList.remove(BIND_EMPTY);
    return
  }
  if (target.tagName === 'A') {
    target.setAttribute('href', source.getAttribute('href') || '');
    return
  }
  target.textContent = source.textContent;
}

function fillSlot(slot, pick) {
  fieldsOf(slot).forEach((target, name) => {
    if (name === 'tag') target.textContent = pick.label;
    else if (pick.fields.has(name)) copyField(pick.fields.get(name), target);
  });
  slot.setAttribute(TYPE_ATTR, pick.type); // lets the CSS vary per type (tag colour, icon…)
  slot.classList.add(FILLED);
}

function setupPool(root, rootIndex, pools, slots) {
  const types = Array.from(pools.keys());
  const assigned = assignTypes(slots, types);

  // Item counts are part of the key: a CMS change shifts the indexes, so the old
  // memory would be meaningless anyway.
  const sig = types.map((t) => `${t}${pools.get(t).entries.length}`).join('|');
  const key = root.getAttribute(KEY_ATTR) || `pool:${rootIndex}:${sig}`;
  const seen = readStore(key);

  const queues = new Map(
    types.map((t) => {
      const stale = seen
        .filter((entry) => entry.slice(0, entry.lastIndexOf(':')) === t)
        .map((entry) => parseInt(entry.slice(entry.lastIndexOf(':') + 1), 10));
      return [t, rollOrder(pools.get(t).entries.length, stale)]
    })
  );

  // Read phase — resolve every (slot → item) pair before writing anything.
  const picks = assigned.map((type) => {
    const from =
      queues.get(type).length > 0
        ? type
        : shuffle(types.slice()).find((t) => queues.get(t).length > 0);
    if (!from) return null // whole pool exhausted — slot collapses via CSS
    const index = queues.get(from).shift();
    const pool = pools.get(from);
    return { type: from, index, label: pool.label, fields: pool.entries[index] }
  });

  // Write phase.
  picks.forEach((pick, i) => {
    if (pick) fillSlot(slots[i], pick);
    else slots[i].classList.add(EMPTY);
  });

  writeStore(
    key,
    picks.filter(Boolean).map((p) => `${p.type}:${p.index}`)
  );
}

/* ===== Legacy per-list mode ===== */

// Attribute lookup: the list itself, its .w-dyn-list wrapper, then the root default.
const attr = (list, root, name) =>
  list.getAttribute(name) ??
  list.closest(WRAP)?.getAttribute(name) ??
  root.getAttribute(name);

const readCount = (list, root) => {
  const n = parseInt(attr(list, root, COUNT_ATTR), 10);
  return Number.isInteger(n) && n > 0 ? n : 1
};

function setupLists(root, rootIndex) {
  const lists = Array.from(root.querySelectorAll(LIST));
  if (!lists.length) {
    console.warn('[random-item] no Webflow collection list found in', root);
    return
  }

  lists.forEach((list, listIndex) => {
    const items = Array.from(list.children).filter((el) => el.matches(ITEM));
    const count = readCount(list, root);
    if (items.length <= count) return // nothing to randomise — leave it alone

    // Key is per list + count: a CMS count change resets the memory, which is fine.
    const key =
      attr(list, root, KEY_ATTR) || `${rootIndex}:${listIndex}:${items.length}`;

    const stale = readStore(key)
      .map((n) => parseInt(n, 10))
      .filter((n) => Number.isInteger(n));
    const chosen = rollOrder(items.length, stale)
      .slice(0, Math.min(count, items.length))
      .sort((a, b) => a - b);
    writeStore(key, chosen);

    // Inline display only — the CSS pre-JS hide is gated on :not(.is-random), so
    // nothing fights this and the chosen items keep their authored display value.
    const show = new Set(chosen);
    items.forEach((item, i) => {
      item.style.display = show.has(i) ? '' : 'none';
    });
  });
}

function setup(root, rootIndex) {
  const pools = readPools(root);
  const slots = Array.from(root.querySelectorAll(`[${SLOT_ATTR}]`));

  if (pools.size && slots.length) setupPool(root, rootIndex, pools, slots);
  else if (pools.size)
    console.warn(
      `[random-item] pool lists found but no [${SLOT_ATTR}] in`,
      root
    );
  else setupLists(root, rootIndex);

  root.classList.add(READY); // lifts the CSS visibility gate
}

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='random-item']
 */
function randomItem (elements) {
  elements.forEach(setup);
}

export { randomItem as default };
//# sourceMappingURL=random-item-k_iDIXwz.js.map
