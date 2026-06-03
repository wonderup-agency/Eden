---
name: rename-component
description: Rename a component — file, registry entry, and doc
argument-hint: '[old-name] [new-name]'
---

# Rename Component: $ARGUMENTS

## Step 0 — Parse arguments

`$ARGUMENTS` should contain two space-separated names: the old name and the new name.

Examples: `calculator calculator-v2`, `forms/contact forms/inquiry`

If fewer than two names are provided, stop and tell the user:

> Usage: `/rename-component old-name new-name`

## Step 1 — Validate the old component exists

1. Check that `src/components/<old-name>.js` exists. If not → stop and report.
2. Read `src/components.js` and confirm it has a registration entry for the old name. If not → stop and report.

## Step 2 — Validate the new name is available

1. Check that `src/components/<new-name>.js` does NOT exist. If it does → stop and report conflict.
2. Check that `src/components.js` does NOT already have a registration for the new name. If it does → stop and report conflict.

## Step 3 — Move the component file

Run:

```
mkdir -p <parent-dir-of-new-path>
mv src/components/<old-name>.js src/components/<new-name>.js
```

## Step 4 — Update the registry

Read `src/components.js` and edit it:

- Change the selector from `[data-component='<old-basename>']` to `[data-component='<new-basename>']`
- Change the import path from `./components/<old-name>.js` to `./components/<new-name>.js`

Where `<old-basename>` and `<new-basename>` are the last segment of the path (e.g., `forms/contact` → `contact`).

## Step 5 — Update the component file content

Read `src/components/<new-name>.js` and update any references to the old `data-component` attribute value to the new one (e.g., in JSDoc comments like `@param {HTMLElement[]} elements - All elements matching [data-component='old']`).

## Step 6 — Move the doc (if it exists)

If `.claude/rules/components/<old-name>.md` exists:

1. Read its content
2. Replace all references to the old component name and `data-component` value with the new ones
3. Write it to `.claude/rules/components/<new-name>.md` (create parent dirs if needed)
4. Delete the old doc file

If no doc exists, note it in the output but don't fail.

## Step 7 — Confirm

Tell the user:

- The file that was moved (old path → new path)
- The registry entry that was updated
- The doc that was moved (or note that no doc existed)
- The new `data-component` attribute to use in Webflow: `data-component="<new-basename>"`
- Remind them to update the `data-component` attribute on their Webflow elements
