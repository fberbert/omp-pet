# AGENTS.md

Entry point for coding agents working in this repository. Keep it short and operational. Architecture lives in `docs/project/`.

## Project overview

OMP Pet is an Electron desktop pet for Linux (X11; Wayland sessions through XWayland). It follows OMP (oh-my-pi) coding sessions through a global OMP extension and plays pixel animations for their state. It is a fork of Clawd on Desk reduced to one agent (OMP) and one platform (Linux). Built-in themes: Clawd, Calico, Cloudling; user themes are supported. UI languages: en, pt-BR.

The pet is state-only. It never approves, denies or changes anything inside OMP.

## Common commands

```bash
npm install
npm start
npm test
npm run build                  # electron-builder --linux
npm run build:linux:x64        # AppImage + deb
npm run verify:electron
npm run audit:assets
npm run audit:native-package -- --app-root <extracted-app-root> --target linux-x64
npm run create-theme -- <id>

npm run install:omp-extension
npm run uninstall:omp-extension

bash test-demo.sh [seconds]
bash test-mini.sh [seconds]
bash test-oneshot-gate.sh [state|all] [seconds]
```

The dev scripts find the running pet's port through `scripts/dev-port.sh` (`~/.omp-pet/runtime.json`).

On launch, the extension is synced into the active OMP agent directory only when `agents.omp.integrationInstalled` and `agents.omp.enabled` are both true. Settings → AI Coding Tools → Install installs and enables it; Uninstall removes the pet-managed directory and clears `integrationInstalled`. Turning `enabled` off only stops event intake and leaves files in place.

## Read these docs

- `docs/project/agent-runtime-architecture.md`: event path, server, gate, integration sync, state machine, windows, focus, settings, data locations
- `docs/project/theme-state-ui.md`: state priorities and timing, theme system, Settings layers, mini mode, runtime UI notes, AppImage runtime
- `docs/project/release-process.md`: release checklist and the Linux build workflow
- `docs/guides/state-mapping.md`: OMP event to state to animation
- `docs/guides/setup-guide.md`: install, extension directory resolution, troubleshooting
- `docs/guides/known-limitations.md`
- `docs/guides/recap.md`: Footprints metrics, storage and privacy rules
- `docs/guides/guide-theme-creation.md`
- `docs/guides/roam-fence.md`

## Runtime summary

- Event path: `hooks/omp-extension.ts` + `hooks/omp-extension-core.js` (inside OMP) → `POST /state` → `src/server.js` → `src/server-route-state.js` → `src/agent-runtime-main.js` → `src/state.js` → IPC.
- `src/pet-window-runtime.js` creates and positions the render and hit windows.
- `src/state.js` produces the session snapshot consumed by the Dashboard, Session HUD, Discord presence and recap. Changing a field means checking every consumer.
- `src/integration-sync.js` keeps the installed extension in sync with this build.
- `src/agent-gate.js` holds the install intent and enabled gates.
- Settings: `src/prefs.js` → `src/settings-controller.js` (only writer) → `src/settings-store.js`; `settings-actions*` validate and gate, `settings-effect-router.js` applies post-commit effects.

## Core files

| File | Responsibility |
|---|---|
| `src/main.js` | Electron composition root: lifecycle, wiring, IPC registration |
| `src/server.js` + `src/server-route-state.js` | local HTTP server, port selection, `runtime.json`, `/state` route |
| `src/agent-runtime-main.js` + `src/integration-sync.js` | server/state glue, extension sync |
| `src/state.js` + `src/state-*.js` | sessions, priority, one-shots, sleep, DND, stale cleanup, snapshot, visual resolution |
| `src/renderer.js` | animation swaps, SVG preload, eye tracking rendering |
| `src/pet-window-runtime.js` | render and hit window owner, positioning, edge pinning |
| `src/linux-x11-input-hint.js` | ICCCM input=False hint for the render window |
| `src/linux-ozone.js` | one-time XWayland relaunch decision |
| `src/dashboard.js` + `src/dashboard-renderer.js` | Sessions Dashboard |
| `src/session-hud.js` + `src/session-hud-renderer.js` | HUD next to the pet |
| `src/session-alias.js` | session alias keys and pruning |
| `src/theme-loader.js` + `src/theme-runtime.js` | stateless theme loading and sanitizing; the only active-theme owner |
| `src/prefs.js` | preference schema, load / save / migrate / validate |
| `src/settings-actions*.js` + `src/settings-effect-router.js` | validators, commands, pre-commit gates, post-commit effects |
| `src/settings-controller.js` / `src/settings-store.js` | only writer / immutable snapshot store |
| `src/settings-ui-core.js` + `src/settings-renderer.js` + `src/settings-tab-*.js` | Settings UI |
| `src/menu.js` | tray and context menus |
| `src/mini.js` | mini mode |
| `src/tick.js` | main loop, cursor polling, idle and sleep timing |
| `src/drag-position.js` / `src/visible-margins.js` | drop normalization and clamping / edge pinning |
| `src/focus.js` | terminal raise (wmctrl, xdotool) and tmux pane selection |
| `src/hit-renderer.js` + `src/hit-geometry.js` | hit window input, drag, clicks, folder drop |
| `src/recap-*.js` | Footprints (local recap) |
| `src/doctor.js` + `src/doctor-detectors/` | Doctor checks and report |
| `src/login-item.js` | XDG autostart entry |
| `agents/omp.js` + `agents/registry.js` | OMP agent descriptor and registry |
| `hooks/omp-extension.ts` | extension transport: PIDs, tmux, port discovery, POST |
| `hooks/omp-extension-core.js` | OMP event translation, titles, session ids, two-phase completion |
| `hooks/omp-install.js` | agent directory resolution, install / uninstall, marker ownership |
| `hooks/server-config.js` | shared port range, data dir name, runtime file helpers |

## Constraints

- Completion must use the two-phase protocol: a `session_stop` candidate committed only by the following `agent_end` with `willContinue !== true`. Mapping either event alone is wrong (see the architecture doc).
- `session_switch` / `session_branch` must send a synthetic `SessionEnd` for the session being left. Session ids are `omp:<raw>`, and `session_title` is always sent.
- The extension files are copied into OMP's agent directory and may only depend on Node built-ins and each other.
- Ownership of the installed extension is the `.omp-pet-managed.json` marker (`app: "omp-pet"`). A directory without it is never written or removed.
- The agent directory resolution in `hooks/omp-install.js` mirrors OMP (`PI_CONFIG_DIR`, `OMP_PROFILE` / `PI_PROFILE`, `PI_CODING_AGENT_DIR`). Do not simplify it to `~/.omp/agent`.
- The local server listens only on `127.0.0.1`, range 23533 to 23537 (disjoint from upstream Clawd's 23333 to 23337), then a saved dynamic hint, then an OS port. A dynamic port is published only after `~/.omp-pet/runtime.json` is written.
- Recap metric support comes only from `src/recap-metrics.js`. Record only accepted activity; `null` means unsupported and must never render or aggregate as `0`. Storage is `~/.omp-pet/recap-v1/` with 14 days of minimized tickets and 400 days of daily and coverage data. Never store prompts, replies, commands, tool content, paths, project names or raw ids, and add no network, export or sharing.
- Disabling the integration must not uninstall files. Uninstall goes through Settings or `npm run uninstall:omp-extension` and also clears `integrationInstalled`.
- The Settings store is the only source of truth and the controller its only writer.
- Each package keeps exactly one Linux x64 Koffi `koffi.node`. `afterPack` may prune only physical files under `app.asar.unpacked`, never rewrite `app.asar`, and must pass the native inventory audit.
- Build resource paths with `path.join(__dirname, ...)`.
- Copy artwork to `assets/source/` before editing it. `assets/source/cloudling-pointer-bridge/` is a kept source directory; do not clean it up.
- `assets/icons/agents/omp.png` (source copy in `assets/source/agent-icons/omp.png`) is a placeholder pi glyph, not official OMP branding. Replace both with licensed artwork when one exists, keeping the runtime copy at 64x64.

## Testing

- Run the repository build with `npm start`. It shares `~/.config/omp-pet` and the single-instance lock with an installed copy, so quit that first. If chrome-sandbox fails in a dev environment, use `OMP_PET_DISABLE_SANDBOX=1`.
- Automated tests use Node's built-in runner: `npm test`. Electron-backed suites skip without a display; CI runs them under `xvfb-run`.
- Changes to the extension or the `/state` payload need at least one real OMP session; hand-written `curl` payloads are not enough.
- Transparent windows, tray, real dragging and focus are still verified by hand.

## High-risk gotchas

- The render window on X11 is sticky and must carry ICCCM `WM_HINTS` input=False (`src/linux-x11-input-hint.js`, written in `createRenderWindow()`). Without it mutter hands keyboard focus to the pet on every workspace switch. Do not switch to the `focusable:false` constructor option: Chromium makes that window override-redirect and stacking and clamping change.
- While `miniTransitioning` is set, every window-positioning path must check it first, or concurrent `setPosition()` calls can crash.
- Hiding the pet is not Do Not Disturb. Hiding stops painting; Do Not Disturb drops events.
- The Session HUD shows every live, non-headless, non-sleeping session, including idle ones marked Done. Do not filter on `state !== "idle"`.
- `mini-working` is optional and must degrade gracefully.
- `contextMenuOwner` must keep `parent: win`; with `closable:false` that keeps quit from hanging.
- The `?_t=` cache-bust query on `<img>` SVGs in `src/renderer.js` must stay. Chromium reuses the animation timeline for an identical SVG URL, so one-shot animations would freeze on their last frame.
