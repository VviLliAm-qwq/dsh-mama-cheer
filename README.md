# dsh-mama-cheer

A keyboard shortcut that drops one short, configurable encouraging message into the **live** conversation of [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) — without leaving the terminal and without waiting for the current turn to end.

```text
press ctrl+alt+m  →  the message reaches the model at the earliest legal moment
```

## What it actually does

A model request already in flight cannot be appended to: the request has left the process and the stream is one-way. There are exactly two places a new user message can reach the model, and this plugin picks between them per keypress:

| Model state | Delivery | What the model sees |
|---|---|---|
| idle | `Agent.followup` | a normal next turn |
| running, **a tool call is in flight** | `Agent.steer` | the message at the next step boundary — no interrupt, the running tool finishes untouched |
| running, only streaming text | `Agent.cancel({ keepInbox: true })` + `followup` | the half-written answer is kept (`interrupted: true`) and the model reads the message in the new turn immediately |

The middle row is the point of the default `smart` policy: interrupting a tool call leaves a durable `tool call aborted before dispatch` record and the host's own "interrupted by user" notice, while interrupting a text stream costs almost nothing. Only the third row ever interrupts. `always` and `never` are one setting away if you disagree with that judgement.

Two facts this design rests on, both read from the shipped code and one of them verified locally:

- An interrupt **does not discard** the generated text. `dsh-agent-loop` commits the partial answer as an `assistant/message` with `interrupted: true` on the model-visible surface, so it stays in the conversation and in the next request.
- `Agent.cancel()` is called with `keepInbox: true`, the same option the host's own Ctrl+Enter path uses, so messages **you** already queued are not dropped.

## Install

```powershell
dsh plugin --profile dsh-tui add dsh-mama-cheer
```

Then restart the TUI with `/restart`.

Local checkout during development:

```powershell
dsh plugin --profile dsh-tui add file:C:\path\to\dsh-mama-cheer
```

The installer hard-links the package's `files` list into the profile, so after adding a new module under `lib/` you must **remove and re-add** — running `add` again prints "Already up to date" and changes nothing.

## Compatibility

| Item | Value |
|---|---|
| Host | dsh-TUI 0.10.1-era seams: `tuiShortcuts`, `tuiSettingsSections`, `tuiToast`, plus the public `ctx.agents` registry |
| Manifest | `manifestVersion` 0.15, host facet only, **no permissions requested** |
| Runtime | Node `^22.19 || >=24`, pure ESM, no build step (`lib/` is the published source) |
| Platforms | The delivery path is platform-neutral (it drives the agent inbox). The toast feedback needs a TUI notification sink; without one it degrades to log-only. |

Every host service is optional and retried until it is ACTIVE: a missing seam disables exactly that one capability (no shortcut, no settings card, or no toast) and never the boot.

## Configuration

Every key has a default; a missing key means "no behaviour change", never a failed boot.

| Key | Default | Meaning |
|---|---|---|
| `text` | `妈妈加油！` | Text delivered to the model |
| `combo` | `ctrl+alt+m` | Shortcut to register; must carry `ctrl` or `alt` (the host refuses modifier-less and reserved combos) |
| `interruptMode` | `smart` | `smart` = interrupt only while no tool is in flight · `always` = interrupt whenever the model is running · `never` = never interrupt, always steer |
| `display` | `toast` | `toast` = transient notice, message stays out of the transcript · `none` = completely silent · `bubble` = the message appears as a normal user message |
| `toastMs` | `3000` | Toast lifetime (host clamps to 500–12000 ms) |
| `keepInbox` | `true` | Preserve already-queued messages across an interrupt |
| `retryMs` / `retryLimit` | `400` / `50` | Readiness retry cadence and budget (composition-only; not shown in the settings screen) |

## Settings screen

All six user-facing keys are also editable in `/settings` (section **Mama Cheer**), with zh/en labels, hints and select options:

```text
/settings → Mama Cheer
  Cheer message                 [text]
  Shortcut                      [text]
  Interrupt policy              [select: Smart | Always interrupt | Never interrupt]
  Display                       [select: Toast | Silent | User message]
  Toast lifetime (ms)           [number]
  Keep my queued messages       [boolean]
```

Values are read **live on every keypress** — no restart, no rebind dance:

- the composition entry is the base layer and the settings layer is merged on top at press time;
- changing `Shortcut` **rebinds immediately** (the stale binding is disposed first, so the old combo stops firing).

## Known limitations

- **The interrupt notice row cannot be changed or removed.** It is a host-owned projection (`dsh-adapter/channel/projection.js`) and the renderer seam forbids shadowing built-in event types. It appears only when the policy actually interrupts.
- **A custom transcript row is not possible in this build.** The renderer seam expects a plugin to append a log-only session event, but `Session.append()` has no way to set the `ignorable: true` envelope marker that the persistence contract requires for out-of-repo event types. Measured locally: an unknown non-ignorable event makes the session log **unreadable on the next load** (`SessionFormatUnsupportedError`, "refusing to interpret the log"). This plugin therefore never writes session events of its own.
- **Keyboard only in the plain chat state.** While a picker, dialog or scene is open, the keyboard belongs to that overlay and the shortcut does not match.
- **Targeting is heuristic.** One window normally means one live agent; with several live agents the plugin prefers a running one, then the session whose events were seen most recently.
- **Headless hosts have no keyboard and no toast sink.** The message path still works; the feedback does not.

## Release and versioning

- Repository: [VviLliAm-qwq/dsh-mama-cheer](https://github.com/VviLliAm-qwq/dsh-mama-cheer)
- Published to npm as `dsh-mama-cheer` (`--access public --provenance`).
- Releases are **tag-driven**: pushing a `v*` tag runs `.github/workflows/release.yml`, which re-runs the full verification, checks that the tag equals the `package.json` version, and publishes. No long-lived npm token is stored — the workflow exchanges its OIDC token through npm trusted publishing.
- SemVer; `CHANGELOG.md` records every version, and the manifest version moves with the package version.

## Verification

```text
npm run verify                       # encoding + manifest + tests + pack layout
node --test                          # 28 tests: entry export shape, placement matrix, delivery, settings wiring
node tools/probe-plugin.mjs <dir>    # headless real composition; exit 0 and "shortcut registered ..."
```

Probe output on a passing run:

```text
seams settings=1 sections=1 shortcuts=0 agents=1 toast=0
settings namespace dsh-mama-cheer registered
settings section registered
shortcut registered ctrl+alt+m
ready after 2 attempt(s)
VERDICT: PASS — the plugin applied and its registrations were accepted
```

The first-tick refusal followed by a successful retry is the documented seam behaviour, not a defect.

## Design notes

- The entry module (`lib/index.js`) re-exports exactly `name`, `Config`, `apply`. Extra symbols change how the loader wraps the activation, and every seam registration is then refused with `requires a live Cordis activation context` — the plugin looks half-alive.
- Optional services are read strictly first, then loosely, and every registration is retried until the provider is ACTIVE.
- No permissions are requested: the plugin intercepts nothing, observes nothing, and stores nothing outside its own log file (`~/.dsh-tui/dsh-mama-cheer.log`, capped at 64 KB, not written under `node --test`).
- A failing keypress is contained: it logs and toasts instead of throwing, so it can never take the keyboard down for other bindings.
- `src/` is intentionally absent — the plugin is plain ESM with no build step, so the published `lib/` is the source of truth.

## License

MIT
