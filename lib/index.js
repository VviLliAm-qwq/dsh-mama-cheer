/**
 * dsh-mama-cheer — Cordis entry.
 *
 * Re-exports exactly the three symbols a Cordis plugin entry is read for
 * (`name`, `Config`, `apply`) and nothing else. An entry module that carries
 * extra symbols changes how the loader wraps the activation, after which every
 * TUI seam registration is refused with `requires a live Cordis activation
 * context` — the plugin looks half-alive (see `docs/DSH-PLUGIN-SOP.md` §2.1).
 * The implementation lives in `./plugin.js`; `test/entry.test.js` pins the shape.
 *
 * @module dsh-mama-cheer
 */

export { Config, apply, name } from './plugin.js'
