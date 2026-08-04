/*
  CSS entry point — the single place that decides what ships in dist/styles.css.
  Import order IS the cascade order, so keep it: base/site-wide first, then
  components, then the blog-post modules. Rollup's postcss plugin concatenates
  these into dist/styles.css; Webflow loads that file with one <link>.
  Docs → .claude/rules/ARCHITECTURE.md (CSS deployment)
*/

// ── Site-wide ────────────────────────────────────────────────────────
import './components/styles/custom.css'
import './components/styles/button.css'
import './components/styles/card-arrow-swap.css'
import './components/styles/card-animate.css'

// ── Components ───────────────────────────────────────────────────────
import './components/styles/nav.css'
import './components/styles/logo-wall.css'
import './components/styles/logos-marquee.css'
import './components/styles/paradigm.css'
import './components/styles/compouding.css'
import './components/styles/tabs-architected.css'
import './components/styles/tabs-foundation-model.css'
import './components/styles/tabs-imaging.css'
import './components/styles/tabs-stats.css'
import './components/styles/scroll-morph.css'
import './components/styles/halo-focus.css'
import './components/styles/impact-map.css'
import './components/styles/random-item.css'
import './components/styles/research-search.css'
import './components/styles/whitepapers.css'
import './components/styles/book-demo.css'

// ── blog-post modules ────────────────────────────────────────────────
import './components/blog-post/styles/toc.css'
import './components/blog-post/styles/lightbox.css'
import './components/blog-post/styles/references.css'
import './components/blog-post/styles/share.css'
import './components/blog-post/styles/table-collapse.css'
import './components/blog-post/styles/figures.css'
import './components/blog-post/styles/whitepapers-tables.css'
