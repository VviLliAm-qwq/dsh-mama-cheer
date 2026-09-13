/**
 * Settings-screen wiring: the section descriptor, the namespace the plugin
 * registers, and the rebinding that a combo change triggers.
 *
 * The cross-check "every editable field exists in Config" is the one that
 * matters: a field path is the settings service's mutate vocabulary, so a typo
 * there produces a screen that silently edits nothing.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { Config, DISPLAY_MODES, INTERRUPT_MODES, apply, createShortcutBinder } from '../lib/plugin.js'
import { DISPLAY_OPTIONS, INTERRUPT_OPTIONS, SETTINGS_NS, buildSection } from '../lib/settings.js'

const silentLog = { line() {}, once() {} }

function fakeState() {
  return { recent: new Map(), tools: new Map(), lastCheerAt: 0, settling: false }
}

function shortcutService() {
  const registrations = []
  return {
    registrations,
    register(combo) {
      if (combo === 'bad-combo') return undefined
      const entry = { combo, disposed: false, handler: undefined }
      registrations.push(entry)
      return () => {
        entry.disposed = true
      }
    },
    captureHandler(combo) {
      const entry = registrations.find((item) => item.combo === combo)
      return entry?.handler
    },
  }
}

test('the section targets the namespace the plugin registers', () => {
  assert.equal(buildSection().ns, SETTINGS_NS)
  assert.match(SETTINGS_NS, /^[a-z][a-z0-9-]*$/, 'the settings service requires a lowercase hyphenated id')
})

test('every editable field exists in the Config schema', () => {
  const known = new Set(Object.keys(Config.dict ?? {}))
  assert.ok(known.size >= 6, 'Config introspection must expose the schema keys')
  const section = buildSection()
  assert.ok(section.fields.length > 0)
  for (const field of section.fields) {
    assert.ok(Array.isArray(field.path) && field.path.length === 1, `${field.label} needs a single-segment path`)
    assert.ok(known.has(field.path[0]), `${field.path[0]} is not a Config key`)
    assert.ok(['text', 'number', 'boolean', 'select'].includes(field.kind), `${field.label} has an unknown kind`)
    assert.equal(typeof field.label, 'string')
    assert.notEqual(field.label, '')
  }
})

test('select fields mirror the accepted mode lists', () => {
  const fields = new Map(buildSection().fields.map((field) => [field.path[0], field]))
  assert.deepEqual(
    fields.get('interruptMode').options.map((option) => option.value),
    [...INTERRUPT_MODES],
  )
  assert.deepEqual(
    fields.get('display').options.map((option) => option.value),
    [...DISPLAY_MODES],
  )
  assert.deepEqual(INTERRUPT_OPTIONS.map((option) => option.value), [...INTERRUPT_MODES])
  assert.deepEqual(DISPLAY_OPTIONS.map((option) => option.value), [...DISPLAY_MODES])
})

test('every field and option carries zh/en descriptions', () => {
  for (const field of buildSection().fields) {
    assert.ok(field.descriptions?.zh, `${field.label} needs a zh description`)
    assert.ok(field.descriptions?.en, `${field.label} needs an en description`)
    for (const option of field.options ?? []) {
      assert.ok(option.descriptions?.zh, `${field.label}/${option.value} needs zh`)
      assert.ok(option.descriptions?.en, `${field.label}/${option.value} needs en`)
    }
  }
})

test('binder binds once, ignores repeats and rebinds on change', () => {
  const service = shortcutService()
  const ctx = { get: (name) => (name === 'tuiShortcuts' ? service : undefined) }
  const binder = createShortcutBinder(ctx, fakeState(), silentLog, () => ({ combo: 'ctrl+alt+m' }))

  assert.equal(binder.ensure('ctrl+alt+m'), true)
  assert.equal(service.registrations.length, 1)

  assert.equal(binder.ensure('ctrl+alt+m'), true)
  assert.equal(service.registrations.length, 1, 'an unchanged combo must not rebind')

  assert.equal(binder.ensure('ctrl+alt+k'), true)
  assert.equal(service.registrations.length, 2)
  assert.equal(service.registrations[0].disposed, true, 'the stale binding must be disposed')
  assert.equal(binder.boundCombo(), 'ctrl+alt+k')
})

test('binder reports a refusal instead of pretending to bind', () => {
  const service = shortcutService()
  const ctx = { get: (name) => (name === 'tuiShortcuts' ? service : undefined) }
  const binder = createShortcutBinder(ctx, fakeState(), silentLog, () => ({ combo: 'x' }))
  assert.equal(binder.ensure('bad-combo'), false)
  assert.equal(binder.isBound(), false)
  assert.equal(binder.ensure(''), false)
  assert.equal(binder.ensure('   '), false)
  assert.equal(service.registrations.length, 0)
})

/** Minimal Cordis-shaped context for `apply`. */
function applyCtx(services) {
  const listeners = new Map()
  const effects = []
  return {
    get: (name) => services.get(name),
    on: (event, listener) => {
      listeners.set(event, listener)
      return () => {}
    },
    effect: (fn) => {
      effects.push(fn)
      return () => {}
    },
    logger: { warn() {}, info() {} },
    __listeners: listeners,
    __effects: effects,
  }
}

function applyHarness(overrides = {}) {
  const registered = { namespaces: [], sections: [], combos: [] }
  const watched = []
  const handlers = new Map()
  const live = {
    text: '妈妈加油！',
    combo: 'ctrl+alt+m',
    interruptMode: 'smart',
    display: 'toast',
    toastMs: 3000,
    keepInbox: true,
    ...overrides.live,
  }
  const scope = {
    get: () => ({ ...live }),
    watch: (fn) => {
      watched.push(fn)
      return () => {}
    },
  }
  const shortcuts = {
    register: (combo, options) => {
      registered.combos.push(combo)
      handlers.set(combo, options.handler)
      return () => {}
    },
  }
  const services = new Map([
    ['settings', { register: (ns, schema) => (registered.namespaces.push([ns, schema]), scope) }],
    ['tuiSettingsSections', { register: (section) => (registered.sections.push(section), () => {}) }],
    ['tuiShortcuts', shortcuts],
    ['agents', { list: () => overrides.agents ?? [] }],
  ])
  const ctx = applyCtx(services)
  apply(ctx, { retryMs: 100, retryLimit: 2, ...(overrides.config ?? {}) })
  return { ctx, registered, watched, handlers, live, scope }
}

test('apply registers the namespace, the section and the shortcut', () => {
  const harness = applyHarness()
  assert.deepEqual(
    harness.registered.namespaces.map(([ns]) => ns),
    [SETTINGS_NS],
  )
  assert.equal(harness.registered.sections.length, 1)
  assert.equal(harness.registered.sections[0].ns, SETTINGS_NS)
  assert.deepEqual(harness.registered.combos, ['ctrl+alt+m'])
  assert.equal(harness.watched.length, 1, 'the plugin must observe its own namespace')
})

test('a combo change in the settings screen rebinds immediately', () => {
  const harness = applyHarness()
  harness.watched[0]({ ...harness.live, combo: 'ctrl+alt+j' })
  assert.deepEqual(harness.registered.combos, ['ctrl+alt+m', 'ctrl+alt+j'])
})

test('a keypress delivers the live settings value, not the boot value', () => {
  const delivered = []
  const agent = {
    id: 'session-1',
    status: 'idle',
    steer: (message) => delivered.push(['steer', message]),
    followup: (message) => delivered.push(['followup', message]),
    cancel: () => delivered.push(['cancel']),
  }
  const harness = applyHarness({ agents: [agent], live: { text: '活配置文案', display: 'none' } })
  const handler = harness.handlers.get('ctrl+alt+m')
  assert.equal(typeof handler, 'function')
  handler()
  assert.equal(delivered.length, 1)
  assert.equal(delivered[0][0], 'followup')
  assert.equal(delivered[0][1].content[0].text, '活配置文案')
})

test('a settings screen edit of display is honoured on the next press', () => {
  const delivered = []
  const agent = {
    id: 'session-1',
    status: 'idle',
    steer: () => {},
    followup: (message) => delivered.push(message),
    cancel: () => {},
  }
  const harness = applyHarness({ agents: [agent], live: { display: 'bubble' } })
  harness.handlers.get('ctrl+alt+m')()
  assert.deepEqual(delivered[0].source, { kind: 'user' })
})
