# Webflow JavaScript Starter

Template for Webflow projects at Wonderup. Bundles custom JavaScript and CSS with Rollup, deploys via jsDelivr CDN, and is built around a Claude Code–driven workflow.

## Getting Started

### 1. Create your repo

Use this template on GitHub to create a new repository, then clone it locally:

```bash
git clone https://github.com/your-org/your-repo.git
cd your-repo
npm install
```

> A GitHub Actions workflow runs automatically ~60 seconds after repo creation and patches `webflow-snippet.html` and `package.json` with your actual repo name. If you want to do it immediately without waiting, run `npm run setup` — it's idempotent, safe to run multiple times.

### 2. Open in Claude Code

```bash
claude
```

Claude loads the full project context — architecture, conventions, and all component/page docs. From here, most work happens through conversation.

### 3. Webflow setup

1. Copy the contents of `webflow-snippet.html` into **Webflow → Project Settings → Custom Code → Head Code**.
2. Publish your Webflow site.
3. To develop locally: open devtools on your Webflow site and run `localStorage.dev = '1'`. The page reloads into dev mode (pointing to `localhost:8080`) and shows a green **DEV** button in the corner. Click it to switch back to production.

To wire up a component on any Webflow element, add `data-component="<name>"` to it. The component loads automatically on pages where that attribute is present.

---

## Daily Workflow

### Start the dev server

The dev server is managed manually — start it when you begin working:

```bash
npm run dev
```

Rollup watches for file changes and rebuilds automatically. The local server runs at `http://127.0.0.1:8080`.

### Working with Claude

Everything else — creating components and pages, committing, deploying, auditing — goes through Claude. Describe what you want; Claude handles the file, the registry, and the docs.

```
"Create a calculator component"
"Create a pricing page bundle"
"Commit my changes"
"Deploy"
"Audit the project"
```

See the [Skills Reference](#skills-reference) below for what each of these does.

---

## Skills Reference

Claude has project-specific skills for all common operations. Trigger them by describing what you want — Claude recognises the intent and runs the right skill automatically.

### Create component

```
"Create a calculator component"
"Create a forms/contact component"
```

- Scaffolds `src/components/<name>.js` with the standard lifecycle pattern
- Registers it in `src/components.js` so main.js picks it up
- Creates `.claude/rules/components/<name>.md` for persistent Claude context
- Tells you the `data-component="<name>"` attribute to add in Webflow

For nested paths (e.g. `forms/contact`), the file lives at `src/components/forms/contact.js` and the Webflow attribute is `data-component="contact"`.

### Create page bundle

```
"Create a pricing page bundle"
"Create a blog/post page bundle"
```

- Scaffolds `src/pages/<name>.js` as a standalone Rollup entry point
- Creates `.claude/rules/pages/<name>.md`
- Outputs the per-page Webflow snippet with dev/prod URL switching — paste it into **Page Settings → Custom Code → Before `</head>`**

### Rename component

```
"Rename the calculator component to price-calculator"
```

- Moves the component file
- Updates the selector and import path in `src/components.js`
- Renames the doc in `.claude/rules/components/`

### Delete component / page

```
"Delete the calculator component"
"Delete the pricing page bundle"
```

- Removes the file
- Removes the registry entry (components only)
- Deletes the doc

### Audit

```
"Audit the project"
```

The audit skill checks project health across four dimensions:

- **Orphan components** — files in `src/components/` with no matching registry entry
- **Ghost registrations** — entries in `src/components.js` pointing to files that don't exist
- **Missing docs** — components or pages with no `.md` doc in `.claude/rules/`
- **Stale docs** — doc content that no longer matches the actual code

Report only — Claude won't auto-fix anything without your approval. Run this periodically, especially after manual file moves or any work done outside Claude.

### Commit

```
"Commit my changes"
```

- Reviews all staged and unstaged changes
- Generates a conventional commit message (`feat`, `fix`, `chore`, `refactor`, etc.)
- Creates the commit — prompts you before pushing

### Deploy

```
"Deploy"
```

- Runs `npm run build` — lint → format → bundle → minify JS → extract and minify CSS
- Commits `dist/` with a build commit
- Pushes to `main` — jsDelivr serves from `@main` and propagates within minutes

A GitHub Actions workflow (`.github/workflows/purge-cdn.yml`) runs automatically after every push to `main` that touches `dist/`. It calls the jsDelivr purge API for every file in `dist/`, so CDN cache is cleared within seconds — no manual step needed.

---

## Quick Reference

| What you want          | Say to Claude                        |
| ---------------------- | ------------------------------------ |
| Create a component     | "Create a `<name>` component"        |
| Create a page bundle   | "Create a `<name>` page bundle"      |
| Rename a component     | "Rename `<old>` to `<new>`"          |
| Delete a component     | "Delete the `<name>` component"      |
| Delete a page          | "Delete the `<name>` page bundle"    |
| Commit changes         | "Commit my changes"                  |
| Build and deploy       | "Deploy"                             |
| Check project health   | "Audit the project"                  |

---

## Manual CLI Reference

Claude handles these automatically, but the underlying commands are:

```bash
npm run dev                          # Rollup watch + local server
npm run build                        # Production build (lint, format, minify)
npm run create-component -- <name>   # Scaffold a component
npm run create-page -- <name>        # Scaffold a page bundle
npm run tunnel                       # Cloudflare tunnel to local server
npm run setup                        # Patch repo name (run once after cloning)
```
