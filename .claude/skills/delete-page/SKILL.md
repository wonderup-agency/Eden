---
name: delete-page
description: Delete a page bundle and its doc
argument-hint: '[name]'
---

# Delete Page: $ARGUMENTS

## Step 1 — Validate the page exists

Check that `src/pages/<name>.js` exists. If not → stop and report that the page was not found.

Where `<name>` is `$ARGUMENTS` (e.g., `pricing` or `blog/post`).

## Step 2 — Delete the page file

Run:

```
rm src/pages/<name>.js
```

If the parent directory is now empty (for nested pages like `blog/post`), remove the empty directory too.

## Step 3 — Delete the doc (if it exists)

If `.claude/rules/pages/<name>.md` exists, delete it.

If the parent directory is now empty, remove it too.

If no doc exists, note it in the output but don't fail.

## Step 4 — Confirm

Tell the user:

- The page file that was deleted
- The doc that was deleted (or note that no doc existed)
- Remind them to remove the `<script>` tag for this page from their Webflow site
