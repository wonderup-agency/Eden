# Rollup Configuration

Two separate configs: `rollup.config.dev.js` (development) and `rollup.config.prod.js` (production).

## Shared structure

Both configs share the same entry points and helper functions:

### Entry points

- `src/main.js` — always included as the `main` entry. It imports `src/styles.js`, which is how every component's CSS reaches the build.
- `src/pages/*.js` — automatically discovered by `getPageEntries()`, which recursively reads `src/pages/` and maps each `.js` file to a named entry (e.g., `src/pages/blog/post.js` → entry name `blog/post`). Silently returns `{}` if the directory doesn't exist.

### `checkGlobalJs` plugin

Custom Rollup plugin that runs at `buildStart`. Checks if `src/components/global.js` exists using `accessSync`. If missing, emits a Rollup warning (not an error) — `main.js` handles the missing file gracefully at runtime with a try/catch.

### Output

Both use `dir: 'dist'`, `format: 'es'`, `entryFileNames: '[name].js'`, `chunkFileNames: '[name].js'`.

> **Chunk names carry no content hash, deliberately** (changed 2026-08-06). The CDN URL is
> already pinned to an immutable commit SHA (`…/eden@<sha>/dist/…`), so a content hash bought
> nothing for cache-busting — jsDelivr already caches per SHA — while making every chunk
> filename change on each build. That mattered once the head snippet started declaring
> `modulepreload` for the LCP-critical chunks (`global.js`, `hero.js`, `word-reveal.js`,
> `nav.js`): with hashes, those links would 404 after every deploy. Stable names make the
> preload list a fixed contract.
>
> **The cost**: `@main` is no longer safe to serve from, because two builds produce the same
> filenames with different content and a CDN/browser cache can mix them. `@main` was already
> only an escape hatch (see `ARCHITECTURE.md` → Deployment Flow) — treat it as unusable now.

## Dev config (`rollup.config.dev.js`)

Plugins: `del` → `checkGlobalJs` → `resolve` → `commonjs` → `postcss`

- **Sourcemaps**: Enabled (`sourcemap: true` in output, `sourceMap: true` in postcss).
- **PostCSS**: Extracts CSS to `dist/styles.css` (`extract: 'styles.css'`), `postcss-preset-env` stage 2, minimized. The input is `src/styles.js` — a CSS-only entry point imported by `main.js` that lists every `styles/*.css` file. **Its import order is the emit order**, i.e. the cascade order. Currently ~35 KB minified / ~6.4 KB gzipped.
- **Clean**: `rollup-plugin-delete` removes `dist/*` once on the first build (`runOnce: true`). In watch mode, subsequent rebuilds do not re-clean, so the dev server is uninterrupted.
- **No terser**: Code is not minified.

## Prod config (`rollup.config.prod.js`)

Plugins: `del` → `checkGlobalJs` → `resolve` → `commonjs` → `postcss` → `terser`

- **Sourcemaps**: Disabled (`sourcemap: false`).
- **Clean**: `rollup-plugin-delete` removes `dist/*` before each build.
- **PostCSS**: Extracts CSS to `dist/styles.css` (`extract: 'styles.css'`). Same `postcss-preset-env` stage 2 + minimize. Same as dev.
- **Terser**: Minifies JS, strips all `console.*` calls (`drop_console: true`), removes all comments (`comments: false`).
- **Prebuild**: The `npm run build` script has a `prebuild` hook in package.json that runs `eslint src/ && prettier . --write` before Rollup executes.

## Key differences summary

|               | Dev                                    | Prod                                 |
| ------------- | -------------------------------------- | ------------------------------------ |
| Sourcemaps    | Yes                                    | No                                   |
| CSS handling  | Extracted to `dist/styles.css`         | Extracted to `dist/styles.css`       |
| Minification  | No                                     | Terser (JS) + PostCSS minimize (CSS) |
| Console logs  | Kept                                   | Stripped                             |
| Comments      | Kept                                   | Stripped                             |
| Clean dist    | Yes, once on first build (`runOnce`)   | Yes, every build (`del`)             |
| Lint + format | No                                     | Yes (prebuild hook)                  |

## Adding plugins

- Dev plugins go in `rollup.config.dev.js` only.
- Prod plugins go in `rollup.config.prod.js` only. Keep `del` first (cleans dist) and `terser` last (minifies final output).
- Shared plugins (resolve, commonjs, postcss) must be updated in both files — they are not shared via a common module.
