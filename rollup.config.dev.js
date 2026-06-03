import { readdirSync, accessSync } from 'node:fs'
import { defineConfig } from 'rollup'
import del from 'rollup-plugin-delete'
import resolve from '@rollup/plugin-node-resolve'
import postcss from 'rollup-plugin-postcss'
import postcssPresetEnv from 'postcss-preset-env'
import commonjs from '@rollup/plugin-commonjs'

function getPageEntries() {
  try {
    return Object.fromEntries(
      readdirSync('src/pages', { recursive: true })
        .filter((f) => f.endsWith('.js'))
        .map((f) => {
          const normalized = f.replace(/\\/g, '/')
          return [normalized.replace(/\.js$/, ''), `src/pages/${normalized}`]
        })
    )
  } catch {
    return {}
  }
}

function checkGlobalJs() {
  return {
    name: 'check-global-js',
    buildStart() {
      try {
        accessSync('src/components/global.js')
      } catch {
        this.warn(
          'src/components/global.js not found. Global initialization will be skipped at runtime.'
        )
      }
    },
  }
}

export default defineConfig({
  input: {
    main: 'src/main.js',
    ...getPageEntries(),
  },
  output: {
    dir: 'dist',
    format: 'es',
    entryFileNames: '[name].js',
    chunkFileNames: '[name]-[hash].js',
    sourcemap: true,
  },
  plugins: [
    del({ targets: 'dist/*', runOnce: true }),
    checkGlobalJs(),
    resolve(),
    commonjs(),
    postcss({
      plugins: [postcssPresetEnv({ stage: 2 })],
      extract: 'styles.css',
      minimize: true,
      sourceMap: true,
    }),
  ],
})
