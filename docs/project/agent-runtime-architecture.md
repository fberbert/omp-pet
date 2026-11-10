# Runtime Architecture

How OMP Pet is wired at runtime. Read this before changing the event path, the state machine, windows or settings. Theme and UI details live in [theme-state-ui.md](theme-state-ui.md).

## Event path

```text
OMP session
  -> hooks/omp-extension.ts            (loaded by OMP from <agent dir>/extensions/omp-pet/)
  -> hooks/omp-extension-core.js       (OMP-specific event translation and completion fence)
  -> POST http://127.0.0.1:<port>/state
  -> src/server.js                     (listener, port selection, runtime.json)
  -> src/server-route-state.js         (body cap, validation, agent gate)
  -> src/agent-runtime-main.js         (server/state glue, integration resync entry point)
  -> src/state.js                      (sessions, priority, one-shots, sleep, DND)
  -> IPC to the render window (src/renderer.js) and the snapshot consumers
```

The extension and the core are copied verbatim into the OMP agent directory by `hooks/omp-install.js`. They may only depend on Node built-ins and on each other; nothing under `src/` is available to them at runtime.

### Extension

- `omp-extension.ts` owns transport: process-tree walk for `source_pid` / `agent_pid`, tmux socket and client detection, port discovery and the HTTP POST.
- `omp-extension-core.js` owns semantics: OMP event names to pet events, `session_title`, session id namespace `omp:<raw>`, the synthetic `SessionEnd` on `session_switch` / `session_branch`, and the two-phase completion.
- Completion is a two-phase protocol. `session_stop` records a main-session candidate; only the following `agent_end` with `willContinue !== true` sends `Stop`. Mapping either event alone is wrong: `agent_end` alone reports subagent and scheduling boundaries as finished, `session_stop` alone fires before other extensions decide to continue.
- The full mapping table is in [state-mapping.md](../guides/state-mapping.md).

### Server

- Listens only on `127.0.0.1`. Candidates: the last used port if it is in 23533 to 23537, then 23533 to 23537, then a saved dynamic-port hint, then port 0 (OS-assigned). `EACCES` and `EADDRINUSE` fall through to the next candidate.
- After binding, the server writes `~/.omp-pet/runtime.json` as `{ app: "omp-pet", port, ownerPid }`. A dynamic port is published only if that write succeeds; otherwise the listener closes.
- Responses carry the `x-omp-pet-server: omp-pet` header. The extension uses the header (or a JSON body with `app: "omp-pet"`) to confirm it reached the pet and not another local service.
- `hooks/server-config.js` holds the shared constants: `DEFAULT_SERVER_PORT = 23533`, the five-port range, `APP_DATA_DIR_NAME = ".omp-pet"`, runtime file helpers.

### Gate

`src/agent-gate.js` reads two flags from prefs for `agents.omp`: `integrationInstalled` (install intent) and `enabled` (event intake). A disabled integration drops `/state` events quickly and stops nothing else. Disabling never uninstalls files.

### Integration sync

`src/integration-sync.js` copies the extension into the resolved OMP agent directory. Startup sync runs only when the integration is installed and enabled. Settings Install / Uninstall and Doctor Repair call the same entry points explicitly. Ownership is the `.omp-pet-managed.json` marker; a directory without it is never written or removed.

The agent directory resolution in `hooks/omp-install.js` mirrors OMP: `PI_CONFIG_DIR` (config root), `OMP_PROFILE` then `PI_PROFILE` (named profile), `PI_CODING_AGENT_DIR` (default-profile override), with OMP's `default` sentinel and inherited-profile guard.

## State machine

`src/state.js` keeps a bounded map of live sessions. Each event updates one session; the pet shows the highest-priority state across sessions.

| Module | Responsibility |
|---|---|
| `state.js` | session map, event handling, one-shot states, sleep sequence, DND, sound triggers |
| `state-priority.js` | state priority and the one-shot set (`attention`, `error`, `sweeping`, `notification`, `carrying`) |
| `state-session-events.js` | per-session recent event history |
| `state-stale-cleanup.js` | periodic sweep: delete a session whose process is gone or that went quiet past `sessionStaleMs`; settle a working session to idle after `workingStaleMs` |
| `state-session-snapshot.js` | the session snapshot shared by Dashboard, HUD, Discord presence and the recap |
| `state-visual-resolver.js` | logical state to theme file, including working tiers and idle visual choice |
| `state-hitbox-resolver.js` | hit area for the current visual |

Process liveness uses `agent_pid` (the OMP process) and falls back to `source_pid` (the terminal). Only live sessions count toward the working tiers.

The session snapshot is a contract. `dashboard.js`, `session-hud.js`, `session-ipc.js`, `main.js` and `discord-presence-rpc.js` consume it; check all of them when changing a field.

## Recap

`src/recap-runtime.js` receives events after the gate and the state machine accept them. Metric support is the explicit OMP row in `src/recap-metrics.js` (turns from `Stop`, tools from `PreToolUse`, sessions-started unsupported). Storage is `~/.omp-pet/recap-v1/` via `recap-store.js`, `recap-journal.js`, `recap-aggregate.js` and `recap-coverage.js`. Privacy and retention rules are in [recap.md](../guides/recap.md).

## Windows

The pet is two windows created and positioned by `src/pet-window-runtime.js`:

- **Render window**: transparent, click-through, shows the animation. On X11 it is sticky (all workspaces) and carries ICCCM `WM_HINTS` input=False from `src/linux-x11-input-hint.js`, written in `createRenderWindow()`. Without the hint, mutter puts the pet at the front of every workspace's focus history once it gains focus, and each workspace switch hands keyboard focus to the pet. Do not replace this with the `focusable:false` constructor option: Chromium then makes the window override-redirect, which changes stacking and position clamping.
- **Hit window**: receives pointer input for drag, clicks and folder drops (`hit-renderer.js`, `hit-geometry.js`). It is created `focusable:false`.

Other windows: Settings (`settings-window.js`), Dashboard (`dashboard.js`), Session HUD (`session-hud.js`), the roam-fence picker (`roam-fence-picker.js`) and the first-run tutorial (`tutorial.js`).

Related runtime modules: `tick.js` (main loop, cursor polling, eye tracking, idle and sleep timing), `mini.js` (mini mode), `roam.js` and `roam-fence.js` (free roam), `drag-position.js` (drop normalization and cross-display clamping), `visible-margins.js` (edge pinning).

### Wayland

`src/linux-ozone.js` relaunches the app once under XWayland (`--ozone-platform=x11`) when it starts in a Wayland session with an X server available, because Electron fixes the Ozone backend before app code runs. `OMP_PET_OZONE_PLATFORM` (`x11`, `wayland`, `auto`) overrides the decision; an explicit `--ozone-platform` flag always wins. Native Wayland is not a supported target.

## Terminal focus

`src/focus.js` raises the session's terminal with `wmctrl -lp` (window by PID) and falls back to `xdotool search --pid ... windowactivate`. When the extension reported a tmux socket and client, it then selects the session's pane. `focus.js` also has a herdr branch, but the OMP extension never sends herdr fields, so it is unreachable today. Every attempt is logged to `~/.config/omp-pet/focus-debug.log`.

## Settings

```text
src/prefs.js               schema, load / migrate / validate, omp-pet-prefs.json
src/settings-controller.js the only writer
src/settings-store.js      immutable snapshot store
src/settings-actions*.js   validators, commands, pre-commit gates
src/settings-effect-router.js  post-commit runtime effects and broadcasts
```

The store is the source of truth and the controller is its only writer; do not write prefs from anywhere else. The Settings UI is `settings-ui-core.js`, `settings-renderer.js` and one `settings-tab-*.js` per tab. Strings live in `src/i18n.js` (main process) and `src/settings-i18n.js` (Settings), English and Brazilian Portuguese only.

## Startup

`launch.js` starts Electron with `src/electron-launch-config.js` (sandbox on unless `OMP_PET_DISABLE_SANDBOX=1`). `src/main.js` is the composition root: single-instance lock, prefs load, XWayland decision, windows, server, integration sync, tray and menus (`menu.js`), global shortcuts (`shortcut-runtime.js`), recap and Discord presence. Open at login writes `~/.config/autostart/omp-pet.desktop` (`login-item.js`).

## Doctor

`src/doctor.js` runs the detectors in `src/doctor-detectors/` (local server, prefs readability, theme health, OMP integration) and `doctor-report.js` renders a redacted Markdown report. The OMP detector also lists on-disk profiles the pet does not manage.

## Data locations

| Path | Contents |
|---|---|
| `~/.config/omp-pet/` | Electron userData: `omp-pet-prefs.json`, logs, user themes in `themes/` |
| `~/.omp-pet/runtime.json` | current port and owner PID |
| `~/.omp-pet/roam-area.json` | optional roam fence |
| `~/.omp-pet/recap-v1/` | recap storage |
| `<OMP agent dir>/extensions/omp-pet/` | the installed extension and its marker |
