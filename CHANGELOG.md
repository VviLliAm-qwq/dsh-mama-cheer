# Changelog

All notable changes to this plugin. Versions follow SemVer; the package version
and the manifest version move together.

## 0.2.0 — 2026-09-13

Settings screen support.

- The plugin now registers its own settings namespace (`dsh-mama-cheer`) and a
  `ctx.tuiSettingsSections` section, so `text`, `combo`, `interruptMode`,
  `display`, `toastMs` and `keepInbox` are editable in `/settings` (zh/en
  labels, hints and select options included).
- Configuration is read LIVE on every keypress: the composition entry stays the
  base layer and the settings layer is merged on top, so an edit takes effect on
  the next press without a restart.
- A changed `combo` rebinds immediately: the watcher disposes the stale binding
  before registering the new one, so the old shortcut stops firing.
- One readiness loop now covers all three dependencies (settings namespace,
  settings section, shortcut binding) and keeps retrying while any seam row is
  still activating, instead of a shortcut-only retry.
- Test count 18 → 28 (section descriptor, namespace/field cross-check, binder
  rebinding, live-value delivery through a fake Cordis context).

## 0.1.0 — 2026-09-13

First version.

- One configurable shortcut (`ctrl+alt+m` by default) delivers one configurable
  message (`妈妈加油！` by default) into the live conversation.
- Three delivery shapes, chosen per keypress by `interruptMode`:
  - idle → `Agent.followup`;
  - running with a tool call in flight → `Agent.steer` (no interrupt);
  - running while only streaming text → `Agent.cancel({ keepInbox: true })` then
    `followup`, in the same order the host's own `interruptAndDeliver` uses.
- `display` chooses what the user sees: `toast` (transient notice, message stays
  out of the transcript), `none` (silent), or `bubble` (a normal user message).
  Silent modes ride `source: { kind: 'plugin', plugin: 'mama-cheer' }`, which the
  host's transcript projection skips while the model still receives the message.
- No permissions are requested; the plugin only reads the public `ctx.agents`
  registry and the `session/event` feed, and writes one capped lifecycle log to
  `~/.dsh-tui/dsh-mama-cheer.log`.

### Measured findings this release records

- **An interrupt keeps generated text.** Aborting a streaming turn commits the
  partial answer as an `assistant/message` with `interrupted: true` on the
  model-visible surface (`dsh-agent-loop/lib/index.js`), so the half answer
  survives in the transcript and in the next request. An earlier assumption that
  an interrupt discards it was wrong.
- **A pending steer message extends the turn.** The agent loop only ends a turn
  when the `next-step` inbox is empty (`turnEnds && inbox.nextStep.length === 0`),
  so a queued message is claimed at the very next step boundary even when the
  model was answering in plain text with no tool call pending.
- **Plugin-written custom transcript rows are unsafe in this build.** Adding a
  renderer for an own log-only event type requires appending that event to the
  session log, but `Session.append()` cannot set the `ignorable: true` envelope
  marker that the persistence contract requires for out-of-repo event types. A
  local end-to-end test (write an unknown event, close, reopen) produced
  `SessionFormatUnsupportedError: ... unknown to this harness and not marked
  ignorable; refusing to interpret the log`, i.e. the session log became
  unreadable. The same test passed with `ignorable: true` and with a known
  event type, isolating the marker as the deciding factor. This plugin therefore
  never writes session events.
- **`ctx.agents` is reachable from a plugin activation.** Confirmed by the
  headless probe (`agents=1`) as well as by the host's own
  `export const inject = ['agents']` row.
