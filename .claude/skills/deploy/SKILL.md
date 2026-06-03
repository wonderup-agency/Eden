---
name: deploy
description: Build, commit, and push a release to production
argument-hint: ''
---

# Deploy

Run the full release flow: build production assets, commit, and push.

> **Critical rule**: `dist/` must always be built with `npm run build` (`rollup.config.prod.js`) before deploying. Never commit a `dist/` built with `npm run dev` — dev builds contain sourcemaps and unminified code. This skill enforces this automatically.

## Step 1 — Check for uncommitted changes

Run `git status --porcelain`.

If there are **staged or unstaged changes** (excluding untracked files — i.e. `M`, `A`, `D`, `R` entries), stop and tell the user:

> You have uncommitted changes. Please commit or stash them before deploying.

Untracked files (`??`) are fine — they won't be included in the deploy commit.

## Step 2 — Run the production build

Run:

```
npm run build
```

This runs `eslint src/ && prettier . --write` (prebuild hook), then Rollup with `rollup.config.prod.js` — minified, no sourcemaps, no console logs.

If the build fails, stop and show the error output. Do not proceed to commit.

After the build, verify no `.map` files exist in `dist/`:

```
ls dist/*.map 2>/dev/null
```

If any `.map` files are found, the build used the wrong config. Stop and tell the user to run `npm run build` manually and check for errors.

## Step 3 — Commit and push

Run these commands sequentially:

```
git add dist/
git commit -m "build"
git push
```

If any git command fails, stop and show the error.

## Step 4 — Confirm

Tell the user the build succeeded and the push is done. Remind them that jsDelivr serves from `@main` — the new assets will be live once jsDelivr's cache refreshes (can take a few minutes; use the jsDelivr purge API for immediate updates).
