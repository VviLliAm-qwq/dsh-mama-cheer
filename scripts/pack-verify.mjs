#!/usr/bin/env node
/**
 * Pack verification for dsh-mama-cheer.
 *
 * Simulates what npm would publish: every entry of package.json `files` must
 * exist, the artifact must carry the runtime entry, the manifest, the bundle
 * patch, both READMEs, the changelog and the license; source, tests and
 * scripts must NOT leak into the artifact.
 *
 * The last check is the one that matters most in this ecosystem: every
 * relative import reachable from `lib/index.js` must be covered by the shipped
 * file list. A plugin that gains a module after it was installed into a
 * profile keeps working locally and dies at boot for everyone else — the
 * hard-link failure documented in `docs/DSH-PLUGIN-SOP.md` §6.2. This plugin
 * ships four modules under `lib/`, so the sweep is not theoretical.
 *
 * Exit 1 on failure; read-only.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const failures = []
const fail = (message) => failures.push(message)

const files = pkg.files ?? []
for (const entry of files) {
  if (['lib', 'dsh-plugin.json', 'cordis.patch.yml', 'README.md', 'README.zh.md', 'CHANGELOG.md', 'LICENSE'].includes(entry)) {
    continue
  }
  if (!existsSync(join(root, entry))) fail(`files entry missing from disk: ${entry}`)
}

for (const required of [
  'lib/index.js',
  'dsh-plugin.json',
  'cordis.patch.yml',
  'README.md',
  'README.zh.md',
  'CHANGELOG.md',
  'LICENSE',
]) {
  if (!existsSync(join(root, required))) fail(`artifact must contain: ${required}`)
}

for (const leaked of ['src', 'test', 'scripts', 'tsconfig.json', 'node_modules', '.github']) {
  if (files.includes(leaked)) fail(`source/test/scripts must not be published (blocked: ${leaked})`)
}

if (pkg.main !== 'lib/index.js') fail('main must be lib/index.js')
if (pkg.type !== 'module') fail('package must be ESM (type: module)')

/** Every module under lib/, so the import sweep sees files, not guesses. */
function libModules(directory) {
  const out = []
  for (const name of readdirSync(directory)) {
    const absolute = join(directory, name)
    if (statSync(absolute).isDirectory()) out.push(...libModules(absolute))
    else if (absolute.endsWith('.js')) out.push(absolute)
  }
  return out
}

const shipped = new Set(
  (files.includes('lib') ? libModules(join(root, 'lib')) : [])
    .map((absolute) => relative(root, absolute).split('\\').join('/')),
)

for (const absolute of libModules(join(root, 'lib'))) {
  const rel = relative(root, absolute).split('\\').join('/')
  const source = readFileSync(absolute, 'utf8')
  for (const match of source.matchAll(/from\s+'(\.[^']+)'/g)) {
    const target = relative(root, resolve(dirname(absolute), match[1])).split('\\').join('/')
    if (!shipped.has(target)) fail(`${rel} imports ${target}, which the published file list does not carry`)
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`❌ ${failure}`)
  process.exit(1)
}
console.log(`✅ pack layout verifies (${shipped.size} lib modules + manifest + patch + docs only)`)
