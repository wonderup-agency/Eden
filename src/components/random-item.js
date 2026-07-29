/*
  Component: random-item · data-component="random-item"
  Shows N random items per Webflow Collection List inside the root (N via
  data-random-count, default 1), re-rolled on every page load and never repeating
  the previous load's picks.
  CSS → ./styles/random-item.css (bundled via src/styles.js) · Docs → .claude/rules/components/random-item.md
*/

const LIST = '.w-dyn-items' // Webflow's rendered collection list
const ITEM = '.w-dyn-item'
const WRAP = '.w-dyn-list'
const COUNT_ATTR = 'data-random-count' // how many items to show (per list, or on the root as default)
const KEY_ATTR = 'data-random-key'
const READY = 'is-random' // added to the root once JS owns the visibility
const STORE_PREFIX = 'random-item:' // localStorage key namespace

// Remember the last picks so a reload never shows the same set twice in a row.
// Wrapped: localStorage throws in some privacy modes.
const remembered = (key) => {
  try {
    return (window.localStorage.getItem(STORE_PREFIX + key) || '')
      .split(',')
      .map((n) => parseInt(n, 10))
      .filter((n) => Number.isInteger(n))
  } catch {
    return []
  }
}
const remember = (key, indexes) => {
  try {
    window.localStorage.setItem(STORE_PREFIX + key, indexes.join(','))
  } catch {
    /* storage unavailable — randomness still works, repeats just aren't excluded */
  }
}

// Attribute lookup: the list itself, its .w-dyn-list wrapper, then the root default.
const attr = (list, root, name) =>
  list.getAttribute(name) ??
  list.closest(WRAP)?.getAttribute(name) ??
  root.getAttribute(name)

const readCount = (list, root) => {
  const n = parseInt(attr(list, root, COUNT_ATTR), 10)
  return Number.isInteger(n) && n > 0 ? n : 1
}

const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// Pick `want` distinct indexes in [0, count), preferring the ones NOT shown last
// load so the visible set always changes; falls back to previous picks only when
// there aren't enough fresh ones. Returned in DOM order.
function pick(count, want, skip) {
  const n = Math.min(want, count)
  const stale = new Set(skip)
  const fresh = []
  const reuse = []
  for (let i = 0; i < count; i++) (stale.has(i) ? reuse : fresh).push(i)
  return shuffle(fresh)
    .concat(shuffle(reuse))
    .slice(0, n)
    .sort((a, b) => a - b)
}

function setup(root, rootIndex) {
  const lists = Array.from(root.querySelectorAll(LIST))
  if (!lists.length) {
    console.warn('[random-item] no Webflow collection list found in', root)
    root.classList.add(READY) // lift the CSS gate anyway
    return
  }

  lists.forEach((list, listIndex) => {
    const items = Array.from(list.children).filter((el) => el.matches(ITEM))
    const count = readCount(list, root)
    if (items.length <= count) return // nothing to randomise — leave it alone

    // Key is per list + count: a CMS count change resets the memory, which is fine.
    const key =
      attr(list, root, KEY_ATTR) || `${rootIndex}:${listIndex}:${items.length}`

    const chosen = pick(items.length, count, remembered(key))
    remember(key, chosen)

    // Inline display only — the CSS pre-JS hide is gated on :not(.is-random), so
    // nothing fights this and the chosen items keep their authored display value.
    const show = new Set(chosen)
    items.forEach((item, i) => {
      item.style.display = show.has(i) ? '' : 'none'
    })
  })

  root.classList.add(READY) // reveals the lists (CSS visibility gate)
}

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='random-item']
 */
export default function (elements) {
  elements.forEach(setup)
}
