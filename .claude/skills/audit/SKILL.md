---
name: audit
description: Audit components and pages for orphans, missing docs, stale docs, and doc accuracy
---

# Audit Components & Pages

Run all checks below in order. Collect every issue found, then print a single compact report. **Do not fix anything during checks** — report first.

## Ignored files

Skip these files entirely:

- `src/components/example.js` (scaffold example, not a real component)

---

## Check 1 — Registry & File Sync (Components)

1. Read `src/components.js` and extract all registered component paths from `importFn` fields.
2. Glob all `.js` files in `src/components/` (recursive), excluding `global.js`.
3. Flag:
   - **Ghost registration**: entry in `components.js` with no matching file
   - **Orphan file**: file in `src/components/` not registered in `components.js`

## Check 2 — Page Files

Glob all `.js` files in `src/pages/` (recursive). Keep this list for checks below.

## Check 3 — Missing Docs

1. For each registered component, check for `.claude/rules/components/<name>.md`. Flag if missing.
2. For each page file, check for `.claude/rules/pages/<name>.md`. Flag if missing.

## Check 4 — Stale Docs

1. Glob `.md` files in `.claude/rules/components/`. Flag any whose component file no longer exists.
2. Glob `.md` files in `.claude/rules/pages/`. Flag any whose page file no longer exists.

## Check 5 — Doc Accuracy (Components)

For each component with both a file and a doc:

1. Read the component file: note the `data-component` selector, whether it returns `resize()` or `breakpoint()`, and any imports.
2. Read the doc: flag mismatches in selector, hook status, or listed dependencies.

## Check 6 — Doc Accuracy (Pages)

For each page with both a file and a doc:

1. Read the page file: note any imports.
2. Read the doc: flag mismatches in listed dependencies.

---

## Report

If zero issues found:

> ✅ Everything looks good — X components, Y pages, all in sync.

Otherwise, print:

### Issues

| Check | Item | Issue |
|-------|------|-------|
| Registry | `name` | Ghost registration / Orphan file |
| Docs | `name` | Missing doc |
| Docs | `name.md` | Stale doc (no matching file) |
| Accuracy | `name.md` | Specific inaccuracy |

**N issues found.**

---

### Fixes

Group fixes into two tiers:

**Safe (will auto-apply):**
- Create missing doc for `src/components/name.js`
- Update `name.md` — fix: description of specific inaccuracy

**Needs confirmation (destructive):**
- Delete orphan file `src/components/old.js` — not registered
- Remove ghost registration `old` from `components.js` — file missing
- Delete stale doc `.claude/rules/components/removed.md` — component gone

---

## After the report

1. **Auto-apply** all safe fixes immediately (creating missing docs, fixing doc inaccuracies) using the correct skill or by editing directly. After applying, note what was done with a short ✅ line per fix.

2. If there are destructive fixes pending, ask the user using AskUserQuestion with a single question:
   - Question: "These fixes delete files or modify the registry — want me to apply them?"
   - Options:
     - "Fix all" — apply every remaining fix
     - "Skip for now" — leave them as-is
     - (Other — lets the user give specific feedback)

3. If no destructive fixes remain after safe fixes are done, end with a short open question: "Anything else you'd like me to check or clean up?"
