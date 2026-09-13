/**
 * dsh-mama-cheer — bounded lifecycle log.
 *
 * The host keeps no plugin diagnostics of its own, so "the host never loaded
 * the file", "it loaded but the shortcut was refused" and "the shortcut fired
 * but delivery went nowhere" are indistinguishable without this file. Every
 * line here exists to separate those cases (`docs/DSH-PLUGIN-SOP.md` §2.2).
 *
 * Rules:
 * - one file per plugin under `~/.dsh-tui/`, capped, newest kept on trim;
 * - never written under `node --test` (test runs must not touch the user's
 *   state directory), and never a reason for the plugin to throw.
 *
 * @module dsh-mama-cheer/log
 */

import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Hard size ceiling; on overflow the newest half is kept. */
export const LOG_LIMIT_BYTES = 64 * 1024

/** Whether this process is a Node test run. */
export function isTestRun(argv = process.argv, env = process.env) {
  if (env.DSH_MAMA_CHEER_LOG === '0') return true
  if (env.NODE_TEST_CONTEXT !== undefined) return true
  return argv.some((arg) => arg === '--test')
}

/** Resolve the log path; `DSH_MAMA_CHEER_LOG_FILE` overrides for diagnostics. */
export function logPath(env = process.env) {
  const override = env.DSH_MAMA_CHEER_LOG_FILE
  if (typeof override === 'string' && override.trim() !== '') return override
  return join(homedir(), '.dsh-tui', 'dsh-mama-cheer.log')
}

/**
 * Create the plugin's logger. Every method swallows its own I/O failure: a
 * read-only home directory must degrade to "no log", never to a dead plugin.
 *
 * @param options - optional `path` and `enabled` overrides for tests.
 * @returns `{ line, once, path, enabled }`
 */
export function createLog(options = {}) {
  const path = options.path ?? logPath()
  const enabled = options.enabled ?? !isTestRun()
  const seen = new Set()

  const stamp = () => new Date().toISOString()

  const trim = (text) => {
    try {
      if (statSync(path).size <= LOG_LIMIT_BYTES) return text
    } catch {
      return text
    }
    const half = Math.floor(text.length / 2)
    return `[trimmed]\n${text.slice(text.length - half)}`
  }

  const line = (message) => {
    if (!enabled) return
    try {
      mkdirSync(join(path, '..'), { recursive: true })
      let existing = ''
      try {
        existing = readFileSync(path, 'utf8')
      } catch {
        existing = ''
      }
      const next = trim(`${existing}${stamp()} ${String(message)}\n`)
      writeFileSync(path, next)
    } catch {
      /* logging must never be the reason a keypress fails */
    }
  }

  /** Log once per key, so a 400ms retry loop cannot flood the file. */
  const once = (key, message = key) => {
    if (seen.has(key)) return
    seen.add(key)
    line(message)
  }

  return { line, once, path, enabled }
}
