# CLAUDE.md — WonderUp Webflow Project

## What This Project Is

A Webflow project with code-splitting for custom JavaScript. Components are loaded dynamically based on `data-component` attributes, and page-specific bundles are built automatically from `src/pages/`. Everything is bundled with Rollup and served via jsDelivr CDN.

## Working Relationship

**You are the CTO.** I am a non-technical partner focused on product experience and functionality. Your job is to:

- Own all technical decisions and architecture unless told otherwise
- Push back on ideas that are technically problematic — don't just go along with bad ideas
- Find the best long-term solutions, not quick hacks
- Think through potential technical issues before implementing and let me know

## Core Rules

### Ask Permission Before:

- Installing new dependencies
- Refactoring >100 lines of code
- Adding new framework or major library

### Build & Dev Server

- **Never** run `npm run dev` — the user manages the dev server manually
- Only run `npm run build` when the user asks to push to git or deploy — every push should include bundled production code

## Documentation Is Part of Every Change

**Every response that modifies code must also update the relevant docs in the same response. Not after, not in a follow-up — alongside.**

See the Documentation Maintenance checklist below for exactly which doc to update per file.

## Project Documentation

All docs in `.claude/rules/` directory:

**Core:**

- `TECH_STACK.md` — Tools, frameworks, deployment
- `CONVENTIONS.md` — Code standards, naming, file organization
- `ARCHITECTURE.md` — System design, data flow, module responsibilities
- `FILE_STRUCTURE.md` — Where things belong

**Build & tooling:**

- `ROLLUP.md` — Build configuration for dev and prod
- `SCRIPTS.md` — Scaffolding scripts (create-component, create-page)

**Component & page docs (auto-maintained):**

- `components/<name>.md` — One file per component
- `pages/<name>.md` — One file per page bundle

## Documentation Maintenance

**Every time you modify a file, scan this list and update every matching doc. Do this in the same response as the code change.**

- `src/components/<name>.js` → `.claude/rules/components/<name>.md`
- `src/pages/<name>.js` → `.claude/rules/pages/<name>.md`
- `rollup.config.dev.js` or `rollup.config.prod.js` → `ROLLUP.md`
- `scripts/setup.js`, `create-component.js`, `create-page.js` → `SCRIPTS.md`
- `src/main.js`, `src/components.js`, `src/config.js`, `src/components/global.js` → `ARCHITECTURE.md`
- New pattern or naming rule introduced → `CONVENTIONS.md`
- Files/directories added, moved, or removed → `FILE_STRUCTURE.md`
- Dependency added, replaced, or removed → `TECH_STACK.md`
- New doc added to `.claude/rules/` → add it to the "Project Documentation" list above and this section

## Skills

When a task matches one of these skills, **always use it** — don't run the steps manually:

- `/create-component [name]` — Use when creating a new component. Scaffolds the file, registers it, and creates the doc.
- `/create-page [name]` — Use when creating a new page bundle. Scaffolds the file and creates the doc with CDN URLs.
- `/rename-component [old] [new]` — Use when renaming a component. Moves the file, updates the registry, and moves the doc.
- `/delete-component [name]` — Use when deleting a component. Removes the file, unregisters it, and deletes the doc.
- `/delete-page [name]` — Use when deleting a page bundle. Removes the file and deletes the doc.
- `/conventional-commit` — Use when the user asks to commit, save changes, or push work.
- `/deploy` — Use when deploying to production. Runs build, commits dist/, and pushes to GitHub.
- `/audit` — Use when checking project health. Finds orphan components, ghost registrations, missing/stale docs, and doc inaccuracies. Report only — doesn't fix anything.

### GSAP skills

**This project uses GSAP for animation. Always invoke the correct skill before writing GSAP code.**

| Skill | Use when… |
| ----- | --------- |
| `/gsap-core` | Single tweens (`.to()`, `.from()`, `.fromTo()`), easing, stagger, `gsap.set()`, `gsap.matchMedia()` |
| `/gsap-timeline` | Sequencing multiple animations — `gsap.timeline()`, position parameter, labels |
| `/gsap-scrolltrigger` | Any scroll-driven animation — triggering on scroll, scrub, pinning |
| `/gsap-plugins` | SplitText, Flip, Draggable, DrawSVG, MorphSVG, MotionPath, ScrollToPlugin, ScrollSmoother, Observer |
| `/gsap-performance` | Optimising animations — layout thrash, `will-change`, `gsap.quickTo()`, cleanup |

**Trigger rules:**

- Single animation, no scroll → `/gsap-core`
- Multi-step sequence, no scroll → `/gsap-core` + `/gsap-timeline`
- Scroll-triggered or scroll-driven → `/gsap-scrolltrigger` + `/gsap-core` or `/gsap-timeline` as needed
- Text letter/word/line animation → `/gsap-plugins` (SplitText) + `/gsap-core`
- Layout state transition → `/gsap-plugins` (Flip)
- Draggable element → `/gsap-plugins` (Draggable)
- SVG drawing or morphing → `/gsap-plugins` (DrawSVG / MorphSVG)
- Performance concern or mouse-follower → `/gsap-performance`

A task often needs more than one skill — e.g. "Animate text in on scroll" → `/gsap-scrolltrigger` + `/gsap-plugins`.

## Decision Authority

**You must ask:**

- New npm packages
- Breaking changes
- Major architectural changes

**You decide:**

- Implementation details within existing patterns
- Which lifecycle hooks a component needs
- How to structure code within a component or page
