---
name: create-page
description: Scaffold a new page bundle and create its documentation
argument-hint: '[name]'
---

# Create Page: $ARGUMENTS

## Step 0 — Gather purpose

Read the user's message and check if it already describes what the page bundle does (e.g., "create a pricing page that handles tier toggling").

- **If yes** — extract that as the purpose. Do not ask again.
- **If no** — ask: *"What does this page bundle do?"* Wait for the answer before continuing.

Also note: if the description implies a specific library (e.g., GSAP for animations), plan to add the relevant import to the scaffolded file after it's created.

## Step 1 — Scaffold the page bundle

Run the create-page script:

```
npm run create-page -- $ARGUMENTS
```

If the script fails (page already exists, etc.), stop and report the error. Do not continue.

After the script runs, if the purpose implies library imports, edit the scaffolded file to add them at the top.

## Step 2 — Read project info

Read `package.json` and extract the repo path from `repository.url` (e.g. `wonderup-agency/starter`). Use it to build the CDN base:

```
https://cdn.jsdelivr.net/gh/<owner>/<repo>@main/dist
```

If the repo path isn't found, use `<owner>/<repo>` as a placeholder.

## Step 3 — Create the page doc

Create `.claude/rules/pages/$ARGUMENTS.md`:

````markdown
# <page-name>

## Purpose

<Use the actual purpose from Step 0 — no placeholders>

## Webflow Setup

Page Settings → Custom Code → Before `</head>`:

```html
<link rel="preload" as="script" href="https://cdn.jsdelivr.net/gh/<owner>/<repo>@main/dist/<page-path>.js" crossorigin>
<script>
  (function () {
    var base = window.__devBase || (localStorage.dev ? 'http://127.0.0.1:8080' : 'https://cdn.jsdelivr.net/gh/<owner>/<repo>@main/dist')
    var s = document.createElement('script')
    s.src = base + '/<page-path>.js'
    s.type = 'module'
    s.defer = true
    document.head.appendChild(s)
  })()
</script>
```

## Behavior

- **On load**: <One sentence describing what runs on page load, derived from the purpose>

## Dependencies

<List any imports added in Step 1, or "None.">
````

Fill in the actual `<owner>/<repo>` and `<page-path>` values (e.g. `wonderup-agency/starter` and `pricing` or `blog/post`).

## Step 4 — Open in editor

```
code src/pages/$ARGUMENTS.js
```

## Step 5 — Confirm

Tell the user:

- The file and doc that were created
- Next steps as a short checklist:
  - Paste the snippet into Webflow Page Settings → Custom Code → Before `</head>`
  - Write the page logic in the new file
  - Run `npm run build` before deploying
