/*
  Component: turning-data · data-component="turning-data"
  Plays a clip inside the monitor of a still photo, framed to the display.
  CSS lives in WEBFLOW (native Client-First styles), not here · Docs → .claude/rules/components/turning-data.md
*/

const VIDEO = '[data-turning-data="video"]'
const IN_VIEW = '0px 0px -15% 0px' // ≈ ScrollTrigger's "top 85%"

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='turning-data']
 */
export default function (elements) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  elements.forEach((root) => {
    try {
      setup(root, reduced)
    } catch (err) {
      console.error('[turning-data]', err)
    }
  })
}

function setup(root, reduced) {
  const video = root.querySelector(VIDEO)
  if (!video) {
    console.warn(
      '[turning-data] no [data-turning-data="video"] — nothing to play'
    )
    return
  }

  // Autoplay with sound is blocked outright, so an unmuted video never plays.
  // The autoplay attribute is stripped on purpose: playback is owned here, or
  // a below-the-fold clip would run from load.
  video.removeAttribute('autoplay')
  video.muted = true
  video.playsInline = true
  video.loop = true

  // Not a shorter animation: none. The photo's own screen carries the section.
  // pause() is required, not tidiness: the markup sets `autoplay` as its
  // no-JS fallback, and removeAttribute above cannot stop a clip that has
  // already started. Without this, reduced-motion visitors keep the video.
  if (reduced) {
    video.pause()
    return
  }

  let visible = false

  const sync = () => {
    if (visible && !document.hidden) {
      // Rejects on a policy block; the poster stays and nothing throws.
      video.play()?.catch(() => {})
    } else {
      video.pause()
    }
  }

  // window.-prefixed to match the project's eslint globals convention.
  new window.IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting
      sync()
    },
    { threshold: 0, rootMargin: IN_VIEW }
  ).observe(root)

  document.addEventListener('visibilitychange', sync)
}
