/*
  Component: paradigm · data-component="paradigm"
  Pinned scroll story: three text messages de-blur in/out one at a time; a glow blob
  rises behind them; the product image de-blurs in last as the final text settles up.
  CSS → ./styles/paradigm.css (paste into Webflow head) · Docs → .claude/rules/components/paradigm.md
*/

const { gsap } = window
const ScrollTrigger = window.ScrollTrigger

// Per-word reveal: de-blur + fade + rise in, dissolve back to blur out (symmetric).
const REVEAL = {
  from: { autoAlpha: 0, filter: 'blur(16px)', yPercent: 16 },
  to: {
    autoAlpha: 1,
    filter: 'blur(0px)',
    yPercent: 0,
    duration: 1.1,
    stagger: 0.09,
    ease: 'sine.out',
  },
  out: {
    autoAlpha: 0,
    filter: 'blur(16px)',
    yPercent: -16,
    duration: 0.9,
    stagger: 0.06,
    ease: 'sine.in',
  },
}

// Text to split: explicit hook → inner heading/paragraph (rich-text) → the message.
const textEl = (m) =>
  m.querySelector('[data-paradigm-text]') ||
  m.querySelector('h1,h2,h3,h4,h5,h6,p') ||
  m

// Wrap each word of `el` in a span (no SplitText plugin). Returns the word spans.
function splitWords(el) {
  const words = el.textContent.trim().split(/\s+/)
  el.textContent = ''
  return words.map((text, i) => {
    const wrap = document.createElement('span')
    wrap.className = 'paradigm_word-wrap'
    const word = document.createElement('span')
    word.className = 'paradigm_word'
    word.textContent = text
    wrap.appendChild(word)
    el.appendChild(wrap)
    if (i < words.length - 1) el.appendChild(document.createTextNode(' '))
    return word
  })
}

// Build the animation for one root. Returns rebuild() (re-run on resize / image load).
function setupRoot(root) {
  const track = root.querySelector('[data-paradigm-track]')
  const blob = root.querySelector('[data-paradigm-blob]')
  const visual = root.querySelector('[data-paradigm-visual]')
  const messagesWrap = root.querySelector('[data-paradigm-messages]')
  const messages = gsap.utils.toArray(
    root.querySelectorAll('[data-paradigm-message]')
  )

  if (!track || !messages.length) {
    console.warn(
      '[paradigm] missing [data-paradigm-track] or [data-paradigm-message]'
    )
    return null
  }

  // Stack the text layers so they crossfade in the same spot
  messages.forEach((m) => m.classList.add('is-overlap'))

  const wordsByMessage = messages.map((m) => splitWords(textEl(m)))
  const allWords = wordsByMessage.flat()

  // The hidden image reserves space below the text, pushing it above center. Offset
  // the text down by half that height so messages center; the last reveal returns it to y:0.
  const centerOffset = () =>
    visual
      ? (visual.offsetHeight +
          parseFloat(window.getComputedStyle(visual).marginTop || 0)) /
        2
      : 0

  const end = '+=' + (messages.length + 1) * 100 + '%'
  let tl = null

  // Gentle idle breathe (scale only, so it never fights the scroll-driven yPercent).
  if (blob)
    gsap.to(blob, {
      scale: 1.04,
      duration: 6,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
    })

  const build = () => {
    if (tl) {
      if (tl.scrollTrigger) tl.scrollTrigger.kill(true)
      tl.kill()
    }

    // Reset to a clean slate, then apply the initial states
    gsap.set(allWords, { clearProps: 'all' })
    gsap.set(messages, { autoAlpha: 1 })
    gsap.set(allWords, REVEAL.from)
    // First title is pre-revealed so the section is never blank as it scrolls in.
    gsap.set(wordsByMessage[0], {
      autoAlpha: 1,
      filter: 'blur(0px)',
      yPercent: 0,
    })
    gsap.set(messagesWrap, { y: centerOffset() }) // center the lone text
    if (visual)
      gsap.set(visual, { autoAlpha: 0, filter: 'blur(16px)', yPercent: 12 })
    if (blob) gsap.set(blob, { autoAlpha: 1, yPercent: 92 }) // parked low, peeking from the bottom

    tl = gsap.timeline({
      scrollTrigger: {
        trigger: track,
        start: 'top top', // begin when the element's top reaches the top of the viewport
        end,
        pin: true,
        scrub: 1,
        // Highest priority so its pin-spacing is computed first (sections below depend on it).
        refreshPriority: 1,
      },
    })

    messages.forEach((msg, i) => {
      const isLast = i === messages.length - 1
      // First title is pre-revealed (above); the rest de-blur in on scroll.
      if (i > 0) tl.to(wordsByMessage[i], REVEAL.to)
      tl.to({}, { duration: 0.5 }) // hold
      if (!isLast) tl.to(wordsByMessage[i], REVEAL.out)
    })
    // Just before the image, the blob rises from parked-low back to its resting spot.
    if (blob) {
      tl.to(blob, { yPercent: 0, duration: 1.4, ease: 'sine.out' })
      tl.to({}, { duration: 0.3 }) // small beat
    }

    // Last text settles up, then the image de-blurs in below it (sequential).
    tl.to(messagesWrap, { y: 0, duration: 1.1, ease: 'sine.out' })
    tl.to({}, { duration: 0.25 }) // beat — let the text fully land
    if (visual) {
      tl.to(visual, {
        autoAlpha: 1,
        filter: 'blur(0px)',
        yPercent: 0,
        duration: 1.1,
        ease: 'sine.out',
      })
      tl.to({}, { duration: 0.4 })
    }

    ScrollTrigger.refresh()
  }

  build()

  // Recompute once the image's real height is known
  const img = visual && visual.querySelector('img')
  if (img && !img.complete) img.addEventListener('load', build, { once: true })

  return build
}

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='paradigm']
 */
export default function (elements) {
  if (!gsap || !ScrollTrigger) {
    console.warn(
      '[paradigm] GSAP / ScrollTrigger not found on window — skipping'
    )
    return
  }
  gsap.registerPlugin(ScrollTrigger)

  // Reduced motion: leave the readable stacked layout, no animation
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const rebuilds = elements.map(setupRoot).filter(Boolean)

  return {
    // Rebuild on resize so the center offset and pin spacing stay exact
    resize() {
      rebuilds.forEach((rebuild) => rebuild())
    },
  }
}
