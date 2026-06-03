---
name: delete-component
description: Delete a component — file, registry entry, and doc
argument-hint: '[name]'
---

# Delete Component: $ARGUMENTS

## Step 1 — Validate the component exists

1. Check that `src/components/<name>.js` exists. If not → stop and report that the component was not found.
2. Read `src/components.js` to confirm it has a registration entry for this component.

Where `<name>` is `$ARGUMENTS` (e.g., `calculator` or `forms/contact`).

## Step 2 — Delete the component file

Run:

```
rm src/components/<name>.js
```

If the parent directory is now empty (for nested components like `forms/contact`), remove the empty directory too.

## Step 3 — Remove the registry entry

Read `src/components.js` and remove the entire object entry for this component — the `{ selector, importFn }` block including the trailing comma.

Make sure the resulting array is still valid JavaScript. If the array is now empty, it should be:

```js
export default []
```

## Step 4 — Delete the doc (if it exists)

If `.claude/rules/components/<name>.md` exists, delete it.

If the parent directory is now empty, remove it too.

If no doc exists, note it in the output but don't fail.

## Step 5 — Confirm

Tell the user:

- The component file that was deleted
- That the registry entry was removed
- The doc that was deleted (or note that no doc existed)
- Remind them to remove the `data-component="<basename>"` attribute from their Webflow elements
