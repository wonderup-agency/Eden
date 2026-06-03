# Scaffolding Scripts

Node scripts in `scripts/` that scaffold new components and pages.

## create-component (`scripts/create-component.js`)

**Usage**: `npm run create-component -- <name>`

**What it does:**

1. Normalizes the name (lowercase, spaces → hyphens)
2. Checks if the file already exists at `src/components/<name>.js` — exits if so
3. Checks if the `data-component` name is already registered in `src/components.js` — exits if so
4. Creates the component file with a default-export scaffold (receives `elements` array, includes `resize` lifecycle hook)
5. Auto-registers the component in `src/components.js` by prepending a new `{ selector, importFn }` entry to the array
6. Prints the `data-component="<name>"` attribute to add in Webflow

**Nested paths**: `npm run create-component -- forms/contact` creates `src/components/forms/contact.js` and registers with `data-component="contact"` (basename only). If another component with the same basename already exists, the script shows a detailed error explaining the collision and suggesting a unique name.

**Scaffold output:**

```js
/*
Component: name
Webflow attribute: data-component="name"
*/

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='name']
 */
export default function (elements) {
  // Init: runs when the component loads
  elements.forEach((element) => {
    console.log(element)
  })

  // Return lifecycle hooks (optional)
  return {
    // Runs on window resize (debounced 150ms)
    resize() {},

    // Runs when crossing a Webflow breakpoint (1920/1440/1280/992/768/480)
    // breakpoint(current, previous) {},
  }
}
```

## create-page (`scripts/create-page.js`)

**Usage**: `npm run create-page -- <name>`

**What it does:**

1. Normalizes the name (lowercase, spaces → hyphens)
2. Checks if the file already exists at `src/pages/<name>.js` — exits if so
3. Reads `package.json` for the repo path (used for CDN URL)
4. Creates the page file with a comment block containing the Webflow per-page snippet
5. Prints the snippet to the terminal ready to copy-paste into Webflow

**Nested paths**: `npm run create-page -- blog/post` creates `src/pages/blog/post.js`.

**Scaffold output:**

```js
/*
Page bundle: name
Add to Webflow → Page Settings → Custom Code → Before </head>:

<link rel="preload" as="script" href="https://cdn.jsdelivr.net/gh/owner/repo@main/dist/name.js" crossorigin>
<script>
  (function () {
    var base = window.__devBase || (localStorage.dev ? 'http://127.0.0.1:8080' : 'https://cdn.jsdelivr.net/gh/owner/repo@main/dist')
    var s = document.createElement('script')
    s.src = base + '/name.js'
    s.type = 'module'
    s.defer = true
    document.head.appendChild(s)
  })()
</script>
*/

console.log('%c📄 [name] Page loaded', 'color: #a78bfa; font-weight: bold')
```

The snippet uses the same dev/prod switcher pattern as the main site-wide snippet:

- **Preload**: starts fetching the CDN bundle immediately (browser discards it in dev mode — harmless)
- **Inline switcher**: reads `window.__devBase` (set by the site-wide head snippet) or falls back to checking `localStorage.dev` directly
- Works automatically once the site-wide snippet is in place — no per-page manual URL swapping needed

## setup (`scripts/setup.js`)

**Usage**: `npm run setup`

**What it does:**

1. Reads the git remote URL via `git remote get-url origin`
2. Extracts `owner/repo` from the GitHub URL (e.g. `wonderup-agency/client-1`)
3. Detects the currently-configured repo path in `webflow-snippet.html` (matches the first jsDelivr CDN URL) — exits cleanly with "already configured" if it already matches the git remote (idempotent)
4. Replaces every occurrence of the old path with the new one across `webflow-snippet.html` and `README.md`
5. Updates `package.json`: `name` → repo name only (e.g. `client-1`), `repository.url` → correct GitHub URL
6. Prints a summary of what was updated

**Idempotency**: The guard compares the path baked into `webflow-snippet.html` against the git remote and exits early when they match. This handles three scenarios cleanly: a fresh clone with `your-repo` placeholders, a repo that's already been initialized, and a repo that was later renamed (drift gets corrected on next run).

**Error cases**: Exits with code 1 if there is no `origin` remote or if the remote URL is not a recognisable GitHub URL.

## Shared behavior

- Both scripts use `picocolors` for terminal output
- Input is sanitized: spaces become hyphens, forced lowercase
- Both exit with code 1 on missing args or duplicate files
- Directories are created recursively (`mkdirSync` with `{ recursive: true }`)
