#!/usr/bin/env node
/**
 * Manifest sanity check for dsh-mama-cheer.
 *
 * Mirrors the admission-driven checks a host would run (TUI-PKG-001 /
 * TUI-PKG-002) without depending on @dsh-std/manifest. This plugin asks the
 * host for nothing — no contracts, no permissions, no command contributions —
 * so the interesting assertions are the negative ones: the manifest must NOT
 * grow a capability it never uses, and its `facets.host.entry` must exist on
 * disk.
 *
 * The TUI seams this plugin consumes (`tuiShortcuts`, `tuiSettingsSections`,
 * `tuiToast`) and the core `agents` / `settings` services are plain Cordis
 * services, not mediated contracts, so an empty `requires.contracts` is the
 * correct declaration rather than an oversight.
 *
 * Exit 1 with a reason on failure; never writes anything.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const failures = []
const fail = (message) => failures.push(message)

let manifest
try {
  manifest = JSON.parse(readFileSync(join(root, 'dsh-plugin.json'), 'utf8'))
} catch (error) {
  console.error(`❌ dsh-plugin.json is not valid JSON: ${error.message}`)
  process.exit(1)
}

// A. Identity
if (manifest.$schema !== 'https://dsh.community/schemas/dsh-plugin-0.15.json') {
  fail('$schema must be the absolute dsh-plugin-0.15.json URI')
}
if (manifest.manifestVersion !== '0.15') fail('manifestVersion must be 0.15')
if (manifest.id !== 'com.dsh-tui-ecosystem.dsh-mama-cheer') fail('id must be com.dsh-tui-ecosystem.dsh-mama-cheer')
if (!/^\d+\.\d+\.\d+/.test(manifest.version ?? '')) fail('version must be semver')

// The manifest version and the package version are published together.
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
if (manifest.version !== pkg.version) fail(`manifest version ${manifest.version} != package version ${pkg.version}`)
if (manifest.name !== pkg.name) fail(`manifest name ${manifest.name} != package name ${pkg.name}`)

// B. Facet
const host = manifest.facets?.host
if (!host || typeof host.entry !== 'string' || host.apiVersion !== 'v1alpha1') {
  fail('facets.host must declare entry + apiVersion "v1alpha1"')
} else if (!existsSync(join(root, host.entry))) {
  fail(`facets.host.entry does not exist: ${host.entry}`)
}
if (manifest.facets?.client || manifest.facets?.worker) fail('client/worker facets are not allowed in v0.15')

// C. Nothing is requested
if ((manifest.requires?.contracts ?? []).length !== 0) fail('requires.contracts must stay empty: this plugin uses no mediated capability')
if (manifest.requires?.services) fail('requires.services must not be declared (v0.15)')
if (manifest.provides) fail('provides must not be declared (v0.15)')
if ((manifest.permissions ?? []).length !== 0) fail('permissions must stay empty: the plugin invokes nothing on the host')
if ((manifest.contributions ?? manifest.contributes?.commands ?? []).length !== 0) {
  fail('contributes.commands must stay empty: the plugin adds no command')
}

// D. Packaging identity
if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') fail('package.json must declare dsh.bundle.patch')
if (manifest.license !== 'MIT' || pkg.license !== 'MIT') fail('license must be MIT')
if (pkg.private === true) fail('package.json must not be private when publishing to npm')

if (failures.length > 0) {
  for (const failure of failures) console.error(`❌ ${failure}`)
  process.exit(1)
}
console.log('✅ dsh-plugin.json looks valid (id=%s, version=%s)', manifest.id, manifest.version)
