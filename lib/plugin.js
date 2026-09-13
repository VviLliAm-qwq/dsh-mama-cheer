/**
 * dsh-mama-cheer — inject one encouraging message into the live conversation
 * from a keyboard shortcut.
 *
 * Why the delivery has three shapes instead of one (evidence, not taste — all
 * read from the shipped dsh 0.1.5-rc / dsh-tui 0.10.1 code):
 *
 * - A model request already in flight cannot be appended to; the only ways a
 *   message reaches the model are the next step boundary of the running turn
 *   (`Agent.steer`, which the pending message itself forces to happen — see
 *   the `turnEnds && inbox.nextStep.length === 0` break in dsh-agent-loop) or
 *   a brand-new turn (`Agent.followup`).
 * - `Agent.cancel()` does NOT discard the half-written answer: dsh-agent-loop
 *   commits it as an `assistant/message` with `interrupted: true` on the
 *   model-visible surface, so a half answer survives the interrupt. What an
 *   interrupt does cost is the current step: an undispatched tool call is
 *   durably recorded as `tool call aborted before dispatch` and the transcript
 *   gains the host's own "interrupted by user" notice row.
 *
 * So the default `smart` mode interrupts only when nothing else can be lost —
 * no tool in flight, model streaming text — and steers otherwise. `always`
 * and `never` exist for the user to overrule that judgement, and the settings
 * screen exposes them without a restart.
 *
 * Configuration is read LIVE from the plugin's own settings namespace: the
 * composition entry stays the base layer, and a change made in `/settings`
 * takes effect on the next keypress (a changed combo rebinds immediately).
 *
 * @module dsh-mama-cheer/plugin
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import { createLog } from './log.js'
import { SETTINGS_NS, buildSection } from './settings.js'

export const name = 'dsh-mama-cheer'

/** Accepted `interruptMode` values (validated by hand: a bad value falls back). */
export const INTERRUPT_MODES = Object.freeze(['smart', 'always', 'never'])

/** Accepted `display` values. */
export const DISPLAY_MODES = Object.freeze(['toast', 'none', 'bubble'])

/** Two presses closer together than this are one press (accidental repeats). */
export const DEBOUNCE_MS = 300

/** How long a cancel is assumed to be settling before another one is allowed. */
export const SETTLE_MS = 1500

export const Config = z.object({
  /** Text delivered to the model. */
  text: z.string().default('妈妈加油！'),
  /** Combo handed to `ctx.tuiShortcuts.register` (must carry ctrl or alt). */
  combo: z.string().default('ctrl+alt+m'),
  /** `smart` = interrupt only while no tool is in flight; `always`; `never`. */
  interruptMode: z.string().default('smart'),
  /** `toast` = transient notice; `none` = silent; `bubble` = a visible user message. */
  display: z.string().default('toast'),
  /** Toast lifetime in ms (host clamps to 500..12000). */
  toastMs: z.number().default(3000),
  /** Preserve the user's own queued messages across an interrupt. */
  keepInbox: z.boolean().default(true),
  /** Readiness retry cadence and budget (seam rows are often still activating). */
  retryMs: z.number().default(400),
  retryLimit: z.number().default(50),
})

/** Normalize a configured interrupt mode, falling back to `smart`. */
export function normalizeMode(value) {
  return INTERRUPT_MODES.includes(value) ? value : 'smart'
}

/** Normalize a configured display mode, falling back to `toast`. */
export function normalizeDisplay(value) {
  return DISPLAY_MODES.includes(value) ? value : 'toast'
}

/** Clamp a toast lifetime into the host's accepted window. */
export function clampToast(ms) {
  const value = typeof ms === 'number' && Number.isFinite(ms) ? ms : 3000
  return Math.min(12000, Math.max(500, Math.floor(value)))
}

/**
 * Decide how this press delivers its message.
 *
 * @param input - `mode` (normalized), whether the agent is `running`, and
 *   whether a tool call is currently in flight for that session.
 * @returns `'followup'` (idle, starts a turn), `'steer'` (no interrupt), or
 *   `'interrupt'` (cancel then deliver).
 */
export function decidePlacement({ mode, running, toolBusy }) {
  if (!running) return 'followup'
  if (mode === 'never') return 'steer'
  if (mode === 'always') return 'interrupt'
  return toolBusy ? 'steer' : 'interrupt'
}

/**
 * Message source for the configured display mode.
 *
 * `source.kind !== 'user'` messages are not rendered as a transcript bubble
 * (dsh-tui `dsh-adapter/channel/projection.js`: "Injected context (plugin/skill
 * source) is not a human bubble; v1 renders direct human prompts only"), while
 * they still reach the model. That is what makes a silent or toast-only cheer
 * possible at all.
 */
export function sourceFor(display) {
  return normalizeDisplay(display) === 'bubble'
    ? { kind: 'user' }
    : { kind: 'plugin', plugin: 'mama-cheer' }
}

/** Stable string id of a session/agent. */
export function sessionIdOf(value) {
  const id = value?.id
  return id === undefined || id === null ? undefined : String(id)
}

/**
 * Pick the agent this keypress belongs to.
 *
 * One TUI window is normally one live agent, but a host process can hold
 * several (subagents, several windows): prefer an agent that is actually
 * running, then the one whose session event was seen most recently.
 *
 * @param agents - the `ctx.agents` registry (optional).
 * @param recent - `Map<sessionId, lastSeenEpochMs>` of observed sessions.
 */
export function pickAgent(agents, recent) {
  const list = typeof agents?.list === 'function' ? agents.list() : undefined
  if (!Array.isArray(list) || list.length === 0) return undefined
  const running = list.filter((agent) => agent?.status === 'running')
  const pool = running.length > 0 ? running : list
  if (pool.length === 1) return pool[0]
  let best = pool[0]
  let bestSeen = -1
  for (const agent of pool) {
    const seen = recent?.get?.(String(agent?.id)) ?? -1
    if (seen > bestSeen) {
      bestSeen = seen
      best = agent
    }
  }
  return best
}

/**
 * Resolve a host service strictly first, then loosely (SOP §2.1 rule 2): the
 * strict read hides a provider whose fiber has not reached ACTIVE, the loose
 * read may hand back a shadow placeholder whose methods the host refuses.
 */
export function firstService(ctx, serviceName) {
  try {
    const strict = ctx.get(serviceName)
    if (strict !== undefined && strict !== null) return strict
  } catch {
    /* a missing provider is not an error here */
  }
  try {
    const loose = ctx.get(serviceName, false)
    if (loose !== undefined && loose !== null) return loose
  } catch {
    /* neither form is available */
  }
  return undefined
}

function describeError(error) {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}

/** Keep the most recent N sessions, dropping the least recently seen. */
function noteSession(recent, id) {
  recent.set(id, Date.now())
  if (recent.size <= 16) return
  let oldestKey
  let oldestAt = Number.POSITIVE_INFINITY
  for (const [key, at] of recent) {
    if (at < oldestAt) {
      oldestAt = at
      oldestKey = key
    }
  }
  if (oldestKey !== undefined && oldestKey !== id) recent.delete(oldestKey)
}

function showToast(ctx, config, log, text, color) {
  const service = firstService(ctx, 'tuiToast')
  if (service === undefined || typeof service.show !== 'function') {
    log.once('no-toast', 'toast seam unavailable; feedback goes to the log only')
    return
  }
  try {
    service.show(String(text), { color, timeoutMs: clampToast(config.toastMs) })
  } catch (error) {
    log.once('toast-threw', `toast threw: ${describeError(error)}`)
  }
}

/**
 * One keypress: resolve the agent, decide the placement, deliver.
 *
 * Never throws: a failing keypress must not take the keyboard down for every
 * other binding in the TUI.
 */
export function cheer(ctx, config, state, log) {
  const now = Date.now()
  if (state.lastCheerAt !== 0 && now - state.lastCheerAt < DEBOUNCE_MS) {
    log.once('debounced', 'cheer ignored: within the debounce window')
    return
  }
  state.lastCheerAt = now
  if (state.settling) {
    log.once('settling', 'cheer ignored: a previous interrupt is still settling')
    return
  }

  const agents = firstService(ctx, 'agents')
  const agent = pickAgent(agents, state.recent)
  if (agent === undefined) {
    log.once('no-agent', 'cheer skipped: no live agent in this process')
    showToast(ctx, config, log, '没找到活动会话，未发送', 'warning')
    return
  }

  const running = agent.status === 'running'
  const toolBusy = (state.tools.get(sessionIdOf(agent)) ?? 0) > 0
  const placement = decidePlacement({ mode: normalizeMode(config.interruptMode), running, toolBusy })
  const message = createUserMessage({
    content: [{ type: 'text', text: String(config.text) }],
    source: sourceFor(config.display),
  })
  log.line(`cheer placement=${placement} agent=${sessionIdOf(agent)} running=${running} toolBusy=${toolBusy}`)

  try {
    if (placement === 'steer') {
      agent.steer(message)
    } else if (placement === 'followup') {
      agent.followup(message)
    } else {
      state.settling = true
      try {
        agent.cancel({ kind: 'user' }, config.keepInbox === false ? undefined : { keepInbox: true })
        // The host's own interruptAndDeliver also defers the re-queue with
        // queueMicrotask ("let cancel finish its synchronous inbox bookkeeping
        // before waking"): dsh-agent's cancel-convergence latch accepts this
        // followup and starts it once the aborted turn retires.
        queueMicrotask(() => {
          try {
            agent.followup(message)
          } catch (error) {
            log.line(`followup after cancel failed: ${describeError(error)}`)
          }
        })
      } finally {
        const settleTimer = setTimeout(() => {
          state.settling = false
        }, SETTLE_MS)
        settleTimer.unref?.()
      }
    }
  } catch (error) {
    log.line(`cheer failed: ${describeError(error)}`)
    showToast(ctx, config, log, `发送失败：${describeError(error)}`, 'error')
    return
  }

  if (normalizeDisplay(config.display) === 'toast') showToast(ctx, config, log, config.text, 'success')
}

/**
 * Binds ONE combo at a time and rebinds on demand.
 *
 * A refusal is not a verdict (SOP §2.1 rule 3): the extensions row is often
 * still activating on the first tick and refuses silently, so the caller
 * retries by calling `ensure` again until it reports success. Rebinding first
 * disposes the previous registration — a stale binding for an old combo would
 * otherwise keep firing after the setting changed.
 *
 * @param ctx - the plugin activation context.
 * @param state - shared keypress state.
 * @param log - lifecycle log.
 * @param currentConfig - reads the live config (settings layer applied).
 */
export function createShortcutBinder(ctx, state, log, currentConfig) {
  let combo
  let bound = false
  let disposeRegistered

  const unbind = () => {
    if (typeof disposeRegistered === 'function') {
      try {
        disposeRegistered()
      } catch {
        /* an already-disposed registration is fine */
      }
    }
    disposeRegistered = undefined
    bound = false
  }

  const ensure = (nextCombo, options = {}) => {
    const target = typeof nextCombo === 'string' ? nextCombo.trim() : ''
    if (target === '') return false
    if (bound && combo === target && options.force !== true) return true
    unbind()
    combo = target

    const shortcuts = firstService(ctx, 'tuiShortcuts')
    if (shortcuts === undefined || typeof shortcuts.register !== 'function') return false

    let disposer
    try {
      disposer = shortcuts.register(
        target,
        {
          description: 'Send the configured cheer message into the live conversation',
          handler: () => {
            try {
              cheer(ctx, currentConfig(), state, log)
            } catch (error) {
              log.line(`handler threw: ${describeError(error)}`)
            }
          },
        },
        ctx,
      )
    } catch (error) {
      log.once(`register-threw:${target}`, `shortcut register threw for ${target}: ${describeError(error)}`)
    }

    if (typeof disposer === 'function') {
      disposeRegistered = disposer
      bound = true
      log.once(`registered:${target}`, `shortcut registered ${target}`)
      return true
    }
    log.once(`refused:${target}`, `shortcut refused for ${target} (reserved, malformed, or duplicate)`)
    return false
  }

  return { ensure, unbind, isBound: () => bound, boundCombo: () => combo }
}

function resolveBounded(value, fallback, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.floor(number)))
}

/**
 * Cordis entry point.
 *
 * @param ctx - the plugin activation context.
 * @param config - resolved composition config; the settings namespace layers on
 *   top of it at read time.
 */
export function apply(ctx, config) {
  const resolved = config ?? {}
  const log = createLog()
  const state = {
    recent: new Map(),
    tools: new Map(),
    lastCheerAt: 0,
    settling: false,
  }
  const runtime = { scope: undefined, sectionDisposer: undefined }

  log.line(`module imported; apply() pid=${process.pid} entry=${import.meta.url}`)
  log.line(`config ${JSON.stringify(resolved)}`)

  /** Composition value with the live settings layer merged on top. */
  const currentConfig = () => {
    let live
    try {
      live = runtime.scope?.get?.()
    } catch (error) {
      log.once('settings-read-failed', `settings read failed: ${describeError(error)}`)
      live = undefined
    }
    if (live === undefined || live === null || typeof live !== 'object') return resolved
    return { ...resolved, ...live }
  }

  const binder = createShortcutBinder(ctx, state, log, currentConfig)

  ctx.on('session/event', (session, event) => {
    const id = sessionIdOf(session)
    if (id === undefined) return
    noteSession(state.recent, id)
    if (event?.type === 'tool/call') state.tools.set(id, (state.tools.get(id) ?? 0) + 1)
    else if (event?.type === 'tool/result') state.tools.set(id, Math.max(0, (state.tools.get(id) ?? 0) - 1))
  })
  ctx.on('session/disposed', (session) => {
    const id = sessionIdOf(session)
    if (id === undefined) return
    state.recent.delete(id)
    state.tools.delete(id)
  })
  ctx.effect(() => () => {
    state.recent.clear()
    state.tools.clear()
    if (typeof runtime.sectionDisposer === 'function') {
      try {
        runtime.sectionDisposer()
      } catch {
        /* already disposed */
      }
    }
    binder.unbind()
    runtime.scope = undefined
    log.line('unloaded')
  })

  const retryMs = resolveBounded(resolved.retryMs, 400, 100, 5000)
  const retryLimit = resolveBounded(resolved.retryLimit, 50, 1, 600)
  let attempts = 0
  let timer

  // One readiness loop over all three dependencies: the settings namespace, the
  // settings section, and the shortcut binding. Any of them can be refused on
  // the first tick while its seam row is still activating.
  const tick = () => {
    attempts += 1

    if (runtime.scope === undefined) {
      const settings = firstService(ctx, 'settings')
      if (settings !== undefined && typeof settings.register === 'function') {
        try {
          const scope = settings.register(SETTINGS_NS, Config)
          runtime.scope = scope
          log.once('settings-ns', `settings namespace ${SETTINGS_NS} registered`)
          try {
            scope.watch?.((next) => {
              log.line(`settings updated ${JSON.stringify(next)}`)
              const nextCombo = typeof next?.combo === 'string' ? next.combo : undefined
              if (nextCombo !== undefined && nextCombo.trim() !== '' && nextCombo !== binder.boundCombo()) {
                binder.ensure(nextCombo, { force: true })
              }
            })
          } catch (error) {
            log.once('settings-watch-failed', `settings watch failed: ${describeError(error)}`)
          }
        } catch (error) {
          log.once('settings-ns-failed', `settings namespace registration failed: ${describeError(error)}`)
        }
      }
    }

    if (runtime.sectionDisposer === undefined) {
      const sections = firstService(ctx, 'tuiSettingsSections')
      if (sections !== undefined && typeof sections.register === 'function') {
        try {
          const disposer = sections.register(buildSection())
          if (typeof disposer === 'function') {
            runtime.sectionDisposer = disposer
            log.once('settings-section', 'settings section registered')
          }
        } catch (error) {
          log.once('settings-section-failed', `settings section registration failed: ${describeError(error)}`)
        }
      }
    }

    binder.ensure(currentConfig().combo)

    const ready = runtime.scope !== undefined && runtime.sectionDisposer !== undefined && binder.isBound()
    log.once(
      'seams',
      `seams settings=${runtime.scope === undefined ? 0 : 1} ` +
        `sections=${runtime.sectionDisposer === undefined ? 0 : 1} ` +
        `shortcuts=${firstService(ctx, 'tuiShortcuts') === undefined ? 0 : 1} ` +
        `agents=${firstService(ctx, 'agents') === undefined ? 0 : 1} ` +
        `toast=${firstService(ctx, 'tuiToast') === undefined ? 0 : 1}`,
    )
    if (ready) {
      log.once('ready', `ready after ${attempts} attempt(s)`)
      return
    }
    if (attempts >= retryLimit) {
      log.once('not-ready', `not fully ready after ${attempts} attempts; continuing in degraded mode`)
      return
    }
    timer = setTimeout(tick, retryMs)
    timer.unref?.()
  }

  tick()
  ctx.effect(() => () => {
    clearTimeout(timer)
  })
}
