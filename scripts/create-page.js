import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, basename, join } from 'node:path'
import pc from 'picocolors'

const rawArg = process.argv[2]

if (!rawArg) {
  console.log()
  console.log(pc.red('Missing page name.'))
  console.log()
  console.log(`Usage: ${pc.cyan('npm run create-page -- <path/name>')}`)
  console.log()
  console.log('Examples:')
  console.log(`  ${pc.dim('$')} npm run create-page -- contact`)
  console.log(`  ${pc.dim('$')} npm run create-page -- marketing/landing`)
  console.log()
  process.exit(1)
}

const arg = rawArg.replace(/\s+/g, '-').toLowerCase()
const name = basename(arg)
const pagePath = join('src', 'pages', `${arg}.js`)

// Check if file already exists
if (existsSync(pagePath)) {
  console.log()
  console.log(pc.red(`Page file already exists: ${pc.bold(pagePath)}`))
  console.log()
  process.exit(1)
}

// Build CDN URL
let repoPath = null
try {
  const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))
  const url = pkg.repository?.url || ''
  const match = url.match(/github\.com\/([^/]+\/[^/.]+)/)
  repoPath = match ? match[1] : null
} catch {
  // Best effort: without package.json the CDN URL falls back to placeholders
}

const cdnBase = repoPath
  ? `https://cdn.jsdelivr.net/gh/${repoPath}`
  : `https://cdn.jsdelivr.net/gh/<owner>/<repo>`

// Production is pinned to an immutable commit SHA. Read the live one out of the
// site-wide snippet so a page bundle can't end up on a different build than the
// main one — `/deploy` re-pins both. Falls back to @main if it can't be read.
let cdnRef = 'main'
try {
  const snippet = readFileSync('webflow-snippet.html', 'utf-8')
  const pinned = snippet.match(
    /cdn\.jsdelivr\.net\/gh\/[\w.-]+\/[\w.-]+@([\w.-]+)/
  )
  if (pinned) cdnRef = pinned[1]
} catch {
  // Best effort: without the snippet the page bundle tracks @main
}

const cdnDist = `${cdnBase}@${cdnRef}/dist`

// Create page file
const template = `/*
Page bundle: ${name}
Add to Webflow → Page Settings → Custom Code → Before </head>:

<link rel="preload" as="script" href="${cdnDist}/${arg}.js" crossorigin>
<script>
  (function () {
    var base = window.__devBase || (localStorage.dev ? (localStorage.devUrl || 'http://127.0.0.1:8080') : '${cdnDist}')
    var s = document.createElement('script')
    s.src = base + '/${arg}.js'
    s.type = 'module'
    s.defer = true
    document.head.appendChild(s)
  })()
</script>
*/

console.log('%c📄 [${name}] Page loaded', 'color: #a78bfa; font-weight: bold')
`

mkdirSync(dirname(pagePath), { recursive: true })
writeFileSync(pagePath, template)

console.log()
console.log(pc.green(`${pc.bold('✓')} Created ${pc.bold(pagePath)}`))
console.log()
console.log(`Add to Webflow → Page Settings → Custom Code → Before </head>:`)
console.log()
console.log(
  pc.cyan(
    `  <link rel="preload" as="script" href="${cdnDist}/${arg}.js" crossorigin>`
  )
)
console.log(pc.cyan(`  <script>`))
console.log(pc.cyan(`    (function () {`))
console.log(
  pc.cyan(
    `      var base = window.__devBase || (localStorage.dev ? (localStorage.devUrl || 'http://127.0.0.1:8080') : '${cdnDist}')`
  )
)
console.log(pc.cyan(`      var s = document.createElement('script')`))
console.log(pc.cyan(`      s.src = base + '/${arg}.js'`))
console.log(pc.cyan(`      s.type = 'module'`))
console.log(pc.cyan(`      s.defer = true`))
console.log(pc.cyan(`      document.head.appendChild(s)`))
console.log(pc.cyan(`    })()`))
console.log(pc.cyan(`  </script>`))
console.log()
