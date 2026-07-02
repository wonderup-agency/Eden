/*
  Component: blog-post · data-component="blog-post"
  Orchestrates the whole article reading experience on one root: table of contents,
  image lightbox, collapsible long tables, share actions and academic references. Each
  behavior is an isolated module (a throw in one never breaks the others). One attribute
  in Webflow drives everything inside the article.
  CSS → the per-module blocks in webflow-head.css · Docs → .claude/rules/components/blog-post.md
*/

import { initToc } from './toc.js'
import { initLightbox } from './lightbox.js'
import { initTableCollapse } from './table-collapse.js'
import { initShare } from './share.js'
import { initReferences } from './references.js'
import { initFigures } from './figures.js'

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='blog-post']
 */
export default function (elements) {
  const hooks = []

  elements.forEach((root) => {
    run('figures', () => initFigures(root)) // wrap figure + caption before lightbox scans images
    hooks.push(run('toc', () => initToc(root)))
    run('lightbox', () => initLightbox(root)) // async — fire and forget
    hooks.push(run('table-collapse', () => initTableCollapse(root)))
    run('share', () => initShare(root))
    run('references', () => initReferences(root))
  })

  const live = hooks.filter((h) => h && typeof h.resize === 'function')
  if (!live.length) return

  return {
    resize() {
      live.forEach((h) => h.resize())
    },
  }
}

// Isolate each behavior so one throwing doesn't abort the rest of the article.
function run(name, fn) {
  try {
    return fn()
  } catch (err) {
    console.error(`[blog-post] ${name} init failed`, err)
    return null
  }
}
