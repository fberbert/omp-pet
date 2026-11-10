# Theme, State and UI Notes

Implementation notes for the state machine, themes, Settings and the pet's windows. The runtime data path is in [agent-runtime-architecture.md](agent-runtime-architecture.md); the user-facing state table is in [state-mapping.md](../guides/state-mapping.md).

## Dual-window model

The pet uses two top-level windows:

- **Render window** (`win`): large, transparent, permanently `setIgnoreMouseEvents(true)`. It only draws the animation and eye tracking.
- **Hit window** (`hitWin`): a small transparent rectangle shaped with `setShape` over the current hit box, created with Electron `focusable: false`, permanently receiving pointer events.

Input flows `hitWin renderer -> IPC -> main -> render window renderer`.

On X11 the render window is sticky (visible on every workspace) and carries ICCCM `WM_HINTS` input=False (`src/linux-x11-input-hint.js`). Keep it that way; see the architecture doc for why the `focusable:false` constructor option is not a substitute.

`petAlwaysOnTop` (default on, Settings → Pet) applies immediately on Linux by calling `setAlwaysOnTop` on both windows.

## State machine

- Sessions are tracked per `session_id`; `resolveDisplayState()` picks the highest priority.
- Priority (`src/state-priority.js`): `error 8 > notification 7 > sweeping 6 > attention 5 > carrying, juggling 4 > executing 3.5 > working 3 > thinking 2 > idle 1 > sleeping 0`.
- One-shot states (`attention`, `error`, `sweeping`, `notification`, `carrying`) return automatically after the theme's `timings.autoReturn`.
- Minimum display times prevent flicker. The Clawd theme uses `error` 5 s, `sweeping` 5.5 s, `attention` 4 s, `working` and `thinking` 1 s.
- Working tiers: one busy session uses the theme's base working visual, two use the 2-session tier, three or more use building. For Clawd that is typing, headphones groove and building; Calico and Cloudling use typing, juggling and building.
- Sleep sequence (Clawd timings): 20 s without mouse movement → idle-look; 60 s → yawning → dozing; 10 min → collapsing → sleeping. Mouse movement plays waking and returns to idle.
- Do Not Disturb skips dozing (yawning → collapsing → sleeping) and drops incoming events.
- Hiding the pet (tray, context menu or shortcut) is not Do Not Disturb. It hides the pet and the Session HUD, pauses free roam and stops painting the page (`html.pet-hidden`), but events are still processed. `petHidden` is not persisted.
- Logical `idle` and the displayed resting visual are separate. Settings can choose a persistent idle visual per theme (`prefs.idleVisual`); every other state still takes precedence. Non-default idle visuals have no eye tracking.
- Idle activity and free roam are mutually exclusive. Settings commits both keys together through `setIdleBehavior`, and validators reject both being on.
- Logical state and displayed visual are separate too: every state, reaction and fallback becomes a display request with a `visualGeneration`. Only after the renderer settles it does main commit `{ displayState, file, hitBox, source, visualGeneration }`. The hit window, accessories and Discord presence read that committed visual.

### Displayed visual settlement

Main's displayed-visual projection owns the file, hit box and visual source. For every live request the renderer returns exactly one terminal result: `swapped`, `already-displayed`, `fallback` (a projectable substitute was shown) or `failed`. Generations replaced by a newer request are marked `superseded` by main.

- The renderer finishes its own object → img → accessory-settle fallback chain first; main's 9750 ms deadline only covers a missing acknowledgement.
- `restartAnimation: true` bypasses same-file reuse and replays the animation.
- One automatic re-request per logical visual; at most one reload per process lifetime when two requests in a row go unacknowledged. A visual timeout never loops reloads.
- Only `verified: true` results with a valid basename are committed; an unprojectable fallback ends as `failed` and keeps the previous committed visual.

## Theme system

- Built-in themes: `themes/clawd/`, `themes/calico/`, `themes/cloudling/`. `themes/template/` is the scaffold for `npm run create-theme`.
- User themes: `~/.config/omp-pet/themes/<id>/theme.json`. Dot-prefixed child directories are never themes.
- Required states: `idle`, `working`, `thinking`.
- `states.idle[0]` is the follow-idle with eye tracking. When `eyeTracking.enabled`, every file in `eyeTracking.states` must be SVG.
- `sleepSequence.mode: "full"` (default) needs `yawning`, `dozing`, `collapsing`, `waking`; `direct` goes straight to `sleeping`.
- `miniMode.supported: true` needs the eight base mini states; `mini-working`, `mini-peek-hold` and `mini-sleep-peek` are optional and degrade gracefully.
- Missing capabilities fall back through `VISUAL_FALLBACK_STATES`.
- Multi-file states and tiers pick one file at random, held stable by `createStableVisualPicker` in `state-visual-resolver.js` until the state or candidate list changes.
- Defaults live in the `DEFAULT_*` constants at the top of `theme-loader.js`. The loader is stateless; `src/theme-runtime.js` is the only active-theme owner.
- Dark appearance: `appearance.dark.assetsDir` must mirror `assets/` file for file. `prefs.themeAppearance[themeId]` is `light`, `dark` or absent (follow the system).
- Startup theme loading retries reads five times with backoff (100/250/500/1000 ms); other callers read once.
- Accessories are two slots, head (`petAccessory`) and mouth (`petMouthAccessory`), layered `pet media → head → mouth`. `holidayAccessoryEnabled` temporarily overrides the head slot around Halloween, Christmas and New Year.
- User SVGs are sanitized with an allowlist (no scripts, event attributes, external resources, `javascript:` or path traversal). Built-in SVGs are not sanitized at runtime and are audited by repository tests instead.
- `trustedRuntime.scriptedSvgFiles` is honored only for built-in themes. `rendering.objectChannelFiles` lists the Clawd SVGs that need `contentDocument` access; each must also appear in `discreteSampling`.
- Formats: SVG, GIF, APNG, WebP, PNG, JPG. `src/animation-cycle.js` probes animation length.

The author-facing format is in [guide-theme-creation.md](../guides/guide-theme-creation.md).

## Settings

Settings is its own `BrowserWindow` with five layers:

| Layer | Files | Role |
|---|---|---|
| Schema and persistence | `src/prefs.js` | schema, load / save / migrate / validate; a corrupt file is backed up to `.bak`; an unreadable file enters a safe mode that never overwrites it |
| Store | `src/settings-store.js` | `createStore()` returns `{ getSnapshot, subscribe, _commit }` with a closure-private `_commit` |
| Controller and actions | `src/settings-controller.js`, `src/settings-actions*.js` | the controller is the only writer; actions validate and run pre-commit gates |
| Effects | `src/settings-effect-router.js` | reacts to committed changes (tray, windows, HUD, renderer); a failed effect never rolls back a commit |
| UI | `src/settings-ui-core.js`, `src/settings-renderer.js`, `src/settings-tab-*.js`, `src/settings.html`, `src/preload-settings.js` | tabs call the controller only through preload and IPC |

- `hydrate()` is the only entry that skips pre-commit gates.
- When `prefs.load()` returns `locked && recovered` (the file bytes were never read), the controller rejects user mutations and event intake fails closed until the file is fixed and the app restarted.
- Tabs are built with `helpers.buildTabs(...)` and enumerated choices with `buildSegmentedRadio`; a test rejects hand-written tabs and segmented controls in Settings modules. Each tab's `patchInPlace` handles only its own keys and returns false for anything else.
- The About tab uses inline SVG because the Settings CSP is `default-src 'none'`.

## Mini mode

The character hides at the right screen edge with half the window off screen.

- Enter by dragging to the right edge (`SNAP_TOLERANCE = 30px`) or from the context menu (crab-walk to the edge, parabolic jump, peek in).
- `miniMode` maps `notification` / `attention` to `mini-alert` / `mini-happy`. With OMP only `attention` occurs.
- `miniTransitioning` blocks events and peeks during the entry animation. Every window-positioning path must check it first, or concurrent `setPosition()` calls can crash.
- Hover plays `mini-peek`; if the pointer stays past its auto-return, `mini-peek-hold` loops when the theme has it.
- `miniMode.peek` accepts `offsetRatio`, `delayMs` and `durationMs`; `miniMode.sleepPeek` inherits from it field by field.
- `miniMode`, `preMiniX` and `preMiniY` are persisted.

## Assets

- Each theme ships its own `assets/`.
- `assets/gif/` holds documentation previews; the runtime does not read them.
- Copy source artwork to `assets/source/` before editing it. `assets/source/cloudling-pointer-bridge/` holds kept source files; do not clean it up.
- Default SVG ids: `#eyes-js`, `#body-js`, `#shadow-js`, `#eyes-doze`.

## Runtime notes

- **Sound**: `app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required")` must run before any window exists. `playSound()` in `main.js` checks mute, Do Not Disturb and a 10 s cooldown. `attention` / `mini-happy` play `complete`.
- **Eye tracking**: `tick.js` polls the cursor every 50 ms, quantizes to a 0.5 px grid and skips unchanged positions. Returning from `idle-look` to the follow-idle needs `forceEyeResend`; any dedup must keep that bypass.
- **SVG through `<img>`**: the `?_t=` cache-bust query in `renderer.js` is required. Chromium reuses the document and animation timeline for an identical SVG URL, so a one-shot `forwards` animation would show its last frame on the second load. Dedup compares normalized file names, not the final URL.
- **Click reactions**: double-click pokes left or right, four clicks flail, dragging plays the drag reaction. Eye tracking detaches during reactions.
- `contextMenuOwner` must keep `parent: win`; together with `closable:false` that keeps quit from hanging.
- Render and hit windows need `backgroundThrottling: false`.
- Paths are built with `path.join(__dirname, ...)`.
- The single-instance lock is `app.requestSingleInstanceLock()`; a second launch shows the running pet.
- Multi-display clamping goes through `clampToScreen()` and `getNearestWorkArea()`.

## Linux AppImage runtime

An early-terminated AppImage FUSE wrapper can unmount the image while Electron still reads code pages during shutdown (SIGBUS). `scripts/prepare-appimage-launcher.js` wires `build/appimage-launcher.sh` into AppRun before its path exports. On FUSE launches only, the launcher copies the app to a fresh 0700 directory `$TMPDIR/clawd-appimage.XXXXXXXX/app` (default `/tmp`) and starts Electron from there; a failed copy never starts a partial app. FUSE is detected by the statfs magic `65735546` from `stat -f -c %t`, not by type name, because coreutils 9.6 reports `fuseblk` as `fuse`.

The supervisor runs from the system Bash with the script in memory. It keeps `APPIMAGE`, arguments, `HOME`, the working directory and `TMPDIR`, and only moves `APPDIR`. It deletes the copy after the app and its process group exit (waiting up to 5 s for children). It turns off inherited errexit and job control and never enables nounset, because an exported `SHELLOPTS` would pass nounset to the AppRun template. If a shell starts the AppImage in the background with job control off and an ignored SIGINT, the supervisor inherits it, so send SIGTERM instead.

`scripts/verify-appimage-apprun.js` checks the four path exports, the exact guard and its position, and the exact supervisor script in the built AppImage.
