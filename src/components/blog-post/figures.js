/*
  Module: figures — loaded by the blog-post orchestrator (data-component="blog-post")
  Webflow renders each image caption as a .w-embed > .wp-figcaption that is the NEXT sibling
  of the <figure> (not inside it), so it stacks below. This pairs each figure with that caption
  block and wraps the pair in a flex row so the caption sits beside the image.
  CSS → ./styles/figures.css (paste into Webflow head) · Docs → .claude/rules/components/figures.md
*/

const WRAP_CLASS = 'figure-aside'

/**
 * @param {HTMLElement} root - A blog-post article root
 */
export function initFigures(root) {
  const figures = root.querySelectorAll('figure.w-richtext-figure-type-image')
  figures.forEach((fig) => {
    if (fig.parentElement?.classList.contains(WRAP_CLASS)) return // idempotent
    const cap = captionAfter(fig)
    if (!cap) return
    const wrap = document.createElement('div')
    wrap.className = WRAP_CLASS
    fig.parentNode.insertBefore(wrap, fig)
    wrap.append(fig, cap)
  })
}

// The caption is the immediately-following .w-embed holding a .wp-figcaption.
function captionAfter(fig) {
  const next = fig.nextElementSibling
  return next && next.querySelector?.('.wp-figcaption') ? next : null
}
