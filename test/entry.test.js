/**
 * Pins the entry module's export shape.
 *
 * A Cordis entry that exports anything beyond `name` / `Config` / `apply`
 * changes how the loader wraps the activation, and every TUI seam registration
 * is then refused with `requires a live Cordis activation context` — the plugin
 * looks half-alive (docs/DSH-PLUGIN-SOP.md §2.1 rule 1). This test is the
 * guard: it fails the moment a helper is re-exported from the entry.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

test('entry exports exactly name, Config and apply', async () => {
  const ns = await import('../lib/index.js')
  assert.deepEqual(Object.keys(ns).sort(), ['Config', 'apply', 'name'])
})

test('entry carries the manifest name', async () => {
  const ns = await import('../lib/index.js')
  assert.equal(ns.name, 'dsh-mama-cheer')
  assert.equal(typeof ns.apply, 'function')
  assert.notEqual(ns.Config, undefined)
})

test('implementation helpers stay out of the entry namespace', async () => {
  const ns = await import('../lib/index.js')
  for (const leaked of ['decidePlacement', 'pickAgent', 'firstService', 'cheer', 'registerShortcut', 'sourceFor']) {
    assert.equal(leaked in ns, false, `${leaked} must not be exported by the entry module`)
  }
})
