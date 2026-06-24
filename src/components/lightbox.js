/*
  Component: lightbox · data-component="lightbox"
  Turns every article image into a PhotoSwipe figure viewer: zoom/pan, caption panel,
  prev/next + counter (PhotoSwipe core), plus custom download / share / info buttons.
  PhotoSwipe (v5) is loaded site-wide from CDN in the Webflow head (window globals) — see the doc.
  CSS → ./styles/lightbox.css (+ PhotoSwipe core CSS via CDN) · Docs → .claude/rules/components/lightbox.md
*/

const READY_TRIES = 160 // × READY_GAP ms ≈ 8s before giving up on the CDN globals
const READY_GAP = 50

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='lightbox']
 */
export default function (elements) {
  elements.forEach((root) => setup(root))
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

// Custom PhotoSwipe UI: caption panel (toggled by an info button), download, share.
function registerUI(lightbox) {
  lightbox.on('uiRegister', () => {
    const ui = lightbox.pswp.ui

    ui.registerElement({
      name: 'caption-panel',
      appendTo: 'root',
      onInit: (el, pswp) => {
        el.className = 'pswp__caption-panel' // closed by default — opened by the ⓘ button
        const text = document.createElement('div')
        text.className = 'pswp__caption-text'
        el.appendChild(text)
        const update = () => {
          const cap = pswp.currSlide?.data.caption || ''
          text.textContent = cap
          el.classList.toggle('is-empty', !cap)
        }
        pswp.on('change', update)
        update() // populate the first slide too (change doesn't fire on open)
      },
    })

    ui.registerElement({
      name: 'info',
      order: 9,
      isButton: true,
      title: 'Toggle caption',
      html: 'ⓘ',
      onClick: (e, el, pswp) => {
        pswp.element
          .querySelector('.pswp__caption-panel')
          ?.classList.toggle('is-open')
      },
    })

    ui.registerElement({
      name: 'download',
      order: 8,
      isButton: true,
      tagName: 'a',
      title: 'Download',
      html: '⬇',
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
      html: '↗',
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
