/**
 * Placement, targeting and delivery behaviour, driven by fake agents.
 *
 * The matrix under test is the whole point of the plugin: which of the three
 * delivery shapes a keypress produces, and that the interrupt path cancels
 * with `keepInbox: true` (dropping the user's own queued messages would be a
 * data loss the user never asked for).
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEBOUNCE_MS,
  clampToast,
  cheer,
  decidePlacement,
  normalizeDisplay,
  normalizeMode,
  pickAgent,
  sourceFor,
} from '../lib/plugin.js'

const silentLog = { line() {}, once() {} }

function fakeState(overrides = {}) {
  return { recent: new Map(), tools: new Map(), lastCheerAt: 0, settling: false, ...overrides }
}

function fakeConfig(overrides = {}) {
  return { text: '妈妈加油！', display: 'none', interruptMode: 'smart', keepInbox: true, toastMs: 3000, ...overrides }
}

function fakeAgent({ id = 'session-1', status = 'idle' } = {}) {
  const calls = []
  return {
    id,
    status,
    calls,
    steer: (message) => calls.push(['steer', message]),
    followup: (message) => calls.push(['followup', message]),
    cancel: (cause, options) => calls.push(['cancel', cause, options]),
  }
}

function ctxWith(agent, toast) {
  const services = new Map()
  if (agent !== undefined) services.set('agents', { list: () => [agent] })
  if (toast !== undefined) services.set('tuiToast', toast)
  return { get: (name) => services.get(name) }
}

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0))

test('decidePlacement: idle always starts a turn', () => {
  for (const mode of ['smart', 'always', 'never']) {
    assert.equal(decidePlacement({ mode, running: false, toolBusy: false }), 'followup')
    assert.equal(decidePlacement({ mode, running: false, toolBusy: true }), 'followup')
  }
})

test('decidePlacement: smart never interrupts a tool in flight', () => {
  assert.equal(decidePlacement({ mode: 'smart', running: true, toolBusy: true }), 'steer')
  assert.equal(decidePlacement({ mode: 'smart', running: true, toolBusy: false }), 'interrupt')
})

test('decidePlacement: always and never overrule the tool heuristic', () => {
  assert.equal(decidePlacement({ mode: 'always', running: true, toolBusy: true }), 'interrupt')
  assert.equal(decidePlacement({ mode: 'never', running: true, toolBusy: false }), 'steer')
})

test('normalize helpers fall back instead of trusting raw config', () => {
  assert.equal(normalizeMode('nonsense'), 'smart')
  assert.equal(normalizeMode('always'), 'always')
  assert.equal(normalizeDisplay('nonsense'), 'toast')
  assert.equal(normalizeDisplay('bubble'), 'bubble')
  assert.equal(clampToast(10), 500)
  assert.equal(clampToast(999999), 12000)
  assert.equal(clampToast(Number.NaN), 3000)
})

test('sourceFor keeps the silent modes off the transcript', () => {
  assert.deepEqual(sourceFor('none'), { kind: 'plugin', plugin: 'mama-cheer' })
  assert.deepEqual(sourceFor('toast'), { kind: 'plugin', plugin: 'mama-cheer' })
  assert.deepEqual(sourceFor('bubble'), { kind: 'user' })
})

test('pickAgent prefers a running agent, then the most recent session', () => {
  const idle = { id: 'a', status: 'idle' }
  const running = { id: 'b', status: 'running' }
  assert.equal(pickAgent({ list: () => [idle, running] }, new Map()), running)
  assert.equal(pickAgent({ list: () => [idle] }, new Map()), idle)
  assert.equal(pickAgent({ list: () => [] }, new Map()), undefined)
  assert.equal(pickAgent(undefined, new Map()), undefined)
  const first = { id: 'x', status: 'idle' }
  const second = { id: 'y', status: 'idle' }
  const recent = new Map([
    ['x', 1],
    ['y', 2],
  ])
  assert.equal(pickAgent({ list: () => [first, second] }, recent), second)
})

test('idle press delivers a followup carrying the configured text', () => {
  const agent = fakeAgent({ status: 'idle' })
  cheer(ctxWith(agent), fakeConfig(), fakeState(), silentLog)
  assert.equal(agent.calls.length, 1)
  const [kind, message] = agent.calls[0]
  assert.equal(kind, 'followup')
  assert.equal(message.content[0].text, '妈妈加油！')
  assert.deepEqual(message.source, { kind: 'plugin', plugin: 'mama-cheer' })
})

test('running press with a tool in flight steers instead of interrupting', () => {
  const agent = fakeAgent({ status: 'running' })
  const state = fakeState({ tools: new Map([['session-1', 1]]) })
  cheer(ctxWith(agent), fakeConfig(), state, silentLog)
  assert.deepEqual(agent.calls.map((call) => call[0]), ['steer'])
})

test('running press without a tool cancels with keepInbox then delivers', async () => {
  const agent = fakeAgent({ status: 'running' })
  const state = fakeState()
  cheer(ctxWith(agent), fakeConfig(), state, silentLog)
  assert.equal(agent.calls[0][0], 'cancel')
  assert.deepEqual(agent.calls[0][1], { kind: 'user' })
  assert.deepEqual(agent.calls[0][2], { keepInbox: true })
  await flushMicrotasks()
  assert.deepEqual(agent.calls.map((call) => call[0]), ['cancel', 'followup'])
  assert.equal(agent.calls[1][1].content[0].text, '妈妈加油！')
})

test('keepInbox: false drops the option instead of sending undefined', () => {
  const agent = fakeAgent({ status: 'running' })
  cheer(ctxWith(agent), fakeConfig({ keepInbox: false }), fakeState(), silentLog)
  assert.equal(agent.calls[0][0], 'cancel')
  assert.equal(agent.calls[0][2], undefined)
})

test('a second press inside the debounce window is ignored', () => {
  const agent = fakeAgent({ status: 'idle' })
  const state = fakeState()
  const ctx = ctxWith(agent)
  assert.ok(DEBOUNCE_MS > 0)
  cheer(ctx, fakeConfig(), state, silentLog)
  cheer(ctx, fakeConfig(), state, silentLog)
  assert.equal(agent.calls.length, 1)
})

test('presses during an interrupt settle are ignored', () => {
  const agent = fakeAgent({ status: 'idle' })
  const state = fakeState({ settling: true })
  cheer(ctxWith(agent), fakeConfig(), state, silentLog)
  assert.equal(agent.calls.length, 0)
})

test('missing agent never throws and reports through the toast seam', () => {
  const delivered = []
  const toast = {
    show: (text, options) => {
      delivered.push([text, options])
      return true
    },
  }
  cheer(ctxWith(undefined, toast), fakeConfig({ display: 'toast' }), fakeState({ lastCheerAt: 0 }), silentLog)
  assert.equal(delivered.length, 1)
  assert.match(delivered[0][0], /没找到活动会话/)
  assert.equal(delivered[0][1].color, 'warning')
})

test('toast mode announces a successful delivery; silent modes stay silent', () => {
  const delivered = []
  const toast = { show: (text, options) => delivered.push([text, options]) }
  cheer(ctxWith(fakeAgent(), toast), fakeConfig({ display: 'toast' }), fakeState(), silentLog)
  assert.equal(delivered.length, 1)
  assert.equal(delivered[0][0], '妈妈加油！')
  assert.equal(delivered[0][1].color, 'success')
  assert.equal(delivered[0][1].timeoutMs, 3000)

  const before = delivered.length
  cheer(ctxWith(fakeAgent(), toast), fakeConfig({ display: 'none' }), fakeState(), silentLog)
  assert.equal(delivered.length, before)
})

test('a throwing agent is contained and reported', () => {
  const agent = fakeAgent({ status: 'idle' })
  agent.followup = () => {
    throw new Error('inbox closed')
  }
  const delivered = []
  const toast = { show: (text) => delivered.push(text) }
  assert.doesNotThrow(() => cheer(ctxWith(agent, toast), fakeConfig({ display: 'toast' }), fakeState(), silentLog))
  assert.equal(delivered.length, 1)
  assert.match(delivered[0], /inbox closed/)
})
