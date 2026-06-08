import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { dirname, basename, join } from 'node:path'
import pc from 'picocolors'

const rawArg = process.argv[2]

if (!rawArg) {
  console.log()
  console.log(pc.red('Missing component name.'))
  console.log()
  console.log(`Usage: ${pc.cyan('npm run create-component -- <path/name>')}`)
  console.log()
  console.log('Examples:')
  console.log(`  ${pc.dim('$')} npm run create-component -- calculator`)
  console.log(`  ${pc.dim('$')} npm run create-component -- forms/calculator`)
  console.log()
  process.exit(1)
}

const arg = rawArg.replace(/\s+/g, '-').toLowerCase()
const name = basename(arg)
const componentPath = join('src', 'components', `${arg}.js`)
const importPath = `./components/${arg}.js`
const registryPath = join('src', 'components.js')

// Check if file already exists
if (existsSync(componentPath)) {
  console.log()
  console.log(
    pc.red(`Component file already exists: ${pc.bold(componentPath)}`)
  )
  console.log()
  process.exit(1)
}

// Check if name is already registered
const registryContent = readFileSync(registryPath, 'utf-8')
if (registryContent.includes(`data-component='${name}'`)) {
  console.log()
  console.log(
    pc.red(
      `Component ${pc.bold(`"${name}"`)} is already registered in ${registryPath}`
    )
  )
  if (arg !== name) {
    console.log(
      pc.red(`  Note: nested components use the basename as the selector.`)
    )
    console.log(
      pc.red(
        `  Another component with the name ${pc.bold(`"${name}"`)} already exists.`
      )
    )
    console.log(
      pc.red(`  Use a unique basename (e.g. "${dirname(arg)}/${name}-alt").`)
    )
  }
  console.log()
  process.exit(1)
}

// Create component file
const template = `/*
Component: ${name}
Webflow attribute: data-component="${name}"
*/

/**
 * @param {HTMLElement[]} elements - All elements matching [data-component='${name}']
 */
export default function (elements) {
  // Init: runs when the component loads
  elements.forEach((element) => {
    console.log(element)
  })

  // Return lifecycle hooks (optional)
  return {
    // Runs on window resize (debounced 150ms)
    resize() {},

    // Runs when crossing a Webflow breakpoint (1920/1440/1280/992/768/480)
    // breakpoint(current, previous) {},
  }
}
`

mkdirSync(dirname(componentPath), { recursive: true })
writeFileSync(componentPath, template)

// Register in components.js
const entry = `  {\n    selector: "[data-component='${name}']",\n    importFn: () => import('${importPath}'),\n  },`
const updated = registryContent.replace(
  /^export default \[/m,
  `export default [\n${entry}`
)
writeFileSync(registryPath, updated)

console.log()
console.log(pc.green(`${pc.bold('✓')} Created ${pc.bold(componentPath)}`))
console.log(pc.green(`${pc.bold('✓')} Registered in ${pc.bold(registryPath)}`))
console.log()
console.log(`Add to your Webflow element:`)
console.log()
console.log(`  ${pc.cyan(`data-component="${name}"`)}`)
console.log()
