import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import pc from 'picocolors'

// --- Detect repo from git remote ---

let remoteUrl
try {
  remoteUrl = execSync('git remote get-url origin', { stdio: ['pipe', 'pipe', 'pipe'] })
    .toString()
    .trim()
} catch {
  console.log()
  console.log(pc.red('Could not read git remote origin. Make sure this is a git repository with a remote named "origin".'))
  console.log()
  process.exit(1)
}

const match = remoteUrl.match(/github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/)
if (!match) {
  console.log()
  console.log(pc.red(`Could not extract GitHub owner/repo from remote URL:`))
  console.log(pc.dim(`  ${remoteUrl}`))
  console.log()
  process.exit(1)
}

const repoPath = match[1] // e.g. wonderup-agency/client-1
const repoName = repoPath.split('/')[1] // e.g. client-1

// --- Idempotency guard ---
//
// Detect the currently-configured repo path in webflow-snippet.html and
// compare it against the git remote. If they already match, nothing to do.
// This catches both the initial placeholder state (`your-repo`) and drift
// from a previous repo rename.

const snippet = readFileSync('webflow-snippet.html', 'utf-8')
const configuredMatch = snippet.match(/cdn\.jsdelivr\.net\/gh\/([\w.-]+\/[\w.-]+)@/)
const configuredPath = configuredMatch ? configuredMatch[1] : null

if (configuredPath === repoPath) {
  console.log()
  console.log(pc.green(`${pc.bold('✓')} Already configured for ${pc.bold(repoPath)} — nothing to do.`))
  console.log()
  process.exit(0)
}

if (!configuredPath) {
  console.log()
  console.log(pc.red('Could not detect the currently-configured repo path in webflow-snippet.html.'))
  console.log()
  process.exit(1)
}

// --- Apply replacements ---

writeFileSync(
  'webflow-snippet.html',
  snippet.replaceAll(configuredPath, repoPath)
)

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))
pkg.name = repoName
pkg.repository.url = `git+https://github.com/${repoPath}`
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n')

const readme = readFileSync('README.md', 'utf-8')
writeFileSync('README.md', readme.replaceAll(configuredPath, repoPath))

// --- Report ---

console.log()
console.log(pc.green(`${pc.bold('✓')} Project initialized for ${pc.bold(repoPath)}`))
console.log(pc.dim(`  (was: ${configuredPath})`))
console.log()
console.log(`  ${pc.cyan('package.json')}         name → ${pc.bold(repoName)}, repository URL updated`)
console.log(`  ${pc.cyan('webflow-snippet.html')}  CDN URLs updated`)
console.log(`  ${pc.cyan('README.md')}             CDN URL examples updated`)
console.log()
