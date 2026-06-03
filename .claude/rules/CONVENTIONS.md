# Conventions

## Language & Modules

- ES modules everywhere (`import`/`export`), never CommonJS (`require`/`module.exports`)
- `type: "module"` is set in package.json
- 2-space indentation
- Prettier defaults for all formatting (no config file, `.prettierignore` excludes `dist`)

## Naming

- **Files**: lowercase, hyphen-separated (`create-component.js`, `rollup.config.dev.js`)
- **Components**: named after their `data-component` attribute value (`calculator.js` → `data-component="calculator"`)
- **Nested components**: mirror directory path (`forms/contact.js` → `data-component="contact"`)
- **Pages**: named to match the Webflow page they target (`pricing.js`, `blog/post.js`)
- **Variables/functions**: camelCase
- **Constants**: camelCase (not UPPER_SNAKE — e.g., `flatItems`, not `FLAT_ITEMS`), except for module-level config-like objects which use UPPER_SNAKE (`MENU_SECTIONS`)

## Exports

- **Components**: default export a function that receives `elements` array
- **Page bundles**: no export required, they're standalone entry points
- **Utilities/config**: named exports preferred, destructure on import
- **Config object** (`src/config.js`): default export

## Component Pattern

Every component follows the same structure:

```js
export default function (elements) {
  // Init logic
  elements.forEach((el) => {
    /* ... */
  })

  // Optional lifecycle hooks
  return {
    resize() {},
    breakpoint(current, previous) {},
  }
}
```

- The function receives all matching DOM elements as an array
- Only runs if matching elements exist on the page (after DOMContentLoaded)
- Return lifecycle hooks only if needed — omit if not used
- `resize` is debounced (150ms) — fires once after the user stops resizing
- `breakpoint` fires only when crossing a Webflow breakpoint threshold. Values: `1920` (2XL), `1440` (XL), `1280` (Large), `992` (Desktop/base), `768` (Tablet), `480` (Mobile Landscape), `0` (Mobile Portrait). Receives the new and previous breakpoint values

## Component Registration

Components are registered in `src/components.js` as an array of `{ selector, importFn }` objects. The `create-component` script manages this automatically. Manual edits follow the same pattern:

```js
{
  selector: "[data-component='name']",
  importFn: () => import('./components/name.js'),
}
```

## CSS

- Import CSS directly in JS files: `import './styles/component.css'`
- PostCSS handles nesting and autoprefixer (stage 2)
- All CSS extracts to a single `dist/styles.css`
- No CSS-in-JS, no CSS modules

## Error Handling

- Components wrap in try/catch — a failing component doesn't break others
- `global.js` loads with its own try/catch
- Use `console.log` for loading info, `console.warn` for non-critical issues, `console.error` for failures
- Production builds strip all `console.*` calls via Terser

## Scripts

- Node scripts live in `scripts/`
- Scripts use `picocolors` for terminal output coloring
- Scripts are Node-only, never bundled for the browser
