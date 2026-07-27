/*
  Component: random-item · data-component="random-item"
  Shows ONE random item per Webflow Collection List inside the root, re-rolled on
  every page load and never repeating the previous load's pick.
  CSS → ./styles/random-item.css (paste into Webflow head) · Docs → .claude/rules/components/random-item.md
*/

const LIST = '.w-dyn-items' // Webflow's rendered collection list
const ITEM = '.w-dyn-item'
const READY = 'is-random' // added to the root once JS owns the visibility
const STORE_PREFIX = 'random-item:' // localStorage key namespace

// Remember the last pick so a reload never shows the same item twice in a row.
// Wrapped: localStorage throws in some privacy modes.
const remembered = (key) => {
  try {
    const v = parseInt(window.localStorage.getItem(STORE_PREFIX + key), 10)
    return Number.isInteger(v) ? v : -1
  } catch {
    return -1
  }
}
const remember = (key, index) => {
  try {
    window.localStorage.setItem(STORE_PREFIX + key, String(index))
  } catch {
    /* storage unavailable — randomness still works, repeats just aren't excluded */
  }
}

// Random index in [0, count) excluding `skip` (the previous load's pick).
function pick(count, skip) {
  if (count < 2) return 0
  if (skip < 0 || skip >= count) return Math.floor(Math.random() * count)
  const i = Math.floor(Math.random() * (count - 1))
  return i >= skip ? i + 1 : i // shift past the excluded index
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
    if (items.length < 2) return // nothing to randomise — leave it alone

    // Key is per list + count: a CMS count change resets the memory, which is fine.
    const key =
      list.getAttribute('data-random-key') ||
      `${rootIndex}:${listIndex}:${items.length}`

    const chosen = pick(items.length, remembered(key))
    remember(key, chosen)

    // Inline display only — the CSS pre-JS hide is gated on :not(.is-random), so
    // nothing fights this and the chosen item keeps its authored display value.
    items.forEach((item, i) => {
      item.style.display = i === chosen ? '' : 'none'
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
