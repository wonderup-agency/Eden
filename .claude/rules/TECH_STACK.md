# Tech Stack

## Runtime & Language

- **JavaScript (ES modules)** — all source uses `import`/`export`, `type: "module"` in package.json
- **Node.js** — scripts, build tooling
- **Browser target** — components run in the browser, loaded as ES modules via `<script type="module">`

## Bundler

- **Rollup** — two configs: `rollup.config.dev.js` (dev) and `rollup.config.prod.js` (prod)
  - `@rollup/plugin-node-resolve` — resolves node_modules imports
  - `@rollup/plugin-commonjs` — converts CJS dependencies to ESM
  - `@rollup/plugin-terser` — minification (prod only)
  - `rollup-plugin-delete` — cleans `dist/` before prod builds
  - `rollup-plugin-postcss` — CSS processing and extraction

## CSS

- **PostCSS** with `postcss-preset-env` (stage 2) — nesting, autoprefixer
- CSS is extracted to `dist/styles.css` in both dev and prod
- CSS is imported directly in JS files — no separate CSS build step

## Linting & Formatting

- **ESLint** (v9, flat config) — `eslint.config.js` uses `@eslint/js` recommended + `eslint-config-prettier`
- **Prettier** — default config (no `.prettierrc` file, uses Prettier defaults)
- Runs automatically before prod builds via `prebuild` script

## Dev Server

- **http-server** — serves `dist/` on `http://127.0.0.1:8080` with CORS enabled
- **concurrently** — runs Rollup watch + http-server in parallel for `npm run dev`

## CDN & Deployment

- **jsDelivr** — serves production assets from GitHub via `cdn.jsdelivr.net/gh/owner/repo@version/dist/`
- Tagged releases (`@v1.0.0`) for instant cache invalidation
- `@main` branch reference available but aggressively cached

## Tunneling

- **Cloudflare Tunnel** (`cloudflared`) — exposes local server for testing on real devices/Webflow preview

## Dependencies

- **Runtime**: `picocolors` (used by scripts only, not bundled to browser)
- **Dev**: All other deps are devDependencies (Rollup, ESLint, Prettier, etc.)
- No frontend framework — vanilla JavaScript only
