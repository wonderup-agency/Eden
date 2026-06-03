# File Structure

```
├── src/
│   ├── main.js                    Entry point — loads global.js then components
│   ├── components.js              Component registry (auto-managed by create-component)
│   ├── config.js                  Shared project config (API keys, endpoints, flags)
│   ├── components/
│   │   └── global.js              Runs on every page before components load
│   └── pages/
│       └── .gitkeep               Per-page standalone bundles go here
│
├── dist/                          Build output (committed to git, cleaned by prod build)
│   ├── main.js                    Bundled entry point
│   ├── styles.css                 Extracted CSS
│   └── *.js                       Page bundles and code-split chunks
│
├── .github/
│   └── workflows/
│       ├── setup.yml              Auto-patches repo name on first push (self-deletes after)
│       └── purge-cdn.yml          Purges jsDelivr CDN cache after every push to main that touches dist/
│
├── scripts/
│   ├── setup.js                   One-time project initialisation (repo name, CDN URLs)
│   ├── create-component.js        Scaffolds component + registers in components.js
│   └── create-page.js             Scaffolds page bundle in src/pages/
│
├── .claude/
│   ├── CLAUDE.md                  Project instructions for Claude
│   ├── skills/                    Claude skill definitions
│   └── rules/
│       ├── ARCHITECTURE.md        System design and data flow
│       ├── CONVENTIONS.md         Code standards and patterns
│       ├── FILE_STRUCTURE.md      This file
│       ├── ROLLUP.md              Build configuration
│       ├── SCRIPTS.md             Scaffolding scripts (create-component, create-page)
│       ├── TECH_STACK.md          Tools and frameworks
│       ├── components/            Component documentation (one .md per component)
│       └── pages/                 Page bundle documentation (one .md per page)
│
├── rollup.config.dev.js           Dev build config (sourcemaps, no minification)
├── rollup.config.prod.js          Prod build config (minified, no console)
├── eslint.config.js               ESLint flat config
├── .prettierignore                Excludes dist/ from Prettier formatting
├── package.json                   Dependencies, scripts, project metadata
├── webflow-snippet.html           Copy-paste snippet for Webflow head section
├── CLAUDE.md                      Project instructions for Claude
├── CHANGELOG.md                   Release notes
└── README.md                      Project documentation
```

## Where things go

| What                   | Where                                                         |
| ---------------------- | ------------------------------------------------------------- |
| New component          | `src/components/<name>.js` (use `npm run create-component`)   |
| Component subdirectory | `src/components/<group>/<name>.js` (e.g., `forms/contact.js`) |
| Component registration | `src/components.js` (auto-managed by create-component)        |
| Global site-wide code  | `src/components/global.js`                                    |
| Page-specific bundle   | `src/pages/<name>.js` (use `npm run create-page`)             |
| Nested page bundle     | `src/pages/<section>/<name>.js` (e.g., `blog/post.js`)        |
| Project config         | `src/config.js`                                               |
| CSS                    | Import in any JS file — extracts to `dist/styles.css`         |
| Node scripts           | `scripts/`                                                    |
| Component docs         | `.claude/rules/components/<name>.md`                          |
| Page docs              | `.claude/rules/pages/<name>.md`                               |
| Architecture docs      | `.claude/rules/`                                              |
