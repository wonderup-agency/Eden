/*
  Module: lightbox — loaded by the blog-post orchestrator (data-component="blog-post")
  Turns every article image into a PhotoSwipe figure viewer: zoom/pan, inline caption in
  the top bar, prev/next + counter (PhotoSwipe core), plus custom download / share buttons.
  PhotoSwipe (v5) is loaded site-wide from CDN in the Webflow head (window globals) — see the doc.
  CSS → ./styles/lightbox.css (+ PhotoSwipe core CSS via CDN) · Docs → .claude/rules/components/lightbox.md
*/

const READY_TRIES = 160 // × READY_GAP ms ≈ 8s before giving up on the CDN globals
const READY_GAP = 50
const PADDING = { top: 60, bottom: 60, left: 24, right: 24 } // breathing room around the image

// Crisp SVG glyphs (currentColor) — replace the mismatched unicode chars.
const ICON_SHARE =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5 8.6 10.5"/></svg>'
const ICON_DOWNLOAD =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>'

/**
 * @param {HTMLElement} root - A blog-post article root (all its <img> become figures)
 */
export function initLightbox(root) {
  return setup(root)
}

async function setup(root) {
  try {
    await whenReady(() => window.PhotoSwipeLightbox && window.PhotoSwipe)
  } catch {
    console.warn(
      '[lightbox] PhotoSwipe not found on window — paste the CDN snippet in the Webflow head'
    )
    return
  }

  // Every article image except icons opted out or images that are already links.
  const figures = Array.from(root.querySelectorAll('img')).filter(
    (img) => !img.closest('a') && !img.closest('[data-lightbox-ignore]')
  )
  if (!figures.length) return

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const slides = await Promise.all(
    figures.map(async (img) => {
      const { w, h } = await imageSize(img)
      return {
        src: fullSrc(img),
        width: w,
        height: h,
        alt: img.alt,
        caption: caption(img),
      }
    })
  )

  const lightbox = new window.PhotoSwipeLightbox({
    dataSource: slides,
    pswpModule: window.PhotoSwipe,
    showHideAnimationType: reduce ? 'none' : 'zoom',
    bgOpacity: 0.92,
    padding: PADDING, // keep the image off the top bar and the viewport edges
    zoom: false, // we register our own buttons; core zoom gestures still work
    counter: true,
    arrowKeys: true,
  })

  registerUI(lightbox)
  lightbox.init()

  // Make each image an accessible trigger.
  figures.forEach((img, i) => {
    img.classList.add('lightbox_img')
    img.setAttribute('role', 'button')
    img.setAttribute('tabindex', '0')
    img.setAttribute(
      'aria-label',
      `Open figure${img.alt ? `: ${img.alt}` : ''}`
    )
    const open = () => lightbox.loadAndOpen(i)
    img.addEventListener('click', open)
    img.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        open()
      }
    })
  })
}

// Custom PhotoSwipe UI: inline caption in the top bar (next to the icons), download, share.
function registerUI(lightbox) {
  lightbox.on('uiRegister', () => {
    const ui = lightbox.pswp.ui

    // Caption lives in the top bar — the counter's margin-right:auto pushes it and the
    // buttons into the right cluster, so the note sits right beside the icons.
    ui.registerElement({
      name: 'caption-bar',
      order: 6,
      appendTo: 'bar',
      onInit: (el, pswp) => {
        el.className = 'pswp__caption-bar'
        const update = () => {
          const cap = pswp.currSlide?.data.caption || ''
          el.textContent = cap
          el.title = cap
          el.classList.toggle('is-empty', !cap)
        }
        pswp.on('change', update)
        update() // populate the first slide too (change doesn't fire on open)
      },
    })

    ui.registerElement({
      name: 'download',
      order: 8,
      isButton: true,
      tagName: 'a',
      title: 'Download',
      html: ICON_DOWNLOAD,
      onInit: (el, pswp) => {
        el.setAttribute('target', '_blank')
        el.setAttribute('rel', 'noopener')
        el.setAttribute('download', '')
        pswp.on('change', () => {
          el.href = pswp.currSlide?.data.src || ''
        })
      },
    })

    ui.registerElement({
      name: 'share',
      order: 7,
      isButton: true,
      title: 'Share',
      html: ICON_SHARE,
      onClick: (e, el, pswp) => share(pswp.currSlide?.data.src),
    })
  })
}

async function share(url) {
  if (!url) return
  if (window.navigator.share) {
    try {
      await window.navigator.share({ url })
    } catch {
      /* user dismissed */
    }
  } else if (window.navigator.clipboard?.writeText) {
    window.navigator.clipboard.writeText(url)
  }
}

// Largest candidate in srcset (by width descriptor), else currentSrc/src.
function fullSrc(img) {
  const set = img.getAttribute('srcset')
  if (set) {
    const best = set
      .split(',')
      .map((part) => {
        const [u, d] = part.trim().split(/\s+/)
        return { u, w: d?.endsWith('w') ? parseInt(d, 10) : 0 }
      })
      .sort((a, b) => b.w - a.w)[0]
    if (best?.u) return best.u
  }
  return img.currentSrc || img.src
}

function caption(img) {
  const fig = img.closest('figure')
  const cap = fig?.querySelector('figcaption')
  return (cap?.textContent || img.alt || '').trim()
}

// Natural dimensions: from the live img if loaded, else probe the full-res source.
function imageSize(img) {
  if (img.naturalWidth)
    return Promise.resolve({ w: img.naturalWidth, h: img.naturalHeight })
  return new Promise((resolve) => {
    const probe = new window.Image()
    probe.onload = () =>
      resolve({ w: probe.naturalWidth, h: probe.naturalHeight })
    probe.onerror = () =>
      resolve({ w: img.width || 1600, h: img.height || 1066 })
    probe.src = fullSrc(img)
  })
}

function whenReady(check, tries = READY_TRIES, gap = READY_GAP) {
  return new Promise((resolve, reject) => {
    if (check()) return resolve()
    let n = 0
    const id = window.setInterval(() => {
      if (check()) {
        window.clearInterval(id)
        resolve()
      } else if (++n >= tries) {
        window.clearInterval(id)
        reject(new Error('timeout'))
      }
    }, gap)
  })
}
