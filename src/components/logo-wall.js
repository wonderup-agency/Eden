/*
Component: logo-wall
Webflow attribute: data-component="logo-wall"

Grid of slots: most cycle logos in a continuous loop (from a pool of virtual
clones); the .is-last target stays fixed. Each logo carries its testimonial — on
hover/focus the wall pauses and that slot's testimonial replaces the logo.

GSAP expected as a global (no ScrollTrigger — visibility uses
IntersectionObserver). CSS is NOT bundled — paste ./styles/logo-wall.css into
Webflow's head. Keep --logo-wall-fade ~ SWAP_DURATION.
*/

const { gsap } = window

const LOOP_DELAY = 1.5 // seconds between swaps
const SWAP_DURATION = 0.9 // logo roll duration
const SWAP_TRAVEL = 100 // % of slot height — full roll so the two logos never crowd the centre
const SWAP_EASE = 'expo.inOut'
const DEFAULT_POOL_FACTOR = 2 // how many times the logo set is duplicated into the pool

// Data hook preferred; falls back to the current Webflow class.
const TESTIMONIAL_SELECTOR =
  '[data-logo-wall-testimonial], .logo-wall_testimonial'

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Resolve a wall's slots → { parent, target, testimonial, isFixed }.
function resolveSlots(root) {
  const list = root.querySelector('[data-logo-wall-list]')
  if (!list) {
    console.warn('[logo-wall] missing [data-logo-wall-list] — skipping')
    return null
  }

  const slots = Array.from(list.querySelectorAll('[data-logo-wall-item]'))
    .map((item) => {
      const parent =
        item.querySelector('[data-logo-wall-target-parent]') || item
      const target = parent.querySelector('[data-logo-wall-target]')
      // Markup is inconsistent: the testimonial sometimes sits inside the slot,
      // sometimes as a sibling. Find it in the item and normalize it into the
      // slot so its overlay positions against the slot.
      const testimonial = item.querySelector(TESTIMONIAL_SELECTOR)
      if (testimonial && testimonial.parentElement !== parent) {
        parent.appendChild(testimonial)
      }
      const isFixed = !!target && target.classList.contains('is-last')
      return { parent, target, testimonial, isFixed }
    })
    .filter((s) => s.target)

  return slots.length ? slots : null
}

// Reveal / hide a slot's current testimonial.
function showTestimonial(slot) {
  if (!slot.current || !slot.current.testimonial) return
  slot.parent.classList.add('is-showing-testimonial')
  slot.current.testimonial.classList.add('is-visible')
  slot.current.testimonial.setAttribute('aria-hidden', 'false')
}

function hideTestimonial(slot) {
  slot.parent.classList.remove('is-showing-testimonial')
  if (slot.current && slot.current.testimonial) {
    slot.current.testimonial.classList.remove('is-visible')
    slot.current.testimonial.setAttribute('aria-hidden', 'true')
  }
}

function setupLogoWall(root) {
  const slots = resolveSlots(root)
  if (!slots) return

  const cycling = slots.filter((s) => !s.isFixed)
  // Each cycling slot starts with whatever is already in the DOM.
  cycling.forEach((slot, i) => {
    slot.current = { target: slot.target, testimonial: slot.testimonial }
    slot.busy = false
    slot.hovered = false
    if (slot.testimonial) slot.testimonial.setAttribute('aria-hidden', 'true')
    else console.warn(`[logo-wall] slot ${i} has no testimonial`)
  })
  console.log(
    `[logo-wall] resolved ${slots.length} slots — ${cycling.length} cycling, ${
      slots.length - cycling.length
    } fixed`
  )

  // Hover / focus → pause the wall + show that slot's testimonial.
  let loopTl = null
  let onScreen = false

  const maybeResume = () => {
    if (!loopTl) return
    const anyHovered = cycling.some((s) => s.hovered)
    if (onScreen && !document.hidden && !anyHovered) loopTl.play()
  }

  const setActive = (slot, on) => {
    if (slot.hovered === on) return
    slot.hovered = on
    if (on) {
      console.log('[logo-wall] hover → pause + show testimonial')
      loopTl && loopTl.pause()
      // Finish any in-flight swap instantly so the whole wall is settled before
      // the testimonial shows. Swap tweens run outside loopTl, so pausing the
      // loop alone wouldn't stop a roll already in progress — without this the
      // rolling logo (inline autoAlpha) bleeds through under the testimonial,
      // and slot.current still points at the outgoing entry.
      cycling.forEach((s) => s.finishSwap && s.finishSwap())
      showTestimonial(slot)
    } else {
      console.log('[logo-wall] unhover → resume')
      hideTestimonial(slot)
      maybeResume()
    }
  }

  cycling.forEach((slot) => {
    if (slot.testimonial) slot.parent.setAttribute('tabindex', '0')
    slot.parent.addEventListener('mouseenter', () => setActive(slot, true))
    slot.parent.addEventListener('mouseleave', () => setActive(slot, false))
    slot.parent.addEventListener('focusin', () => setActive(slot, true))
    slot.parent.addEventListener('focusout', () => setActive(slot, false))
  })

  // Reduced motion: static logos, no loop — hover/focus testimonial still works.
  if (reduceMotion.matches || cycling.length < 1) return

  // Build the cycle pool (virtual clones until this becomes a CMS list).
  const cloneEntry = (slot) => ({
    target: slot.current.target.cloneNode(true),
    testimonial: slot.current.testimonial
      ? slot.current.testimonial.cloneNode(true)
      : null,
  })

  const factor = Math.max(
    2,
    parseInt(root.getAttribute('data-logo-wall-pool'), 10) ||
      DEFAULT_POOL_FACTOR
  )
  let pool = []
  for (let r = 1; r < factor; r++) {
    cycling.forEach((slot) => pool.push(cloneEntry(slot)))
  }
  console.log(
    `[logo-wall] pool factor ${factor} → ${pool.length} virtual copies`
  )
  // Reset inherited state on the cloned testimonials.
  pool.forEach((entry) => {
    if (entry.testimonial) {
      entry.testimonial.classList.remove('is-visible')
      entry.testimonial.setAttribute('aria-hidden', 'true')
    }
  })

  const shuffleEnabled = root.getAttribute('data-logo-wall-shuffle') !== 'false'
  if (shuffleEnabled) pool = shuffle(pool)

  root.classList.add('is-cycling')

  // Slide the current logo out and the next pool entry in. Its testimonial rides
  // along (hidden) so a later hover matches the logo that settled here.
  function swapSlot(slot) {
    if (slot.busy || !pool.length) return
    slot.busy = true

    const incoming = pool.shift()
    const outgoing = slot.current

    if (incoming.testimonial) {
      incoming.testimonial.classList.remove('is-visible')
      slot.parent.appendChild(incoming.testimonial)
    }

    // Incoming overlays absolutely (is-incoming) so it doesn't push the slot while
    // the outgoing logo still sizes it. Both roll up together (clipped by the
    // slot's overflow:hidden) so they never split apart near the centre.
    incoming.target.classList.add('is-incoming')
    gsap.set(incoming.target, { yPercent: SWAP_TRAVEL, autoAlpha: 0 })
    slot.parent.appendChild(incoming.target)

    // Settle the swap to its final DOM state. Idempotent (guards on slot.busy) so
    // it's safe whether the timeline completes naturally or a hover forces it via
    // slot.finishSwap(). clearProps wipes GSAP's inline opacity/visibility so the
    // CSS hover-hide can win once incoming becomes the slot's current logo.
    const finish = () => {
      if (!slot.busy) return
      // Promote incoming to the in-flow sizer, then drop outgoing — same tick,
      // so the slot never loses its height.
      incoming.target.classList.remove('is-incoming')
      outgoing.target.remove()
      if (outgoing.testimonial) outgoing.testimonial.remove()
      gsap.set(outgoing.target, { clearProps: 'all' })
      gsap.set(incoming.target, { clearProps: 'all' })
      pool.push(outgoing)
      slot.current = incoming
      slot.busy = false
      if (slot.swapTl) {
        slot.swapTl.kill()
        slot.swapTl = null
      }
      slot.finishSwap = null
    }
    slot.finishSwap = finish

    // One timeline owns both rolls so a hover can snap the swap to its end
    // (slot.finishSwap) and leave the wall fully settled before the testimonial.
    slot.swapTl = gsap
      .timeline({ onComplete: finish })
      .to(
        incoming.target,
        { yPercent: 0, autoAlpha: 1, duration: SWAP_DURATION, ease: SWAP_EASE },
        0
      )
      .to(
        outgoing.target,
        {
          yPercent: -SWAP_TRAVEL,
          autoAlpha: 0,
          duration: SWAP_DURATION,
          ease: SWAP_EASE,
        },
        0
      )
  }

  // One slot rotates per tick, in shuffled order.
  let pattern = shuffle(cycling.map((_, i) => i))
  let patternIndex = 0

  loopTl = gsap.timeline({ repeat: -1, repeatDelay: LOOP_DELAY, paused: true })
  loopTl.call(() => {
    if (cycling.some((s) => s.hovered)) return
    const slotIndex = pattern[patternIndex % cycling.length]
    patternIndex++
    console.log(
      `[logo-wall] tick → swap slot ${slotIndex} (pool ${pool.length})`
    )
    swapSlot(cycling[slotIndex])
  })

  // Play only while the section is on-screen. IntersectionObserver fires once on
  // observe (so it self-starts if already visible) and is stable across other
  // components' ScrollTrigger refreshes — unlike a scroll trigger here.
  const io = new window.IntersectionObserver(
    (entries) => {
      onScreen = entries[0].isIntersecting
      console.log(`[logo-wall] visibility → onScreen ${onScreen}`)
      if (onScreen) maybeResume()
      else loopTl.pause()
    },
    { threshold: 0 }
  )
  io.observe(root)

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) loopTl.pause()
    else maybeResume()
  })
}

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='logo-wall']
 */
export default function (elements) {
  if (!gsap) {
    console.warn('[logo-wall] GSAP not found on window — skipping')
    return
  }
  console.log(`[logo-wall] loaded — ${elements.length} wall(s)`)
  elements.forEach(setupLogoWall)
}
