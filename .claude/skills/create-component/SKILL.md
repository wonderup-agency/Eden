---
name: create-component
description: Scaffold a new component and create its documentation
argument-hint: '[name]'
---

# Create Component: $ARGUMENTS

## Step 0 — Gather purpose

Read the user's message and check if it already describes what the component does (e.g., "create a calculator that handles pricing tier selection").

- **If yes** — extract that as the purpose. Do not ask again.
- **If no** — ask: *"What does this component do?"* Wait for the answer before continuing.

Also note: if the description implies a specific library (e.g., GSAP for animations, a fetch-based API call), plan to add the relevant import to the scaffolded file after it's created.

## Step 1 — Scaffold the component

Run the create-component script:

```
npm run create-component -- $ARGUMENTS
```

If the script fails (component already exists, name collision, etc.), stop and report the error. Do not continue.

After the script runs, if the purpose implies library imports, edit the scaffolded file to add them at the top.

## Step 2 — Create the component doc

Create `.claude/rules/components/$ARGUMENTS.md`:

```markdown
# <component-name>

## Purpose

<Use the actual purpose from Step 0 — no placeholders>

## Webflow Setup

Add to any element in Webflow:

data-component="<component-name>"

## Behavior

- **Init**: <One sentence describing what happens on load, derived from the purpose>
- **Resize**: Not used
- **Breakpoint**: Not used

## Dependencies

<List any imports added in Step 1, or "None.">

## DOM Expectations

Elements matching `[data-component='<component-name>']`.
```

Use the actual component name (last segment of the path — e.g., `forms/contact` → `contact` for the data attribute, `forms/contact` for the doc path).

## Step 3 — Open in editor

```
code src/components/$ARGUMENTS.js
```

## Step 4 — Confirm

Tell the user:

- The file and doc that were created
- The exact `data-component` attribute to paste in Webflow
