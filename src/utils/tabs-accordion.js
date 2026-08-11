/*
  Shared mobile accordion for the tabs components · below MOBILE_Q.
  Each tab's link becomes a drawer header (with a + / − icon) and its panel the drawer body.
  The existing markup is MOVED, never cloned, and put back in its exact slot on the way up to
  tablet. One drawer open at a time; the first one starts open.
  CSS → ../components/styles/tabs-accordion.css · Docs → .claude/rules/components/tabs-accordion.md
*/

const { gsap } = window

// Webflow's two smallest breakpoints (Mobile landscape + Mobile portrait). One constant for
// every tabs section, so they flip together — tabs-stats reads it too, for its stacked
// mobile layout.
export const MOBILE_Q = '(max-width: 767px)'

// Written on the root the moment the drawers are built — i.e. BEFORE onEnable fires, and
// before createTabsAccordion has returned its handle. So it, and not the handle, is what a
// component should read to answer "am I in accordion mode?" (see tabs-architected's
// inAccordion): the first enable happens inside the factory call, while the caller's own
// variable is still null.
export const ACCORDION_CLASS = 'is-accordion'

const OPEN_CLASS = 'is-open'
const EXPAND = { duration: 0.5, ease: 'power2.inOut' }
// What the link carries as a tab and must not carry as plain drawer content: the header is
// the control now, and a role="tab" inside a role="button" is neither valid nor reachable.
const TAB_ATTRS = ['role', 'tabindex', 'aria-selected', 'aria-controls']

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

const make = (tag, className) => {
  const node = document.createElement(tag)
  node.className = className
  return node
}

// Where an element came from. insertBefore(node, next) restores its exact slot; appendChild
// would only restore its parent.
const mark = (node) => ({
  node,
  parent: node.parentElement,
  next: node.nextSibling,
})
// Put back in REVERSE order of marking: a recorded `next` sibling is often another marked
// element, and insertBefore throws once the reference node is no longer a child.
const putBack = ({ node, parent, next }) => {
  if (!parent) return
  if (next && next.parentNode === parent) parent.insertBefore(node, next)
  else parent.appendChild(node)
}

/**
 * @param {object} o
 * @param {HTMLElement} o.root            The component root (gets `.is-accordion`)
 * @param {string} o.name                 Component name — id prefix + the container's hook
 * @param {HTMLElement[]} o.links         One tab link per drawer; becomes the header content
 * @param {HTMLElement[][]} o.bodies      Elements moved into each drawer, in order
 * @param {HTMLElement} [o.shared]        A single visual moved into whichever drawer is open
 * @param {HTMLElement} [o.anchor]        The container is inserted before this element
 * @param {string} [o.media]              Media query the accordion lives inside
 */
export function createTabsAccordion({
  root,
  name,
  links,
  bodies,
  shared = null,
  anchor = null,
  media = MOBILE_Q,
  onEnable = null,
  onDisable = null,
  onOpen = null,
  onClose = null,
}) {
  if (links.length !== bodies.length)
    console.warn(
      `[${name}] accordion: ${links.length} links vs ${bodies.length} bodies`
    )

  const mq = window.matchMedia(media)
  let box = null // the injected container — also the "accordion is on" flag
  let items = []
  let marks = []
  let attrRestore = []
  let sharedMark = null
  let openIndex = -1
  let booted = false

  // The section's height changes wholesale on a mode switch, so every ScrollTrigger on the
  // page is measuring against a stale document. Skipped on the first build — main.js already
  // refreshes once after all components have initialised.
  const refresh = () => booted && window.ScrollTrigger?.refresh()

  const stripAttrs = (node, attrs) => {
    const saved = attrs.map((a) => [a, node.getAttribute(a)])
    attrs.forEach((a) => node.removeAttribute(a))
    attrRestore.push(() =>
      saved.forEach(([a, v]) =>
        v == null ? node.removeAttribute(a) : node.setAttribute(a, v)
      )
    )
  }

  function build() {
    box = make('div', 'tabs-accordion')
    box.setAttribute('data-tabs-accordion', name)
    if (shared) sharedMark = mark(shared)

    links.forEach((link, i) => {
      const item = make('div', 'tabs-accordion_item')
      const head = make('div', 'tabs-accordion_header')
      const body = make('div', 'tabs-accordion_body')
      const inner = make('div', 'tabs-accordion_inner')
      const icon = make('span', 'tabs-accordion_icon')
      icon.setAttribute('aria-hidden', 'true')

      head.id = `${name}-drawer-head-${i}`
      body.id = `${name}-drawer-body-${i}`
      head.setAttribute('role', 'button')
      head.setAttribute('tabindex', '0')
      head.setAttribute('aria-controls', body.id)
      body.setAttribute('role', 'region')
      body.setAttribute('aria-labelledby', head.id)

      stripAttrs(link, TAB_ATTRS)
      marks.push(mark(link))
      head.append(link, icon)
      ;(bodies[i] || []).forEach((part) => {
        // A moved panel keeps its role="tabpanel" otherwise — nested in the drawer's region.
        if (part.getAttribute('role') === 'tabpanel')
          stripAttrs(part, ['role', 'aria-labelledby'])
        marks.push(mark(part))
        inner.appendChild(part)
      })

      body.appendChild(inner)
      item.append(head, body)
      box.appendChild(item)

      head.addEventListener('click', () => toggle(i))
      head.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        toggle(i)
      })
      items[i] = { item, head, body, inner }
    })

    if (anchor?.parentElement) anchor.parentElement.insertBefore(box, anchor)
    else root.appendChild(box)
    root.classList.add(ACCORDION_CLASS)
  }

  function setDrawer(index, open, instant) {
    const it = items[index]
    if (!it) return
    it.item.classList.toggle(OPEN_CLASS, open)
    it.head.setAttribute('aria-expanded', open ? 'true' : 'false')
    // A closed drawer must leave the tab order and the a11y tree — it can hold a real
    // button (tabs-imaging's CTA).
    if (open) {
      it.body.removeAttribute('inert')
      it.body.removeAttribute('aria-hidden')
    } else {
      it.body.setAttribute('inert', '')
      it.body.setAttribute('aria-hidden', 'true')
    }

    gsap.killTweensOf(it.body)
    if (instant || reduceMotion.matches) {
      gsap.set(it.body, { height: open ? 'auto' : 0 })
      return
    }
    const from = it.body.offsetHeight
    if (!open) {
      gsap.fromTo(it.body, { height: from }, { height: 0, ...EXPAND })
      return
    }
    gsap.set(it.body, { height: 'auto' }) // measure the open height, then animate to it
    const to = it.body.offsetHeight
    gsap.fromTo(
      it.body,
      { height: from },
      {
        height: to,
        ...EXPAND,
        // Freed to auto so late-loading media (a video's own box) can still grow it.
        onComplete: () => gsap.set(it.body, { height: 'auto' }),
      }
    )
  }

  function openDrawer(index, instant) {
    if (index === openIndex || !items[index]) return
    const prev = openIndex
    // Freeze the outgoing height BEFORE the shared visual leaves it, or its close tween
    // measures a box that has already collapsed.
    if (prev >= 0 && !instant && !reduceMotion.matches)
      gsap.set(items[prev].body, { height: items[prev].body.offsetHeight })
    openIndex = index
    if (shared) items[index].inner.appendChild(shared) // the section's one visual follows
    if (prev >= 0) {
      setDrawer(prev, false, instant)
      onClose?.(prev)
    }
    setDrawer(index, true, instant)
    onOpen?.(index)
  }

  function closeDrawer(index) {
    if (index !== openIndex) return
    openIndex = -1
    setDrawer(index, false)
    onClose?.(index)
  }

  function toggle(index) {
    if (index === openIndex) closeDrawer(index)
    else openDrawer(index)
  }

  function enable() {
    if (box) return
    build()
    onEnable?.()
    items.forEach((_, i) => setDrawer(i, false, true))
    openDrawer(0, true) // instant: there's nothing to transition from on load
    refresh()
    booted = true
  }

  function disable() {
    if (!box) return
    const wasOpen = openIndex
    items.forEach((it) => {
      gsap.killTweensOf(it.body)
      gsap.set(it.body, { clearProps: 'height' })
    })
    for (let k = marks.length - 1; k >= 0; k--) putBack(marks[k])
    if (sharedMark) putBack(sharedMark)
    attrRestore.forEach((fn) => fn())
    box.remove()
    box = null
    items = []
    marks = []
    attrRestore = []
    sharedMark = null
    openIndex = -1
    root.classList.remove(ACCORDION_CLASS)
    onDisable?.(wasOpen)
    refresh()
  }

  const onChange = (e) => (e.matches ? enable() : disable())
  mq.addEventListener('change', onChange)
  if (mq.matches) enable()
  booted = true

  return {
    isActive: () => box !== null,
    openIndex: () => openIndex,
    destroy() {
      mq.removeEventListener('change', onChange)
      disable()
    },
  }
}
