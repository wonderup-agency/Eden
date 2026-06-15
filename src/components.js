// --------------------------------------------------
// Component Registry
// --------------------------------------------------
// Each entry maps a data-component attribute to a lazy import.
// Components only load when their selector exists on the page.
//
// 2 ways to add a component:
//
// 1. Ask Claude  → "create a component called calculator"
// 2. Terminal    → npm run create-component -- calculator
//
// Both scaffold the file and add an entry here automatically.
// --------------------------------------------------

export default [
  {
    selector: "[data-component='number-counter']",
    importFn: () => import('./components/number-counter.js'),
  },
  {
    selector: "[data-component='scroll-morph']",
    importFn: () => import('./components/scroll-morph.js'),
  },
  {
    selector: "[data-component='logo-wall']",
    importFn: () => import('./components/logo-wall.js'),
  },
  {
    selector: "[data-component='tabs-stats']",
    importFn: () => import('./components/tabs-stats.js'),
  },
  {
    selector: "[data-component='tabs-architected']",
    importFn: () => import('./components/tabs-architected.js'),
  },
  {
    selector: "[data-component='hero']",
    importFn: () => import('./components/hero.js'),
  },
  {
    // Cross-cutting reveal — keyed on a boolean attribute, not data-component,
    // so any heading/text can opt in with data-title-animation="True".
    selector: "[data-title-animation='True']",
    importFn: () => import('./components/title-animation.js'),
  },
  {
    selector: "[data-component='nav']",
    importFn: () => import('./components/nav.js'),
  },
  {
    selector: "[data-component='paradigm']",
    importFn: () => import('./components/paradigm.js'),
  },
]
