const { app, BrowserWindow, Notification, screen, ipcMain, globalShortcut, nativeTheme, dialog, shell, nativeImage, powerSaveBlocker, powerMonitor } = require("electron");
// Pin the per-user data directory (prefs, logs, single-instance lock) to one
// name for both `npm start` and packaged builds, independent of productName.
app.setPath("userData", require("path").join(app.getPath("appData"), "omp-pet"));
// ── Linux/Wayland: relaunch under XWayland so the pet is draggable (issue #441) ──
// Native Wayland ignores client-side window positioning and blocks global cursor
// queries, so the pet spawns centered, can't be dragged, and has no tracking;
// --ozone-platform=x11 (XWayland) restores positioning + drag.
//
// This canNOT be done with app.commandLine.appendSwitch from here: Electron
// selects AND instantiates the Ozone backend in C++ PreEarlyInitialization
// (ui::SetOzonePlatformForLinuxIfNeeded + ui::OzonePlatform::PreEarlyInitialization),
// which runs BEFORE this main script (PostEarlyInitialization → JoinAppCode) —
// so any in-process switch change lands after the backend is already chosen.
// SetOzonePlatformForLinuxIfNeeded DOES honor a --ozone-platform already on argv,
// so the fix is to relaunch ourselves with that flag: this first process selects
// Wayland but exits before creating any window; the second boots into XWayland.
const { planXWaylandRelaunch } = require("./linux-ozone");
const _xwaylandRelaunch = planXWaylandRelaunch({
  platform: process.platform,
  env: process.env,
  argv: process.argv,
});
if (_xwaylandRelaunch) {
  console.log(
    "Clawd: Linux — relaunching under XWayland (--ozone-platform=x11) " +
    "(issue #441; override with CLAWD_OZONE_PLATFORM=wayland|x11|auto)"
  );
  process.env.CLAWD_OZONE_RELAUNCHED = "1";
  // Spawn the replacement ourselves instead of app.relaunch(). Electron's
  // relauncher helper is a process run from the binary INSIDE the AppImage's
  // FUSE mount, and it deliberately waits for this process to die before it
  // execs the replacement — but our exit also kills the AppImage runtime,
  // which IS the FUSE daemon, so the mount vanishes and the helper loses its
  // own code pages and dies without ever launching anything (reproduced on a
  // real Wayland compositor in CI: the helper outlives us by <1s, no child).
  // spawn() avoids both traps: the exec happens NOW, while this process and
  // its mount are still alive, and the exec target is the on-disk .AppImage
  // (process.env.APPIMAGE) or real binary — never the doomed mount path.
  // detached gives the child its own process group so it survives us;
  // stdio "inherit" keeps its logs on the user's terminal (the relauncher
  // piped them to /dev/null, which made field reports needlessly blind).
  let _xwaylandChild = null;
  try {
    _xwaylandChild = require("child_process").spawn(
      process.env.APPIMAGE || process.execPath,
      _xwaylandRelaunch.args,
      { detached: true, stdio: "inherit" },
    );
  } catch {
    _xwaylandChild = null;
  }
  if (_xwaylandChild && typeof _xwaylandChild.on === "function") {
    _xwaylandChild.on("error", (err) => {
      console.error("Clawd: XWayland relaunch spawn error:", err && err.message ? err.message : err);
    });
  }
  if (_xwaylandChild && typeof _xwaylandChild.pid === "number") {
    _xwaylandChild.unref();
    app.exit(0);
    return; // throwaway first process — stop before loading the rest of main.js
  }
  // No pid ⇒ the spawn failed before creating a child. Do NOT exit into
  // nothing — clear the sentinel and fall through to a normal (native Wayland)
  // startup so the app still runs, just without drag (issue #441). The error
  // listener above also prevents async exec failures (ENOENT/EACCES) from
  // crashing this fallback path.
  delete process.env.CLAWD_OZONE_RELAUNCHED;
  console.error("Clawd: XWayland relaunch failed; continuing under native Wayland (issue #441).");
}

const { clampTextScale, resolveTextScaleForKey } = require("./text-scale");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const createSettingsWindowRuntime = require("./settings-window");
const createRoamFenceLoader = require("./roam-fence");
const createRoamFenceSettings = require("./roam-fence-settings");
const createRoamFencePicker = require("./roam-fence-picker");
const {
  createSettingsSizePreviewSession,
} = require("./settings-size-preview-session");
const { registerSettingsIpc } = require("./settings-ipc");
const createSettingsEffectRouter = require("./settings-effect-router");
const { createRecapRuntime } = require("./recap-runtime");
const {
  getPetTintIdForTheme,
  resolvePetTintPayload,
  buildPetAccessoryPayload,
  getPetMouthAccessoryIdForTheme,
  buildPetMouthAccessoryPayload,
} = require("./pet-customization-catalog");
const {
  finalizePetAccessorySlotsDelivery,
  getPetAccessorySlotsSnapshot,
  preparePetAccessorySlotsDelivery,
} = require("./pet-accessory-state");
const {
  getEffectivePetAccessoryIdForTheme,
  createHolidayAccessoryRuntime,
} = require("./holiday-accessory");
const { registerSessionIpc } = require("./session-ipc");
const { createSessionFolderOpener } = require("./session-open-folder");
const { isTrustedMainFrameEvent, registerPetInteractionIpc } = require("./pet-interaction-ipc");
const { createSystemWakeRecovery } = require("./system-wake-recovery");
const { formatLocalTimestamp } = require("./log-timestamp");
const { openTerminalAt } = require("./open-terminal");
const discordPresenceSettings = require("./discord-presence-settings");
const { createDiscordPresenceBridge } = require("./discord-presence-rpc");
const createSettingsAnimationOverridesMain = require("./settings-animation-overrides-main");
const { registerSettingsAnimationOverridesIpc } = createSettingsAnimationOverridesMain;
const createShortcutRuntime = require("./shortcut-runtime");
const {
  findNearestWorkArea,
  buildDisplaySnapshot,
  SYNTHETIC_WORK_AREA,
} = require("./work-area");
const {
  getLaunchPixelSize,
  getLaunchSizingWorkArea,
  getProportionalPixelSize,
  resolveSizeSliderContext,
} = require("./size-utils");
const { formatSizeKey } = require("./settings-size-slider");
const { keepOutOfTaskbar } = require("./taskbar");
const { loadTrayNormalIcon, loadTrayFlashIcon } = require("./tray-flash-icon");
const createThemeFadeSequencer = require("./theme-fade-sequencer");
const createThemeRuntime = require("./theme-runtime");
const createAgentRuntimeMain = require("./agent-runtime-main");
const createPetWindowRuntime = require("./pet-window-runtime");
const { createRendererConfigChannel } = require("./renderer-config-channel");
const { collectRequiredAssetFiles } = require("./theme-schema");
const { describeGeometrySync } = require("./pet-accessory-state");
const { createDisplayedVisualProjection } = require("./displayed-visual-projection");
const { getRightSideMirrorFiles, isVisualMirrored, resolveMirroredFile } = require("./mirrored-files");
const {
  getFocusableLocalHudSessionIds: selectFocusableLocalHudSessionIds,
  getSessionFocusTarget,
} = require("./session-focus");
const { isSessionInProgress } = require("./state-session-snapshot");
const { getAllAgents } = require("../agents/registry");
const { getAgentIconUrl } = require("./state-agent-icons");
// ── Autoplay policy: allow sound playback without user gesture ──
// MUST be set before any BrowserWindow is created (before app.whenReady)
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const LINUX_WINDOW_TYPE = "toolbar";
const THEME_SWITCH_FADE_OUT_MS = 140;
const THEME_SWITCH_FADE_IN_MS = 180;
const THEME_SWITCH_FADE_FALLBACK_MS = 4000;

// Registered before any window exists so the sandboxed preloads can read the
// config synchronously on their first load instead of reading it from argv.
const rendererConfigChannel = createRendererConfigChannel({ ipcMain });

// ── Linux/X11: keep the output-only pet render window out of WM focus ──
// Best-effort; a no-op off the X11 backend or without koffi/libxcb. Chromium
// writes its resolved Ozone backend back onto the command line, so the switch
// reads "x11" under the XWayland relaunch and on an Xorg session alike, and
// "wayland" on native Wayland, where there is no X11 window to hint.
const { createLinuxX11InputHint } = require("./linux-x11-input-hint");
const _linuxX11InputHint = createLinuxX11InputHint({
  isLinuxX11: app.commandLine.getSwitchValue("ozone-platform") === "x11",
  displayName: app.commandLine.getSwitchValue("display"),
  onError: (err) => console.warn("omp-pet: linux-x11-input-hint failed:", err && err.message),
});

// ── Window size presets ──
const SIZES = {
  S: { width: 200, height: 200 },
  M: { width: 280, height: 280 },
  L: { width: 360, height: 360 },
};

// ── Settings (prefs.js + settings-controller.js) ──
//
// `prefs.js` handles disk I/O + schema validation + migrations.
// `settings-controller.js` is the single writer of the in-memory snapshot.
// Module-level `lang`/`showTray`/etc. below are mirror caches kept in sync via
// a subscriber wired after menu.js loads. The ctx setters route writes through
// `_settingsController.applyUpdate()`, which auto-persists.
const prefsModule = require("./prefs");
const { createSettingsController } = require("./settings-controller");
const { createTranslator, i18n, SUPPORTED_LANGS } = require("./i18n");
const loginItemHelpers = require("./login-item");
const PREFS_PATH = path.join(app.getPath("userData"), "omp-pet-prefs.json");
const _initialPrefsLoad = prefsModule.load(PREFS_PATH);
// Recovery from readable invalid contents is writable only after the original
// bytes are safely kept in .bak. That fallback is not user intent for this
// process, and a backup failure locks persistence as well. Runtime gates stay
// closed until restart in either case.
const _initialPrefsRecovered = _initialPrefsLoad.recovered === true;
const _initialPrefsRecoveryBackupFailed = _initialPrefsLoad.recoveryBackupFailed === true;
const _recapStartupAuthorityLost = (
  _initialPrefsLoad.locked === true
  || _initialPrefsRecovered
  || _initialPrefsRecoveryBackupFailed
);
// "Open at login" writer used by both the openAtLogin effect and the startup
// hydration helper. Throws on failure so the action layer can surface the
// error to the UI.
function _writeSystemOpenAtLogin(enabled) {
  const launchScript = path.join(__dirname, "..", "launch.js");
  const execCmd = app.isPackaged
    ? `"${process.env.APPIMAGE || app.getPath("exe")}"`
    : `node "${launchScript}"`;
  loginItemHelpers.setOpenAtLogin(enabled, { execCmd });
}
function _readSystemOpenAtLogin() {
  return loginItemHelpers.getOpenAtLogin();
}

function _deferredResizePet(sizeKey) {
  // Bound to _menu.resizeWindow after menu module is created below. Settings
  // panel's size slider commands route through here so they get the same
  // window resize + hitWin sync + bubble reposition as the context menu.
  if (_menu && typeof _menu.resizeWindow === "function") {
    _menu.resizeWindow(sizeKey);
  }
}

let _restartScheduled = false;
function _restartClawdNow() {
  if (_restartScheduled) return;
  _restartScheduled = true;
  // Triggered by Doctor's restart-clawd repair and by the restartClawd command
  // behind the #1183 GPU switch. relaunch() queues a fresh process; quit()
  // then follows the normal shutdown path so before-quit
  // still flushes prefs and cleans up server/monitor resources.
  // setImmediate so the IPC reply for repairDoctorIssue lands in the
  // renderer before the main process starts closing windows.
  setImmediate(() => {
    isQuitting = true;
    app.relaunch();
    app.quit();
  });
}

let shortcutRuntime = null;
let themeRuntime = null;
let systemThemeAppearanceHandler = null;
let agentRuntime = null;
let systemWakeRecovery = null;
let discordPresenceBridge = null;
// Renderer-visible state animations can diverge from state.currentSvg (idle
// rotation and reactions). Presence is fed only after the renderer confirms
// what is actually on screen.
let lastDiscordPresenceVisual = null;
let displayedVisualProjection = null;
let lastAppliedVisualGeneration = 0;
const shortcutHandlers = {
  togglePet: () => togglePetVisibility(),
};
const _settingsController = createSettingsController({
  prefsPath: PREFS_PATH,
  loadResult: _initialPrefsLoad,
  injectedDeps: {
    resolveTextScaleDisplayKey: () => getSettingsDisplayKey(),
    setOpenAtLogin: _writeSystemOpenAtLogin,
    syncIntegrationForAgent: (id, options) =>
      agentRuntime ? agentRuntime.syncIntegrationForAgent(id, options) : false,
    repairIntegrationForAgent: (id, options) =>
      agentRuntime ? agentRuntime.repairIntegrationForAgent(id, options) : false,
    uninstallIntegrationForAgent: (id) => agentRuntime ? agentRuntime.uninstallIntegrationForAgent(id) : false,
    repairLocalServer: () => _server && typeof _server.repairRuntimeStatus === "function"
      ? _server.repairRuntimeStatus()
      : false,
    restartClawd: _restartClawdNow,
    clearSessionsByAgent: (id) => agentRuntime ? agentRuntime.clearSessionsByAgent(id) : 0,
    clearRecentHookEvents: (id) => _server.clearRecentHookEvents(id),
    resizePet: _deferredResizePet,
    rebaseSizeToRealizedPixels: () => rebaseSizeToRealizedPixels(),
    getActiveSessionAliasKeys: () =>
      _state && typeof _state.getActiveSessionAliasKeys === "function"
        ? _state.getActiveSessionAliasKeys()
        : new Set(),
    // Theme runtime is wired after theme-loader.init(); keep these closures
    // lazy so settings actions never capture a pre-init runtime reference.
    activateTheme: (id, variantId, overrideMap) => themeRuntime.activateTheme(id, variantId, overrideMap),
    refreshActiveThemeHitboxOverrides: (id, overrideMap) =>
      themeRuntime.refreshActiveThemeHitboxOverrides(id, overrideMap),
    getThemeInfo: (id) => themeRuntime.getThemeInfo(id),
    removeThemeDir: (id) => themeRuntime.removeThemeDir(id),
    getActiveTheme: () => themeRuntime.getActiveTheme(),
    waitForThemeReloadSettled: (opts) => themeRuntime.waitForThemeReloadSettled(opts),
    globalShortcut,
    shortcutHandlers,
    // The controller is created before shortcutRuntime because each side needs
    // the other. These callbacks may run before the runtime is assigned.
    getShortcutFailure: (actionId) => shortcutRuntime ? shortcutRuntime.getFailure(actionId) : null,
    clearShortcutFailure: (actionId) => {
      if (shortcutRuntime) shortcutRuntime.clearFailure(actionId);
    },
  },
});

// Mirror of `_settingsController.get("lang")` so existing sync read sites in
// menu.js / state.js / etc. don't have to round-trip through the controller.
// Updated by the settings-effect-router subscriber below; never
// assign directly.
let lang = _settingsController.get("lang");
const translate = createTranslator(() => lang);

function getDashboardI18nPayload() {
  const dict = i18n[lang] || i18n.en;
  return { lang, translations: { ...dict } };
}

// First-run import of system-backed settings into prefs. The actual truth for
// `openAtLogin` lives in OS login items / autostart files; if we just trusted
// the schema default (false), an upgrading user with login-startup already
// enabled would silently lose it the first time prefs is saved. So on first
// boot after this field exists in the schema, copy the system value INTO prefs
// and mark it hydrated. After that, prefs is the source of truth and the
// openAtLogin pre-commit gate handles future writes back to the system.
//
// MUST run before createWindow() so the first menu render reads the
// hydrated value.
function hydrateSystemBackedSettings() {
  if (_settingsController.get("openAtLoginHydrated")) return;
  let systemValue = false;
  try {
    systemValue = !!_readSystemOpenAtLogin();
  } catch (err) {
    console.warn("Clawd: failed to read system openAtLogin during hydration:", err && err.message);
  }
  const result = _settingsController.hydrate({
    openAtLogin: systemValue,
    openAtLoginHydrated: true,
  });
  if (result && result.status === "error") {
    console.warn("Clawd: openAtLogin hydration failed:", result.message);
  }
}

// First-run only: seed the UI language from the device locale. A brand-new
// install has no prefs file, so `lang` would otherwise sit at the schema default
// ("en") regardless of the user's OS language. Gated on _initialPrefsLoad.fresh
// (missing-file load) so a RETURNING user's chosen language is never touched.
// MUST run inside app.whenReady() — app.getLocale() is only stable after ready —
// and before createWindow() so the first menu/tray render is already localized.
function hydrateFreshInstallLanguage() {
  if (!_initialPrefsLoad || !_initialPrefsLoad.fresh) return;
  let detected = "en";
  try {
    detected = prefsModule.mapLocaleToLang(app.getLocale());
  } catch (err) {
    console.warn("Clawd: failed to detect device locale for language:", err && err.message);
    return;
  }
  if (detected && detected !== _settingsController.get("lang")) {
    _settingsController.applyUpdate("lang", detected);
  }
}

// Capture window/mini runtime state into the controller and write to disk.
// Replaces the legacy `savePrefs()` callsites — they used to read fresh
// `win.getBounds()` and `_mini.*` at save time, so we mirror that here.
function flushRuntimeStateToPrefs() {
  if (!win || win.isDestroyed()) return;
  const bounds = getPetWindowBounds();
  const theme = getActiveTheme();
  // #408: persist the frozen keep-size, not the live window bounds — otherwise a
  // bounds value inflated by a DPI flux gets saved and restored on relaunch.
  const isFrozenActive = keepSizeAcrossDisplaysCached && isProportionalMode();
  const persistPx = isFrozenActive
    ? getEffectiveCurrentPixelSize()
    : { width: bounds.width, height: bounds.height };
  // #408 round-2: also persist the frozen-origin work area (kept independent
  // of positionDisplay; see the schema comment on savedPixelWorkArea). Calling
  // getEffectiveCurrentPixelSize above already lazy-seeded the origin if it
  // wasn't seeded yet.
  const persistOriginWa = isFrozenActive
    ? (keepSizeFrozenOriginWa
        ? { width: keepSizeFrozenOriginWa.width, height: keepSizeFrozenOriginWa.height }
        : null)
    : null;
  _settingsController.applyBulk({
    x: bounds.x,
    y: bounds.y,
    positionSaved: true,
    positionThemeId: theme ? theme._id : "",
    positionVariantId: theme ? theme._variantId : "",
    positionDisplay: captureCurrentDisplaySnapshot(bounds),
    savedPixelWidth: persistPx.width,
    savedPixelHeight: persistPx.height,
    savedPixelWorkArea: persistOriginWa,
    size: currentSize,
    miniMode: _mini.getMiniMode(),
    miniEdge: _mini.getMiniEdge(),
    preMiniX: _mini.getPreMiniX(),
    preMiniY: _mini.getPreMiniY(),
  });
}

// Snapshot the display the pet is currently on so the next launch can tell
// whether the same physical monitor is still attached (see startup regularize
// logic below). Returns null if screen.* is unavailable — any truthy snapshot
// here unlocks the "trust saved position" path, so we fail closed.
function captureCurrentDisplaySnapshot(bounds) {
  try {
    const display = screen.getDisplayNearestPoint({
      x: Math.round(bounds.x + bounds.width / 2),
      y: Math.round(bounds.y + bounds.height / 2),
    });
    return buildDisplaySnapshot(display);
  } catch {
    return null;
  }
}

function safeConsoleError(...args) {
  try {
    console.error(...args);
  } catch (err) {
    try {
      const line = `${new Date().toISOString()} ${args.map((x) => String(x)).join(" ")}\n`;
      fs.appendFileSync(path.join(app.getPath("userData"), "omp-pet-main.log"), line);
    } catch {}
  }
}

// ── Theme loader ──
const themeLoader = require("./theme-loader");
themeLoader.init(__dirname, app.getPath("userData"));
themeRuntime = createThemeRuntime({
  themeLoader,
  settingsController: _settingsController,
  fs,
  path,
  getRenderWindow: () => win,
  getHitWindow: () => hitWin,
  getStateRuntime: () => _state,
  getTickRuntime: () => _tick,
  getMiniRuntime: () => _mini,
  getAnimationOverridesRuntime: () => animationOverridesMain,
  getFadeSequencer: () => themeFadeSequencer,
  getSystemPrefersDark: () => nativeTheme.shouldUseDarkColors === true,
  getPetWindowBounds,
  applyPetWindowBounds,
  computeFinalDragBounds,
  clampToScreenVisual,
  flushRuntimeStateToPrefs,
  syncHitStateAfterLoad,
  syncRendererStateAfterLoad,
  syncHitWin,
  syncSessionHudVisibility: () => syncSessionHudVisibility(),
  startMainTick: () => startMainTick(),
  invalidateDisplayedVisual: (detail) => resetDisplayedVisualProjection(detail),
  refreshDisplayedVisualHitBoxes: () => refreshDisplayedVisualHitBoxes(),
  bumpAnimationOverridePreviewPosterGeneration,
  rebuildAllMenus: () => rebuildAllMenus(),
});
themeLoader.bindActiveThemeRuntime(themeRuntime);

function getActiveTheme() {
  return themeRuntime ? themeRuntime.getActiveTheme() : null;
}

let animationOverridesMain = null;
function bumpAnimationOverridePreviewPosterGeneration() {
  return animationOverridesMain && animationOverridesMain.bumpPreviewPosterGeneration();
}
function maybeDestroyIdleAnimationPreviewPosterWindow() {
  if (animationOverridesMain) animationOverridesMain.maybeDestroyIdlePreviewPosterWindow();
}

let roamFencePickerRuntime = null;
const settingsWindowRuntime = createSettingsWindowRuntime({
  app,
  BrowserWindow,
  nativeTheme,
  path,
  discordDefaultAppIdPresent: !!discordPresenceSettings.DEFAULT_CLAWD_DISCORD_APP_ID,
  getPetWindowBounds: () => getPetWindowBounds(),
  getNearestWorkArea: (cx, cy) => getNearestWorkArea(cx, cy),
  getTextScale: (bounds) => effectiveTextScaleForKey(
    getDisplayKeyForBounds(bounds) || getSettingsDisplayKey()
  ),
  getSavedBounds: () => _settingsController.get("settingsWindowBounds"),
  onSaveBounds: (bounds) => _settingsController.applyUpdate("settingsWindowBounds", bounds),
  getTitle: () => translate("settingsWindowTitle"),
  onBeforeCreate: () => bumpAnimationOverridePreviewPosterGeneration(),
  // A replaced or crashed Settings page cannot send its preview-ending IPC.
  onRendererReset: () => { void settingsSizePreviewSession.cleanup(); },
  onBeforeClosed: () => {
    if (roamFencePickerRuntime) roamFencePickerRuntime.cancel();
    bumpAnimationOverridePreviewPosterGeneration();
    if (shortcutRuntime) shortcutRuntime.stopRecording();
    void settingsSizePreviewSession.cleanup();
    // The renderer-side rollback (slider blur / control dispose) rides IPC
    // and can't be trusted while the window is being torn down — without
    // this, closing mid-drag leaves the transient preview scale applied to
    // the display until the next commit or restart.
    endTextScalePreview();
  },
  onAfterClosed: () => {
    // An animation preview started from Settings outlives the window otherwise:
    // a state preview holds for the whole clip, up to a minute.
    if (animationOverridesMain) animationOverridesMain.cancelAnimationPreview();
    maybeDestroyIdleAnimationPreviewPosterWindow();
  },
});

function getSettingsWindow() {
  return settingsWindowRuntime.getWindow();
}

// The file loader is shared by roam and Settings. A selection saved from the
// visual picker therefore updates the exact same last-known-good cache that a
// later walk reads; external tools keep using the same JSON contract.
const roamFenceLoader = createRoamFenceLoader();
const roamFenceSettings = createRoamFenceSettings({ loader: roamFenceLoader });
roamFencePickerRuntime = createRoamFencePicker({
  BrowserWindow,
  ipcMain,
  nativeTheme,
  screen,
  path,
  getSettingsWindow,
  getPetWindowBounds: () => getPetWindowBounds(),
  getEffectivePetSize: (workArea) => getEffectiveCurrentPixelSize(workArea),
});

shortcutRuntime = createShortcutRuntime({
  ipcMain,
  globalShortcut,
  settingsController: _settingsController,
  getSettingsWindow,
  shortcutHandlers,
});

// Lenient load so a missing/corrupt user-selected theme can't brick boot.
// If lenient fell back to "clawd" OR the variant fell back to "default",
// hydrate prefs to match so the store stays truth.
//
// Startup runs BEFORE the window is ready, so we call the runtime's initial
// load path, not activateTheme (which requires ready windows) and not the
// setThemeSelection command (which goes through activateTheme). The runtime
// switch path via UI goes through setThemeSelection post-window-ready.
const _requestedThemeId = _settingsController.get("theme") || "clawd";
const _initialVariantMap = _settingsController.get("themeVariant") || {};
const _requestedVariantId = _initialVariantMap[_requestedThemeId] || "default";
const _initialThemeOverrides = _settingsController.get("themeOverrides") || {};
const _requestedThemeOverrides = _initialThemeOverrides[_requestedThemeId] || null;
// Theme files can be briefly unreadable on the first launch after an update
// (#1295, exact trigger unconfirmed): give the startup read a small bounded
// retry before the fatal "Default theme 'clawd' not found".
const THEME_STARTUP_READ_ATTEMPTS = 5;
const THEME_STARTUP_RETRY_DELAYS_MS = [100, 250, 500, 1000];
const _loadedStartupTheme = themeRuntime.loadInitialTheme(_requestedThemeId, {
  variant: _requestedVariantId,
  overrides: _requestedThemeOverrides,
  readAttempts: THEME_STARTUP_READ_ATTEMPTS,
  retryDelaysMs: THEME_STARTUP_RETRY_DELAYS_MS,
});
if (_loadedStartupTheme._id !== _requestedThemeId || _loadedStartupTheme._variantId !== _requestedVariantId) {
  const nextVariantMap = { ...(_settingsController.get("themeVariant") || {}) };
  // Self-heal: store the resolved ids so next boot doesn't fall back again.
  nextVariantMap[_loadedStartupTheme._id] = _loadedStartupTheme._variantId;
  if (_loadedStartupTheme._id !== _requestedThemeId) {
    delete nextVariantMap[_requestedThemeId];
  }
  const result = _settingsController.hydrate({
    theme: _loadedStartupTheme._id,
    themeVariant: nextVariantMap,
  });
  if (result && result.status === "error") {
    console.warn("Clawd: theme hydrate after fallback failed:", result.message);
  }
}

// ── Pet window geometry / bounds runtime ──
// Geometry's startup/theme-swap fallback only. It must stay a pure read:
// Slot candidates commit to canonical state, so using one here would let a
// hit-window sync install a payload resolved from its own
// wall clock — the midnight/holiday race the canonical payload exists to end.
function getEffectivePetAccessoryPayloads(activeTheme = getActiveTheme()) {
  const snapshot = _settingsController.getSnapshot();
  const headId = getEffectivePetAccessoryIdForTheme({
    petAccessory: snapshot.petAccessory,
    holidayAccessoryEnabled: snapshot.holidayAccessoryEnabled,
    themeId: activeTheme && activeTheme._id,
  });
  const mouthId = getPetMouthAccessoryIdForTheme(
    snapshot.petMouthAccessory,
    activeTheme && activeTheme._id
  );
  return {
    head: buildPetAccessoryPayload(headId, activeTheme),
    mouth: buildPetMouthAccessoryPayload(mouthId, activeTheme),
  };
}

function getEffectivePetAccessoryIds() {
  const activeTheme = getActiveTheme();
  const canonical = getPetAccessorySlotsSnapshot(activeTheme);
  const payloads = canonical ? canonical.payloads : getEffectivePetAccessoryPayloads();
  return Object.freeze({
    head: payloads.head.id,
    mouth: payloads.mouth.id,
  });
}

function prepareCurrentAccessorySlotsDelivery(activeTheme = getActiveTheme()) {
  return preparePetAccessorySlotsDelivery(
    getEffectivePetAccessoryPayloads(activeTheme),
    activeTheme
  );
}

function deliverAccessorySlotsSnapshot(activeTheme = getActiveTheme()) {
  const delivery = prepareCurrentAccessorySlotsDelivery(activeTheme);
  const candidate = delivery.snapshot;
  const delivered = sendToRenderer("pet-accessory-slots-change", candidate);
  if (!finalizePetAccessorySlotsDelivery(delivery, delivered)) return false;
  const geometry = describeGeometrySync(syncHitWin());
  if (geometry.applied) {
    try { repositionAnchoredFloatingSurfaces(); } catch {}
  }
  return true;
}

// Composed accessory facing as the renderer actually applied it (mini-left
// stage XOR asset-direction stage). Defaults to unmirrored until the first
// report; that matches the pre-accessory-hitbox behaviour.
let _accessoryMirrored = false;
function setAccessoryMirrored(mirrored) {
  const next = !!mirrored;
  if (_accessoryMirrored === next) return;
  _accessoryMirrored = next;
  syncHitWin();
}

const petWindowRuntime = createPetWindowRuntime({
  // Every stranded-lock release entry (bring to primary display, send to
  // display, manual hide) funnels through releaseStrandedDragLock and hence
  // through this hook: one full cross-process cleanup instead of each caller
  // reimplementing it.
  onStrandedDragLockReleased: () => {
    idlePaused = false;
    mouseOverPet = false;
    // An alive renderer with a phantom capture (its isDragging still true
    // because the closing event was swallowed) drops it through the normal
    // stop path, so gesture state, drag reaction and the input gate unwind.
    sendToHitWin("force-drag-release");
  },
  screen,
  linuxWindowType: LINUX_WINDOW_TYPE,
  getRenderWindow: () => win,
  getHitWindow: () => hitWin,
  getActiveTheme: () => getActiveTheme(),
  getDisplayedVisual: () => getDisplayedVisualTuple(),
  getCurrentState: () => getDisplayedVisualTuple().displayState,
  getCurrentSvg: () => getDisplayedVisualTuple().file,
  getCurrentHitBox: () => getDisplayedVisualTuple().hitBox,
  getCurrentAccessoryPayloads: getEffectivePetAccessoryPayloads,
  getAccessoryMirrored: () => _accessoryMirrored,
  getMiniMode: () => _mini.getMiniMode(),
  getMiniTransitioning: () => _mini.getMiniTransitioning(),
  getMiniContainedSeam: () => _mini.getContainedSeam(),
  getMiniPeekOffset: () => _mini.getMiniPeekOffset(),
  getCurrentPixelSize: () => getCurrentPixelSize(),
  getEffectiveCurrentPixelSize: (workArea) => getEffectiveCurrentPixelSize(workArea),
  getAllowEdgePinning: () => allowEdgePinningCached,
  // #1275: the creation-time window level.
  getAlwaysOnTop: () => petAlwaysOnTopCached,
  getPrimaryWorkAreaSafe: () => getPrimaryWorkAreaSafe(),
  getNearestWorkArea,
  sendToRenderer,
  keepOutOfTaskbar,
  repositionSessionHud: () => repositionSessionHud(),
  repositionAnchoredSurfaces: () => repositionAnchoredFloatingSurfaces(),
  syncSessionHudVisibilityAndBubbles: () => syncSessionHudVisibility(),
  buildTrayMenu: () => buildTrayMenu(),
  buildContextMenu: () => buildContextMenu(),
  isMiniAnimating: () => _mini.getIsAnimating(),
  // Issue #690 plan §4.3.10's fourth reconcile protection period (lazy-bound
  // like isMiniAnimating above — _roam is constructed after petWindowRuntime,
  // but this closure isn't invoked until well after module load finishes).
  isRoamAnimating: () => _roam.isRoamAnimating(),
  flushRuntimeStateToPrefs: () => flushRuntimeStateToPrefs(),
  handleMiniDisplayChange: () => _mini.handleDisplayChange(),
  // Issue #690 plan §4.5 point 4.5-4: handleDisplayMetricsChanged() used to
  // silently swallow topology changes that land mid-mini-transition (the
  // `if (getMiniTransitioning()) return;` guard). Instead it now hands off to
  // mini.js so the change isn't lost — mini marks pendingTopologyMaterialize
  // and does exactly one final re-materialize against fresh topology at
  // whichever of its own three transition-end points comes next.
  notifyMiniTopologyChangedDuringTransition: () => _mini.notifyTopologyChangedDuringTransition(),
  exitMiniMode: () => exitMiniMode(),
});

function getObjRect(bounds) {
  return petWindowRuntime.getObjRect(bounds);
}

function getAssetPointerPayload(bounds, point) {
  return petWindowRuntime.getAssetPointerPayload(bounds, point);
}

let win;
let hitWin;  // input window — small opaque rect over hitbox, receives all pointer events

// Tray icon flash state
let trayFlashTimer = null;
let trayFlashStopTimer = null;
let trayFlashNormalIcon = null;
let trayFlashHighlightIcon = null;
let tray = null;
let contextMenuOwner = null;
// Mirror of _settingsController.get("size") — initialized from disk, kept in
// sync by the settings subscriber. The legacy S/M/L → P:N migration runs
// inside createWindow() because it needs the screen API.
let currentSize = _settingsController.get("size");

// ── Proportional size mode ──
// currentSize = "P:<ratio>" means the pet occupies <ratio>% of the display long edge,
// so rotating the same monitor to portrait does not suddenly shrink the pet.
const PROPORTIONAL_RATIOS = [8, 10, 12, 15];

function isProportionalMode(size) {
  return typeof (size || currentSize) === "string" && (size || currentSize).startsWith("P:");
}

function getProportionalRatio(size) {
  return parseFloat((size || currentSize).slice(2)) || 10;
}

function getPixelSizeFor(sizeKey, overrideWa) {
  if (!isProportionalMode(sizeKey)) return SIZES[sizeKey] || SIZES.S;
  const ratio = getProportionalRatio(sizeKey);
  let wa = overrideWa;
  if (!wa && win && !win.isDestroyed()) {
    const { x, y, width, height } = getPetWindowBounds();
    wa = getNearestWorkArea(x + width / 2, y + height / 2);
  }
  if (!wa) wa = getPrimaryWorkAreaSafe() || SYNTHETIC_WORK_AREA;
  return getProportionalPixelSize(ratio, wa);
}

function getSizeSliderContext() {
  let wa = null;
  if (win && !win.isDestroyed()) {
    const { x, y, width, height } = getPetWindowBounds();
    wa = getNearestWorkArea(x + width / 2, y + height / 2);
  }
  if (!wa) wa = getPrimaryWorkAreaSafe() || SYNTHETIC_WORK_AREA;
  return resolveSizeSliderContext(
    currentSize, getEffectiveCurrentPixelSize(), wa,
    keepSizeAcrossDisplaysCached && isProportionalMode()
  );
}

function rebaseSizeToRealizedPixels() {
  const context = getSizeSliderContext();
  if (!context || context.synced) return;
  _deferredResizePet(formatSizeKey(context.ui));
}

function getCurrentPixelSize(overrideWa) {
  if (!isProportionalMode()) return SIZES[currentSize] || SIZES.S;
  return getPixelSizeFor(currentSize, overrideWa);
}

// #408: while keepSizeAcrossDisplays is ON, the frozen pixel size is held in
// memory (keepSizeFrozenPx) rather than re-read from win.getBounds() on every
// access. Re-reading the live bounds let a transiently-wrong value during a
// Windows sleep/wake DPI flux get laundered back through setBounds(), ratcheting
// the pet larger each cycle ("the longer it sleeps, the bigger it gets"). Seeded
// at launch and lazily on first use; cleared (→ re-seeded from the proportional
// size) whenever the size or the keepSize toggle changes.
let keepSizeFrozenPx = null;
// #408 round-2: track the *origin* display's work area alongside the frozen
// pixel size so a legitimate cross-display keep-size (set on a large display,
// later moved to a smaller one via "Send to display") is not mis-clamped on
// the next launch — positionDisplay tracks the LAST-FLUSH display, which after
// a send diverges from the actual frozen origin. Lifecycle mirrors
// keepSizeFrozenPx (lazy-seeded together, reset together, persisted together).
let keepSizeFrozenOriginWa = null;

function resetKeepSizeFrozen() {
  keepSizeFrozenPx = null;
  keepSizeFrozenOriginWa = null;
}

function snapshotKeepSizeOriginWa(wa) {
  if (!wa || typeof wa !== "object") return null;
  const w = Number(wa.width);
  const h = Number(wa.height);
  if (!Number.isFinite(w) || w <= 0) return null;
  if (!Number.isFinite(h) || h <= 0) return null;
  return { width: w, height: h };
}

function getEffectiveCurrentPixelSize(overrideWa) {
  if (keepSizeAcrossDisplaysCached && isProportionalMode()) {
    // #408: seed from the CURRENT display's proportional size, never from an
    // overrideWa — callers like sendToDisplay/bringPetToPrimaryDisplay pass a
    // *target* display's work area, and seeding from that would freeze the
    // pet at the target's proportional size instead of its realized size.
    if (!keepSizeFrozenPx) {
      // Mirror getPixelSizeFor's wa resolution so the captured origin matches
      // the display we actually sized from.
      let seedWa = null;
      if (win && !win.isDestroyed()) {
        const { x, y, width, height } = getPetWindowBounds();
        seedWa = getNearestWorkArea(x + width / 2, y + height / 2);
      }
      if (!seedWa) seedWa = getPrimaryWorkAreaSafe() || SYNTHETIC_WORK_AREA;
      keepSizeFrozenPx = getProportionalPixelSize(getProportionalRatio(), seedWa);
      keepSizeFrozenOriginWa = snapshotKeepSizeOriginWa(seedWa);
    }
    return { width: keepSizeFrozenPx.width, height: keepSizeFrozenPx.height };
  }
  return getCurrentPixelSize(overrideWa);
}
let contextMenu;
let doNotDisturb = false;
let isQuitting = false;
let quitCleanupStarted = false;
// Mirror caches: kept in sync with the settings store via settings-effect-router
// further down. Read freely; never assign
// directly (writes go through ctx setters → controller.applyUpdate).
let openAtLogin = _settingsController.get("openAtLogin");
let sessionHudEnabled = _settingsController.get("sessionHudEnabled");
let sessionHudShowStateLabels = _settingsController.get("sessionHudShowStateLabels");
let sessionHudShowElapsed = _settingsController.get("sessionHudShowElapsed");
let sessionHudShowContextUsage = _settingsController.get("sessionHudShowContextUsage");
let sessionHudCleanupDetached = _settingsController.get("sessionHudCleanupDetached");
let sessionHudPinned = _settingsController.get("sessionHudPinned");
let sessionStaleMs = _settingsController.get("sessionStaleMs");
let workingStaleMs = _settingsController.get("workingStaleMs");
let detachedIdleStaleMs = _settingsController.get("detachedIdleStaleMs");
let soundMuted = _settingsController.get("soundMuted");
let soundVolume = _settingsController.get("soundVolume");
let lowPowerIdleMode = _settingsController.get("lowPowerIdleMode");
let keepAwakeWhileWorking = _settingsController.get("keepAwakeWhileWorking");
let petTint = _settingsController.get("petTint");
let allowEdgePinningCached = _settingsController.get("allowEdgePinning");
let disableMiniModeCached = _settingsController.get("disableMiniMode");
let eyeTrackingEnabledCached = _settingsController.get("eyeTrackingEnabled");
let keepSizeAcrossDisplaysCached = _settingsController.get("keepSizeAcrossDisplays");
// #1275: master always-on-top preference for the pet body.
let petAlwaysOnTopCached = _settingsController.get("petAlwaysOnTop");
let textScale = _settingsController.get("textScale");
let textScaleByDisplay = _settingsController.get("textScaleByDisplay");
// Transient slider-drag override for ONE display — the one the settings
// window sits on (what you see is what you tune). Applied to live windows but
// never written to the store; cleared on commit (mirror setters) or rollback
// (endTextScalePreview).
let textScalePreview = null; // { key: string, value: number }

function getDisplayKeyForBounds(bounds) {
  if (!bounds) return null;
  try {
    const display = screen.getDisplayMatching(bounds);
    return display && display.id != null ? String(display.id) : null;
  } catch {
    return null;
  }
}

function getPetDisplayKey() {
  // Resolve from the pet's CENTER POINT, not the window rect: the pet windows
  // use enableLargerThanScreen and can overhang display edges, which makes
  // getDisplayMatching unstable. Nearest-point matches the same anchor the
  // bubble/HUD geometry uses (getNearestWorkArea of the pet center), so the
  // zoom value and the layout always agree on which display they are on.
  try {
    const bounds = getPetWindowBounds();
    if (!bounds) return null;
    const point = {
      x: Math.round(bounds.x + bounds.width / 2),
      y: Math.round(bounds.y + bounds.height / 2),
    };
    const display = screen.getDisplayNearestPoint(point);
    return display && display.id != null ? String(display.id) : null;
  } catch {
    return null;
  }
}

function getWindowDisplayKey(win) {
  if (!win || typeof win.isDestroyed !== "function" || win.isDestroyed()) return null;
  try { return getDisplayKeyForBounds(win.getBounds()); } catch { return null; }
}

function getSettingsDisplayKey() {
  return getWindowDisplayKey(settingsWindowRuntime.getWindow()) || getPetDisplayKey();
}

function effectiveTextScaleForKey(key) {
  if (textScalePreview && key && textScalePreview.key === key) {
    return clampTextScale(textScalePreview.value);
  }
  return resolveTextScaleForKey(textScaleByDisplay, textScale, key);
}

// Pet-anchored floating windows (permission bubbles, update bubble, session
// HUD) all read the scale of whichever display the pet is on right now.
function getTextScaleForPetWindows() {
  return effectiveTextScaleForKey(getPetDisplayKey());
}

// textScale changed (commit, preview tick, or display change): the resizable
// windows re-zoom themselves against their own display, and the pet-anchored
// floating windows re-resolve scale + re-inject zoom inside their reposition
// paths (applyZoomToWindow memoizes, so this is cheap to call broadly).
function applyTextScaleNow() {
  try {
    if (settingsWindowRuntime && typeof settingsWindowRuntime.applyTextScaleToWindow === "function") {
      settingsWindowRuntime.applyTextScaleToWindow();
    }
  } catch (err) {
    console.warn("Clawd: settings window text scale failed:", err && err.message);
  }
  try {
    if (_dashboard && typeof _dashboard.applyTextScaleToWindow === "function") {
      _dashboard.applyTextScaleToWindow();
    }
  } catch (err) {
    console.warn("Clawd: dashboard text scale failed:", err && err.message);
  }
  repositionAnchoredFloatingSurfaces();
}

function previewTextScale(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    textScalePreview = null;
  } else {
    const key = getSettingsDisplayKey();
    textScalePreview = key ? { key, value: clampTextScale(n) } : null;
  }
  applyTextScaleNow();
  return { status: "ok" };
}

function endTextScalePreview() {
  if (!textScalePreview) return { status: "ok", noop: true };
  textScalePreview = null;
  applyTextScaleNow();
  return { status: "ok" };
}

function togglePetVisibility() {
  return petWindowRuntime.togglePetVisibility();
}
// Explicit-direction variant for the menus: the Show/Hide Pet items apply the
// intent their label carried when the menu was built, so a state change that
// lands while the menu is open degrades to a no-op instead of inverting the
// action (see menu.js).
function setPetVisibility(visible) {
  return petWindowRuntime.setPetHidden(!visible);
}
function bringPetToPrimaryDisplay() {
  return petWindowRuntime.bringPetToPrimaryDisplay();
}

function sendRawToRenderer(channel, ...args) {
  if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) return false;
  win.webContents.send(channel, ...args);
  return true;
}

function inferVisualSource(displayState, file) {
  return displayState === "idle" && file !== _state.getCurrentSvg()
    ? "idle-animation"
    : "state";
}

// Last free-roam walk heading sent to the renderer (roam visuals face right).
let roamHeadingLeft = false;
// Last pet screen side sent to the renderer; decides the mirror of idle
// animations that opt in with mirrorOnRightSide.
let petOnRightSide = false;

function syncPetScreenSide() {
  const bounds = getPetWindowBounds();
  if (!bounds) return;
  const cx = bounds.x + bounds.width / 2;
  const wa = getNearestWorkArea(cx, bounds.y + bounds.height / 2);
  if (!wa) return;
  petOnRightSide = cx > wa.x + wa.width / 2;
  // Sent unconditionally: a reloaded renderer starts back at "left".
  sendRawToRenderer("pet-screen-side", petOnRightSide);
}

function requestDisplayedVisual(displayState, file, options = {}) {
  if (!displayedVisualProjection) return null;
  const activeTheme = getActiveTheme();
  // Re-sampled on every idle request, so a drag or roam since the last idle
  // animation is picked up before the next one starts.
  if (displayState === "idle") syncPetScreenSide();
  // A mirrored visual (left mini edge, leftward roam) may show a variant with
  // pre-mirrored glyphs (theme mirroredFiles). It shares the original's
  // silhouette, so the hit box still comes from the original file.
  const visualFile = resolveMirroredFile(activeTheme, file, isVisualMirrored(activeTheme, displayState, {
    miniMode: _mini.getMiniMode(),
    miniEdge: _mini.getMiniEdge(),
    roamHeadingLeft,
    file,
    petOnRightSide,
  }));
  return displayedVisualProjection.request({
    themeId: activeTheme && activeTheme._id,
    logicalState: options.logicalState || _state.getCurrentState(),
    displayState,
    file: visualFile,
    hitBox: _state.resolveHitBoxForSvg(file),
    source: options.source || inferVisualSource(displayState, file),
    restartAnimation: options.restartAnimation === true,
    deliver: options.deliver || ((payload) => sendRawToRenderer("state-change", payload)),
    onLogicalSettlement: options.onLogicalSettlement,
  });
}

function refreshIdleVisualAfterDrag() {
  if (!displayedVisualProjection || _state.getCurrentState() !== "idle") return null;
  const snapshot = displayedVisualProjection.getSnapshot();
  const visual = snapshot.requested || snapshot.committed;
  // Reactions restore their visual themselves. Do not interrupt a click
  // reaction that started during the drag or replace a transitional visual.
  if (!visual || visual.displayState !== "idle" || visual.source === "reaction") return null;
  const file = _state.getCurrentSvg();
  if (!getRightSideMirrorFiles(getActiveTheme()).includes(file)) return null;
  // A theme without a drag reaction keeps its resting sprite throughout the
  // drag. Re-request after the final clamp so side, glyph variant and hitbox
  // go through the same path as the initial idle request.
  return requestDisplayedVisual("idle", file);
}

function resetDisplayedVisualProjection(detail = "projection-reset", options = {}) {
  if (!displayedVisualProjection) return false;
  const activeTheme = getActiveTheme();
  displayedVisualProjection.reset({
    themeId: activeTheme && activeTheme._id,
    logicalState: _state.getCurrentState(),
    detail,
    preserveCommitted: options.preserveCommitted === true,
  });
  if (options.preserveCommitted !== true) {
    lastAppliedVisualGeneration = 0;
    lastDiscordPresenceVisual = null;
  }
  return true;
}

function refreshDisplayedVisualHitBoxes() {
  if (!displayedVisualProjection) return false;
  const refreshed = displayedVisualProjection.refreshHitBoxes(
    (file) => _state.resolveHitBoxForSvg(file)
  );
  if (!refreshed) return false;
  lastAppliedVisualGeneration = 0;
  return syncDisplayedVisualGeometry();
}

function refreshDisplayedVisualForLowPowerMode() {
  const activeTheme = getActiveTheme();
  const state = _state.getCurrentState();
  const file = _state.getCurrentSvg();
  const override = activeTheme
    && activeTheme.rendering
    && activeTheme.rendering.lowPowerStaticImageOverrides
    && activeTheme.rendering.lowPowerStaticImageOverrides[state];
  if (!override || override.from !== file || !override.to) return false;
  return !!requestDisplayedVisual(state, file, {
    logicalState: state,
    source: "state",
  });
}

function isVisualGenerationCurrent(visualGeneration) {
  if (!displayedVisualProjection || !Number.isSafeInteger(visualGeneration)) return false;
  const snapshot = displayedVisualProjection.getSnapshot();
  const current = snapshot.requested || snapshot.committed;
  return !!(current && current.visualGeneration === visualGeneration);
}

function resolveDragReactionFile(direction) {
  const theme = getActiveTheme();
  const drag = theme && theme.reactions && theme.reactions.drag;
  if (!drag || typeof drag !== "object") return null;
  if (direction === "left" && typeof drag.fileLeft === "string") return drag.fileLeft;
  if (direction === "right" && typeof drag.fileRight === "string") return drag.fileRight;
  return typeof drag.file === "string" ? drag.file : null;
}

function requestDragReaction(direction) {
  const normalizedDirection = direction === "left" || direction === "right" ? direction : null;
  const file = resolveDragReactionFile(normalizedDirection);
  if (!file) return null;
  const snapshot = displayedVisualProjection.getSnapshot();
  const activeReaction = snapshot.requested || snapshot.committed;
  if (activeReaction && activeReaction.source === "reaction" && activeReaction.file === file) {
    sendRawToRenderer("start-drag-reaction", null, normalizedDirection);
    return activeReaction;
  }
  return requestDisplayedVisual(_state.getCurrentState(), file, {
    source: "reaction",
    deliver: (payload) => sendRawToRenderer("start-drag-reaction", payload, normalizedDirection),
  });
}

function requestClickReaction(file, duration) {
  const activeTheme = getActiveTheme();
  if (!activeTheme || !collectRequiredAssetFiles(activeTheme).includes(file)) return null;
  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  return requestDisplayedVisual(_state.getCurrentState(), file, {
    source: "reaction",
    deliver: (payload) => sendRawToRenderer("play-click-reaction", payload, safeDuration),
  });
}

function sendToRenderer(channel, ...args) {
  if (channel === "state-change") {
    return requestDisplayedVisual(args[0], args[1], args[2] || {});
  }
  return sendRawToRenderer(channel, ...args);
}
function sendToHitWin(channel, ...args) {
  if (hitWin && !hitWin.isDestroyed()) hitWin.webContents.send(channel, ...args);
}
function getThemeSoundPreloadUrls() {
  const urls = [];
  for (const name of ["complete", "confirm"]) {
    const url = themeRuntime.getSoundUrl(name);
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

function syncSoundPreloads() {
  const urls = getThemeSoundPreloadUrls();
  if (urls.length) sendToRenderer("preload-sounds", { urls });
}

function setViewportOffsetY(offsetY) { return petWindowRuntime.setViewportOffsetY(offsetY); }
function getPetWindowBounds() { return petWindowRuntime.getPetWindowBounds(); }
// Issue #690 Phase 3: mini's per-frame applyMiniFrameBounds() needs opts
// (workArea/edgeContext/assertNoYOffset) to actually reach
// petWindowRuntime.applyPetWindowBounds() — this wrapper used to silently
// drop a second argument, which would have made assertNoYOffset a no-op.
function applyPetWindowBounds(bounds, opts) { return petWindowRuntime.applyPetWindowBounds(bounds, opts); }
// PR #751 Codex deep review, rework batch A (coordinator-attributed fix):
// this sibling wrapper had the exact same 2-param bug applyPetWindowBounds
// above was fixed for — topmost-runtime.js's applyFreshNudge() (#525) calls
// applyPetWindowPosition(x, y, { force: true }) specifically so the
// compositor-refresh nudge writes natively even when the materialized
// physical rect already matches current live bounds, but this wrapper
// silently dropped that third argument, making force:true a no-op.
function applyPetWindowPosition(x, y, opts) { return petWindowRuntime.applyPetWindowPosition(x, y, opts); }

function syncHitStateAfterLoad() {
  sendToHitWin("hit-state-sync", {
    currentState: _state.getCurrentState(),
    miniMode: _mini.getMiniMode(),
    dndEnabled: doNotDisturb,
  });
}

function syncRendererStateAfterLoad({ includeStartupRecovery = true } = {}) {
  syncSoundPreloads();
  const activeTheme = getActiveTheme();
  const tintId = getPetTintIdForTheme(petTint, activeTheme && activeTheme._id);
  sendToRenderer("pet-tint-change", resolvePetTintPayload(tintId, activeTheme));
  deliverAccessorySlotsSnapshot(activeTheme);
  sendToRenderer("low-power-idle-mode-change", lowPowerIdleMode);
  sendToRenderer("pet-hidden-change", petWindowRuntime.isPetHidden());
  if (_mini.getMiniMode()) {
    sendToRenderer("mini-mode-change", true, _mini.getMiniEdge());
    // mini-clip is a renderer inline style — a renderer/theme reload (and
    // startup recovery) drops it. Re-send the current seam clip so a
    // contained mini stays clipped instead of bleeding onto the neighbour.
    _mini.syncContainedClip();
  }
  if (doNotDisturb) {
    sendToRenderer("dnd-change", true);
    if (_mini.getMiniMode()) {
      applyState("mini-sleep");
    } else {
      applyState("sleeping");
    }
    return;
  }
  if (_mini.getMiniMode()) {
    applyState("mini-idle");
    return;
  }

  // Theme hot-reload path (override tweak / variant swap): re-render whatever
  // we were already showing. Going through resolveDisplayState() here flashes
  // "working/typing" when sessions Map still holds a stale session whose
  // state hasn't been stale-downgraded yet — currentState already reflects
  // the user-visible state before reload and stays authoritative.
  if (!includeStartupRecovery) {
    const prev = _state.getCurrentState();
    applyState(prev, getSvgOverride(prev));
    return;
  }

  if (sessions.size > 0) {
    const resolved = resolveDisplayState();
    applyState(resolved, getSvgOverride(resolved));
    return;
  }

  applyState("idle", getSvgOverride("idle"));

  setTimeout(() => {
    if (sessions.size > 0 || doNotDisturb) return;
    detectRunningAgentProcesses((found) => {
      if (found && sessions.size === 0 && !doNotDisturb) {
        _startStartupRecovery();
        resetIdleTimer();
      }
    });
  }, 5000);
}

// ── Sound playback ──
let lastSoundTime = 0;
const SOUND_COOLDOWN_MS = 10000;

function playSound(name) {
  if (soundMuted || doNotDisturb) return;
  const now = Date.now();
  if (now - lastSoundTime < SOUND_COOLDOWN_MS) return;
  const url = themeRuntime.getSoundUrl(name);
  if (!url) return;
  lastSoundTime = now;
  sendToRenderer("play-sound", { url, volume: soundVolume });
}

function stopTrayFlash() {
  if (trayFlashTimer) {
    clearInterval(trayFlashTimer);
    trayFlashTimer = null;
  }
  if (trayFlashStopTimer) {
    clearTimeout(trayFlashStopTimer);
    trayFlashStopTimer = null;
  }
  const t = _menu.getTray ? _menu.getTray() : null;
  if (t && trayFlashNormalIcon) {
    t.setImage(trayFlashNormalIcon);
  }
}

function flashTaskbar() {
  if (doNotDisturb) return;
  if (!_settingsController.get("flashTaskbarOnComplete")) return;

  const tray = _menu.getTray ? _menu.getTray() : null;
  if (!tray) return;

  // Cache the normal icon on first call
  if (!trayFlashNormalIcon) {
    trayFlashNormalIcon = loadTrayNormalIcon({
      nativeImage,
      iconPath: path.join(__dirname, "../assets/icon.png"),
    });
  }

  // Cache the completion icon (32px orange dot) on first call.
  if (!trayFlashHighlightIcon) {
    trayFlashHighlightIcon = loadTrayFlashIcon({
      nativeImage,
      flashPath: path.join(__dirname, "../assets/tray-icon-flash.png"),
      fileExists: (p) => fs.existsSync(p),
    });
  }

  if (!trayFlashHighlightIcon) return;

  // Clear any existing flash timers
  if (trayFlashTimer) clearInterval(trayFlashTimer);
  if (trayFlashStopTimer) {
    clearTimeout(trayFlashStopTimer);
    trayFlashStopTimer = null;
  }

  const intervalMs = _settingsController.get("flashIntervalMs") || 500;
  const durationMs = _settingsController.get("flashDurationMs");
  // durationMs defaults to 5000; 0 means flash until manually stopped

  let useHighlight = true;
  trayFlashTimer = setInterval(() => {
    if (!_menu.getTray || !_menu.getTray()) {
      stopTrayFlash();
      return;
    }
    const t = _menu.getTray();
    t.setImage(useHighlight ? trayFlashHighlightIcon : trayFlashNormalIcon);
    useHighlight = !useHighlight;
  }, intervalMs);

  // Auto-stop after duration (unless duration is 0 = always)
  if (durationMs !== 0) {
    trayFlashStopTimer = setTimeout(() => {
      stopTrayFlash();
    }, durationMs || 5000);
  }

  // Stop on tray click
  tray.removeAllListeners("click");
  tray.on("click", () => {
    stopTrayFlash();
    tray.removeAllListeners("click");
  });
}

function syncHitWin() { return petWindowRuntime.syncHitWin(); }

function getDisplayedVisualTuple() {
  const committed = displayedVisualProjection
    && displayedVisualProjection.getSnapshot().committed;
  if (committed) return committed;
  return {
    displayState: _state.getCurrentState(),
    file: _state.getCurrentSvg(),
    hitBox: _state.getCurrentHitBox(),
    source: "startup",
    visualGeneration: 0,
  };
}

function syncDisplayedVisualGeometry() {
  const committed = displayedVisualProjection
    && displayedVisualProjection.getSnapshot().committed;
  if (!committed || committed.visualGeneration === lastAppliedVisualGeneration) return true;
  const outcome = describeGeometrySync(syncHitWin());
  if (outcome.applied) lastAppliedVisualGeneration = committed.visualGeneration;
  return outcome.applied;
}

let mouseOverPet = false;
let menuOpen = false;
let idlePaused = false;
let lowPowerIdlePaused = false;
let forceEyeResend = false;
let forceEyeResendBoostUntil = 0;
let requestFastTick = () => {};
let repositionSessionHud = () => {};
let syncSessionHudVisibility = () => {};
let broadcastSessionHudSnapshot = () => {};
let sendSessionHudI18n = () => {};

const themeFadeSequencer = createThemeFadeSequencer({
  getRenderWindow: () => win,
  getHitWindow: () => hitWin,
  getRestoreOpacity: () => 1,
  fadeOutMs: THEME_SWITCH_FADE_OUT_MS,
  fadeInMs: THEME_SWITCH_FADE_IN_MS,
  fallbackMs: THEME_SWITCH_FADE_FALLBACK_MS,
});

function setForceEyeResend(value) {
  forceEyeResend = !!value;
  if (forceEyeResend) {
    forceEyeResendBoostUntil = Math.max(forceEyeResendBoostUntil, Date.now() + 2000);
    requestFastTick(100);
  }
}

function setLowPowerIdlePaused(value) {
  const next = !!value;
  if (lowPowerIdlePaused === next) return;
  lowPowerIdlePaused = next;
  if (!next) setForceEyeResend(true);
}

function beginDragSnapshot() { return petWindowRuntime.beginDragSnapshot(); }
function clearDragSnapshot() { return petWindowRuntime.clearDragSnapshot(); }
function moveWindowForDrag() { return petWindowRuntime.moveWindowForDrag(); }

// ── Mini Mode — delegated to src/mini.js ──
// Initialized after state module (needs applyState, resolveDisplayState, etc.)
// See _mini initialization below

// #1275: apply the always-on-top preference to the live pet windows.
function applyPetAlwaysOnTopPreference() {
  for (const target of [win, hitWin]) {
    if (!target || target.isDestroyed() || typeof target.setAlwaysOnTop !== "function") continue;
    if (target.isAlwaysOnTop() === petAlwaysOnTopCached) continue;
    target.setAlwaysOnTop(petAlwaysOnTopCached);
  }
}

const {
  createRuntimeAgentGate,
} = require("./agent-gate");
const _runtimeAgentGate = createRuntimeAgentGate({
  getSnapshot: () => _settingsController.getSnapshot(),
  // Both unreadable prefs and a writable recovered-defaults snapshot are
  // non-authoritative for this process. The latter may repair the primary file,
  // but only a clean load after restart can re-open agent paths.
  isAuthoritative: () => !_initialPrefsRecovered && !_settingsController.hasReadFailure(),
});
let sessionDebugLog = null; // set after app.whenReady()
let focusDebugLog = null; // set after app.whenReady()

function repositionAnchoredFloatingSurfaces() {
  repositionSessionHud();
}

// ── State machine — delegated to src/state.js ──
let showDashboard = () => {};
let broadcastDashboardSessionSnapshot = () => {};
let sendDashboardI18n = () => {};

// #509: user-selected default idle visual, resolved against the live active
// theme so reads never go stale across theme switches. Returns null when
// unset/invalid — callers keep their existing fallback. The visible repaint
// on a pref change is the refreshIdleVisual router hook's job, further down.
const { resolveIdleVisualChoice } = require("./idle-visual");
function getIdleVisualChoice() {
  return resolveIdleVisualChoice(getActiveTheme(), _settingsController.get("idleVisual"));
}

// Renderer theme config with pre-IPC choices stamped on — the first media load
// should already use the selected idle visual and tint instead of briefly
// showing theme defaults. getRendererConfig() returns a fresh object, safe to
// extend.
function buildRendererThemeConfig(accessorySnapshot = null) {
  const cfg = themeRuntime.getRendererConfig();
  if (cfg) {
    const activeTheme = getActiveTheme();
    const tintSelections = _settingsController.get("petTint");
    const tintId = getPetTintIdForTheme(tintSelections, activeTheme && activeTheme._id);
    const canonical = accessorySnapshot || getPetAccessorySlotsSnapshot(activeTheme);
    cfg.idleDefaultVisual = getIdleVisualChoice();
    cfg.petTintPayload = resolvePetTintPayload(tintId, activeTheme);
    if (canonical) {
      cfg.accessorySlots = {
        themeId: canonical.themeId,
        accessoryGeneration: canonical.accessoryGeneration,
        head: {
          supported: cfg.accessorySupported === true,
          attachments: cfg.accessoryAttachments || null,
          payload: canonical.payloads.head,
        },
        mouth: {
          supported: cfg.mouthAccessorySupported === true,
          attachments: cfg.mouthAccessoryAttachments || null,
          payload: canonical.payloads.mouth,
        },
      };
    }
  }
  return cfg;
}

function deliverRendererThemeConfig() {
  const delivery = prepareCurrentAccessorySlotsDelivery();
  const cfg = buildRendererThemeConfig(delivery.snapshot);
  // Keep the sync-IPC source current so a window reload picks up the same
  // config as this push.
  rendererConfigChannel.setPetConfig(cfg);
  const delivered = sendToRenderer("theme-config", cfg);
  return !!finalizePetAccessorySlotsDelivery(delivery, delivered);
}

const recapRuntime = createRecapRuntime({
  // A default-filled snapshot is not user authority when prefs were unreadable,
  // recovered, or written by a future app version. Start paused in that case;
  // a later explicit, controller-accepted toggle may still call setEnabled().
  getEnabled: () => !_recapStartupAuthorityLost
    && _settingsController.get("recapEnabled") !== false,
  powerMonitor,
  logWarn: console.warn,
  onRecorded: () => settingsWindowRuntime.notifyRecapChanged(),
});

const _stateCtx = {
  get theme() { return getActiveTheme(); },
  get win() { return win; },
  get hitWin() { return hitWin; },
  recapSink: recapRuntime,
  get doNotDisturb() { return doNotDisturb; },
  set doNotDisturb(v) { doNotDisturb = v; },
  get miniMode() { return _mini.getMiniMode(); },
  get miniTransitioning() { return _mini.getMiniTransitioning(); },
  get mouseOverPet() { return mouseOverPet; },
  get miniSleepPeeked() { return _mini.getMiniSleepPeeked(); },
  set miniSleepPeeked(v) { _mini.setMiniSleepPeeked(v); },
  get miniPeeked() { return _mini.getMiniPeeked(); },
  set miniPeeked(v) { _mini.setMiniPeeked(v); },
  cancelPendingMiniPeek: (resetState) => _mini.cancelPendingMiniPeek(resetState),
  get idlePaused() { return idlePaused; },
  set idlePaused(v) { idlePaused = v; },
  get forceEyeResend() { return forceEyeResend; },
  set forceEyeResend(v) { setForceEyeResend(v); },
  get mouseStillSince() { return _tick ? _tick._mouseStillSince : Date.now(); },
  sendToRenderer,
  sendToHitWin,
  syncHitWin,
  playSound,
  flashTaskbar,
  t: (key) => t(key),
  focusTerminalWindow: (...args) => focusTerminalWindow(...args),
  miniPeekIn: (mode) => miniPeekIn(mode),
  miniPeekOut: () => miniPeekOut(),
  buildContextMenu: () => buildContextMenu(),
  buildTrayMenu: () => buildTrayMenu(),
  debugLog: (msg) => sessionLog(msg),
  broadcastSessionSnapshot: (snapshot) => {
    reconcilePowerSaveBlocker();
    broadcastDashboardSessionSnapshot(snapshot);
    broadcastSessionHudSnapshot(snapshot);
    if (discordPresenceBridge) {
      try { discordPresenceBridge.onSnapshot(snapshot); } catch {}
    }
  },
  // Phase 3b: 读 prefs.themeOverrides 判断某个 oneshot state 是否被用户禁用。
  // state.js gate 调这个做 early-return。不做白名单校验——settings-actions
  // 负责写入合法性，这里只读。
  isOneshotDisabled: (stateKey) => {
    const theme = getActiveTheme();
    const themeId = theme && theme._id;
    if (!themeId || !stateKey) return false;
    const overrides = _settingsController.get("themeOverrides");
    const themeMap = overrides && overrides[themeId];
    const stateMap = themeMap && themeMap.states;
    const entry = (stateMap && stateMap[stateKey]) || (themeMap && themeMap[stateKey]);
    return !!(entry && entry.disabled === true);
  },
  get sessionHudCleanupDetached() { return sessionHudCleanupDetached; },
  getStaleConfig: () => ({
    sessionStaleMs,
    workingStaleMs,
    detachedIdleStaleMs,
  }),
  getSessionAliases: () => _settingsController.get("sessionAliases"),
  getIdleVisualChoice,
  isAgentEnabled: (agentId) => _runtimeAgentGate.isAgentEnabled(agentId),
};
const _state = require("./state")(_stateCtx);
displayedVisualProjection = createDisplayedVisualProjection({
  projectActualFile: ({ actualFile, requested }) => {
    const activeTheme = getActiveTheme();
    if (!activeTheme || !collectRequiredAssetFiles(activeTheme).includes(actualFile)) return null;
    return {
      displayState: requested.displayState,
      hitBox: _state.resolveHitBoxForSvg(actualFile),
    };
  },
  onCommit: (visual) => {
    syncDisplayedVisualGeometry();
    try { repositionAnchoredFloatingSurfaces(); } catch {}
    if (visual.source === "reaction") return;
    lastDiscordPresenceVisual = {
      state: visual.displayState,
      svg: visual.file,
      themeId: visual.themeId,
    };
    if (discordPresenceBridge) {
      try {
        discordPresenceBridge.onVisual(
          lastDiscordPresenceVisual.state,
          lastDiscordPresenceVisual.svg,
          lastDiscordPresenceVisual.themeId
        );
      } catch {}
    }
  },
  onRendererUnresponsive: () => {
    if (!win || win.isDestroyed()) return;
    resetDisplayedVisualProjection("renderer-unresponsive", { preserveCommitted: true });
    petWindowRuntime.reloadWindowWebContents(win);
  },
});
const { setState, applyState, updateSession, resolveDisplayState, getSvgOverride,
        enableDoNotDisturb, disableDoNotDisturb: disableDoNotDisturbState,
        startStaleCleanup,
        stopWakePoll, detectRunningAgentProcesses,
        startStartupRecovery: _startStartupRecovery } = _state;
const sessions = _state.sessions;

function disableDoNotDisturb() {
  return disableDoNotDisturbState();
}

// ── Keep-awake: block OS sleep while any agent task is in progress ──
// State→in-progress mapping lives in state-session-snapshot.isSessionInProgress
// (kept as a pure helper so the semantics are unit-tested).
let powerSaveBlockerId = null;
function anySessionInProgress() {
  for (const [, s] of sessions) {
    if (isSessionInProgress(s)) return true;
  }
  return false;
}
function reconcilePowerSaveBlocker() {
  try {
    const shouldBlock = keepAwakeWhileWorking && anySessionInProgress();
    const active = powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId);
    if (shouldBlock && !active) {
      powerSaveBlockerId = powerSaveBlocker.start("prevent-app-suspension");
    } else if (!shouldBlock && active) {
      powerSaveBlocker.stop(powerSaveBlockerId);
      powerSaveBlockerId = null;
    }
  } catch (err) {
    console.warn("Clawd: reconcilePowerSaveBlocker failed:", err);
  }
}
function releasePowerSaveBlocker() {
  try {
    if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
      powerSaveBlocker.stop(powerSaveBlockerId);
    }
  } catch {}
  powerSaveBlockerId = null;
}

// ── Hit-test: SVG bounding box → screen coordinates ──
function getHitRectScreen(bounds) { return petWindowRuntime.getHitRectScreen(bounds); }
function getSessionHudAnchorRect(bounds) { return petWindowRuntime.getSessionHudAnchorRect(bounds); }

// ── Main tick — delegated to src/tick.js ──
const _tickCtx = {
  get theme() { return getActiveTheme(); },
  get win() { return win; },
  getPetWindowBounds,
  get currentState() { return _state.getCurrentState(); },
  get currentSvg() { return _state.getCurrentSvg(); },
  get miniMode() { return _mini.getMiniMode(); },
  get miniTransitioning() { return _mini.getMiniTransitioning(); },
  get dragLocked() { return petWindowRuntime.isDragLocked(); },
  get menuOpen() { return menuOpen; },
  get idlePaused() { return idlePaused; },
  get lowPowerIdleMode() { return lowPowerIdleMode; },
  get lowPowerIdlePaused() { return lowPowerIdlePaused; },
  get eyeTrackingEnabled() { return eyeTrackingEnabledCached; },
  get isAnimating() { return _mini.getIsAnimating(); },
  get miniSleepPeeked() { return _mini.getMiniSleepPeeked(); },
  set miniSleepPeeked(v) { _mini.setMiniSleepPeeked(v); },
  get miniPeeked() { return _mini.getMiniPeeked(); },
  set miniPeeked(v) { _mini.setMiniPeeked(v); },
  cancelPendingMiniPeek: (resetState) => _mini.cancelPendingMiniPeek(resetState),
  get mouseOverPet() { return mouseOverPet; },
  set mouseOverPet(v) { mouseOverPet = v; },
  get forceEyeResend() { return forceEyeResend; },
  set forceEyeResend(v) { setForceEyeResend(v); },
  get forceEyeResendBoostUntil() { return forceEyeResendBoostUntil; },
  get startupRecoveryActive() { return _state.getStartupRecoveryActive(); },
  sendToRenderer,
  sendToHitWin,
  isVisualGenerationCurrent,
  setState,
  applyState,
  getIdleVisualChoice,
  getEffectiveAccessoryIds: getEffectivePetAccessoryIds,
  miniPeekIn: (mode) => miniPeekIn(mode),
  miniPeekOut: () => miniPeekOut(),
  getObjRect,
  getHitRectScreen,
  getAssetPointerPayload,
  get roam() { return _roam; },
  get idleActivity() { return _idleActivity; },
};
const _tick = require("./tick")(_tickCtx);
requestFastTick = (maxDelay) => _tick.scheduleSoon(maxDelay);
const { startMainTick, resetIdleTimer } = _tick;

// ── Terminal focus — delegated to src/focus.js ──
const { focusTerminalWindow } = require("./focus")({ focusLog });

function getFocusableLocalHudSessionIds() {
  if (!_state || typeof _state.buildSessionSnapshot !== "function") return [];
  return selectFocusableLocalHudSessionIds(_state.buildSessionSnapshot());
}

function focusDashboardSession(sessionId, options = {}) {
  if (!sessionId) return false;
  const requestSource = options.requestSource || "dashboard";
  const id = String(sessionId);
  const session = sessions.get(id);
  if (!session) {
    focusLog(`focus result branch=none reason=session-not-found source=${requestSource} sid=${id}`);
    return false;
  }
  if (!getSessionFocusTarget({ ...session, id }).canFocus) {
    focusLog(`focus result branch=none reason=no-source-pid source=${requestSource} sid=${id}`);
    return false;
  }
  return focusTerminalWindow({
    sourcePid: session.sourcePid,
    cwd: session.cwd,
    pidChain: session.pidChain,
    tmuxSocket: session.tmuxSocket,
    tmuxClient: session.tmuxClient,
    sessionId: id,
    agentId: session.agentId,
    requestSource,
  });
}

function hideDashboardSession(sessionId) {
  if (!_state || typeof _state.dismissSession !== "function") {
    return { status: "error", message: "session state is not ready" };
  }
  const removed = _state.dismissSession(String(sessionId || ""));
  return removed
    ? { status: "ok" }
    : { status: "not-found" };
}

const openDashboardSessionFolder = createSessionFolderOpener({
  getSession: (sessionId) => sessions.get(sessionId),
  openPath: (cwd) => shell.openPath(cwd),
});

const _dashboard = require("./dashboard")({
  get lang() { return lang; },
  t: (key) => translate(key),
  getSessionSnapshot: () => _state.buildSessionSnapshot(),
  getI18n: () => getDashboardI18nPayload(),
  focusSession: (sessionId, options) => focusDashboardSession(sessionId, options),
  isAppQuitting: () => isQuitting,
  getPetWindowBounds,
  getNearestWorkArea,
  getSettingsWindow: () => settingsWindowRuntime.getWindow(),
  getTextScale: (bounds) => effectiveTextScaleForKey(
    getDisplayKeyForBounds(bounds)
    || getWindowDisplayKey(_dashboard ? _dashboard.getWindow() : null)
    || getPetDisplayKey()
  ),
  getSavedBounds: () => _settingsController.get("dashboardWindowBounds"),
  onSaveBounds: (bounds) => _settingsController.applyUpdate("dashboardWindowBounds", bounds),
});
showDashboard = _dashboard.showDashboard;
broadcastDashboardSessionSnapshot = (snapshot) => {
  _dashboard.broadcastSessionSnapshot(snapshot);
};
sendDashboardI18n = () => {
  _dashboard.sendI18n();
};

// ── First-run onboarding tutorial ──
// Buckets the installable agents for the tutorial's step 2. We call the
// detector with skipDefaultIntegrations:false so the default integrations are
// present in the report; the bucketer still exempts them from cleanup (#895 —
// a missing ~/.codex is not evidence that a Codex hook is stale), so this flag
// only affects the active/install buckets.
function buildTutorialAgentOnboardingState() {
  const { detectAgentInstallations } = require("./agent-installation-detector");
  const { INSTALLABLE_AGENT_IDS } = require("./settings-actions-agents");
  const { bucketAgentsForTutorial } = require("./tutorial-agent-buckets");
  let detection = { agents: [] };
  try {
    detection = detectAgentInstallations({ skipDefaultIntegrations: false }) || detection;
  } catch (err) {
    console.warn("Clawd: tutorial agent detection failed:", err && err.message);
  }
  return bucketAgentsForTutorial({
    detectionAgents: detection.agents,
    agentsPref: _settingsController.get("agents") || {},
    installableIds: INSTALLABLE_AGENT_IDS,
    getAgentIconUrl,
  });
}

// The editable shortcuts the tutorial teaches. Reflects the user's current
// binding (null when they've unassigned it) and falls back to the shipped
// default only when the key has never been touched.
function buildTutorialShortcutsSummary() {
  const { SHORTCUT_ACTIONS, SHORTCUT_ACTION_IDS } = require("./shortcut-actions");
  const userShortcuts = _settingsController.get("shortcuts") || {};
  return SHORTCUT_ACTION_IDS.filter((id) => {
    const action = SHORTCUT_ACTIONS[id] || {};
    return action.showInTutorial !== false;
  }).map((id) => {
    const action = SHORTCUT_ACTIONS[id] || {};
    const accelerator = Object.prototype.hasOwnProperty.call(userShortcuts, id)
      ? userShortcuts[id]
      : action.defaultAccelerator;
    return {
      id,
      label: translate(action.labelKey),
      accelerator,
      defaultAccelerator: action.defaultAccelerator,
      persistent: !!action.persistent,
    };
  });
}

// The welcome screen uses the app icon so first run feels like product setup.
// Keep this as a file URL so repeated tutorial state pushes don't clone the
// 1.46 MB PNG as a base64 string on every agent/shortcut update.
let _tutorialHeroSrcCache = null;
function getTutorialHeroSrc() {
  if (_tutorialHeroSrcCache != null) return _tutorialHeroSrcCache;
  try {
    _tutorialHeroSrcCache = pathToFileURL(path.join(__dirname, "..", "assets", "icon.png")).href;
  } catch (err) {
    console.warn("Clawd: failed to resolve tutorial icon:", err && err.message);
    _tutorialHeroSrcCache = "";
  }
  return _tutorialHeroSrcCache;
}

let _tutorialDoneHeroSvgCache = null;
function getTutorialDoneHeroSvg() {
  if (_tutorialDoneHeroSvgCache != null) return _tutorialDoneHeroSvgCache;
  try {
    _tutorialDoneHeroSvgCache = fs.readFileSync(
      path.join(__dirname, "..", "assets", "svg", "clawd-about-hero.svg"),
      "utf8"
    );
  } catch (err) {
    console.warn("Clawd: failed to read tutorial done hero:", err && err.message);
    _tutorialDoneHeroSvgCache = "";
  }
  return _tutorialDoneHeroSvgCache;
}

const _tutorial = require("./tutorial")({
  t: (key) => translate(key),
  getI18n: () => getDashboardI18nPayload().translations,
  getLang: () => lang,
  getLangs: () => SUPPORTED_LANGS.slice(),
  // Let the user override the (system-seeded) language right from the wizard.
  // Persists as their chosen language; the set-lang IPC re-pushes state so the
  // whole wizard re-localizes immediately.
  setLang: (value) => {
    if (typeof value === "string" && SUPPORTED_LANGS.includes(value)) {
      _settingsController.applyUpdate("lang", value);
    }
  },
  getHeroSrc: () => getTutorialHeroSrc(),
  getDoneHeroSvg: () => getTutorialDoneHeroSvg(),
  getAgentOnboardingState: () => buildTutorialAgentOnboardingState(),
  // install/uninstall route through the controller's command API so the commit
  // (integrationInstalled flag, hint cleanup, monitor start/stop) persists and
  // validates exactly as the Settings → Agents path does.
  installAgent: (agentId) => _settingsController.applyCommand("installAgentIntegration", { agentId }),
  uninstallAgent: (agentId) => _settingsController.applyCommand("uninstallAgentIntegration", { agentId }),
  registerShortcut: (payload) => _settingsController.applyCommand("registerShortcut", payload),
  resetShortcut: (payload) => _settingsController.applyCommand("resetShortcut", payload),
  openSettingsTab: (tab) => settingsWindowRuntime.open({ tab }),
  markTutorialSeen: () => {
    _settingsController.applyUpdate("tutorialSeen", true);
  },
  getShortcutsSummary: () => buildTutorialShortcutsSummary(),
  getTextScale: () => effectiveTextScaleForKey(
    getWindowDisplayKey(_tutorial ? _tutorial.getWindow() : null) || getPetDisplayKey()
  ),
});

const _sessionHud = require("./session-hud")({
  get win() { return win; },
  get petHidden() { return petWindowRuntime.isPetHidden(); },
  get sessionHudEnabled() { return sessionHudEnabled; },
  get sessionHudShowStateLabels() { return sessionHudShowStateLabels; },
  get sessionHudShowElapsed() { return sessionHudShowElapsed; },
  get sessionHudShowContextUsage() { return sessionHudShowContextUsage; },
  get sessionHudPinned() { return sessionHudPinned; },
  get lowPowerIdleMode() { return lowPowerIdleMode; },
  getMiniMode: () => _mini.getMiniMode(),
  getMiniTransitioning: () => _mini.getMiniTransitioning(),
  getSessionSnapshot: () => _state.buildSessionSnapshot(),
  getI18n: () => getDashboardI18nPayload(),
  getPetWindowBounds,
  getHitRectScreen,
  getSessionHudAnchorRect,
  getNearestWorkArea,
  getTextScale: () => getTextScaleForPetWindows(),
});
repositionSessionHud = _sessionHud.repositionSessionHud;
syncSessionHudVisibility = _sessionHud.syncSessionHud;
broadcastSessionHudSnapshot = _sessionHud.broadcastSessionSnapshot;
sendSessionHudI18n = _sessionHud.sendI18n;

agentRuntime = createAgentRuntimeMain({
  getServer: () => _server,
  getStateRuntime: () => _state,
  isAgentEnabled: (agentId) => _runtimeAgentGate.isAgentEnabled(agentId),
  updateSession: (sessionId, state, event, opts) => updateSession(sessionId, state, event, opts),
});

// ── HTTP server — delegated to src/server.js ──
const _serverCtx = {
  get doNotDisturb() { return doNotDisturb; },
  shouldDropForDnd: () => _state.shouldDropForDnd ? _state.shouldDropForDnd() : doNotDisturb,
  get STATE_SVGS() { return _state.STATE_SVGS; },
  get sessions() { return sessions; },
  debugLog: (msg) => sessionLog(msg),
  isAgentEnabled: (agentId) => _runtimeAgentGate.isAgentEnabled(agentId),
  shouldSyncAgentIntegration: (agentId) =>
    _runtimeAgentGate.shouldSyncAgentIntegration(agentId),
  setState,
  updateSession: agentRuntime.updateSessionFromServer,
  updateSessionMetadata: agentRuntime.updateSessionMetadataFromServer,
};
Object.assign(_serverCtx, require("./local-server-port-hint"));
const _server = require("./server")(_serverCtx);
const { startHttpServer, getHookServerPort } = _server;

function sessionLog(msg) {
  if (!sessionDebugLog) return;
  const { rotatedAppend } = require("./log-rotate");
  rotatedAppend(sessionDebugLog, `[${formatLocalTimestamp()}] ${msg}\n`);
}

ipcMain.on("sound-playback-error", (_event, payload) => {
  const phase = payload && typeof payload.phase === "string"
    ? payload.phase.replace(/[^a-z0-9_-]/gi, "").slice(0, 32)
    : "unknown";
  const message = payload && typeof payload.message === "string"
    ? payload.message.replace(/\s+/g, " ").slice(0, 240)
    : "unknown";
  sessionLog(`sound playback error phase=${phase || "unknown"} message=${message || "unknown"}`);
});

function focusLog(msg) {
  if (!focusDebugLog) return;
  const { rotatedAppend } = require("./log-rotate");
  rotatedAppend(focusDebugLog, `[${new Date().toISOString()}] ${msg}\n`);
}

// In-process IPC bridge fed by the session-snapshot subscription.
function startDiscordPresence() {
  const config = _settingsController.getSnapshot().discordPresence;
  const ready = discordPresenceSettings.readiness(config);
  if (!ready.ready) return false;
  if (!discordPresenceBridge) {
    discordPresenceBridge = createDiscordPresenceBridge({
      getConfig: () => _settingsController.getSnapshot().discordPresence,
      // Development-only seam: committed GIF URLs intentionally point at main,
      // so pre-merge real-device QA may opt into a public test ref/host. A
      // packaged build always ignores the environment and uses the stable URL.
      gifBaseUrl: app.isPackaged ? "" : process.env.CLAWD_DISCORD_GIF_BASE_URL,
      log: (level, msg) => {
        try { sessionLog(`[discord-presence] ${level}: ${msg}`); } catch {}
        // Surface warnings (e.g. wrong App ID) on the house channel; the debug
        // log alone is invisible to an ordinary user.
        if (level === "warn") { try { console.warn(`Clawd: discord presence: ${msg}`); } catch {} }
      },
    });
  }
  discordPresenceBridge.start();
  // Prime from the last renderer-visible animation (including tick.js idle
  // rotation), falling back only before the first state-change was observed.
  const activeTheme = getActiveTheme();
  const visual = lastDiscordPresenceVisual
    ? {
        ...lastDiscordPresenceVisual,
        themeId: lastDiscordPresenceVisual.themeId || (activeTheme && activeTheme._id),
      }
    : {
        state: _state.getCurrentState(),
        svg: _state.getCurrentSvg(),
        themeId: activeTheme && activeTheme._id,
      };
  try { discordPresenceBridge.onVisual(visual.state, visual.svg, visual.themeId); } catch {}
  // Force a replay; the broadcast is otherwise change-gated.
  try { _state.emitSessionSnapshot({ force: true }); } catch {}
  return true;
}

function syncDiscordPresence(reason = "settings") {
  const config = _settingsController.getSnapshot().discordPresence;
  const ready = discordPresenceSettings.readiness(config);
  if (!ready.ready) {
    if (discordPresenceBridge) discordPresenceBridge.stop();
    try { sessionLog(`[discord-presence] sync ${reason}: off (${ready.reason})`); } catch {}
    return false;
  }
  try { sessionLog(`[discord-presence] sync ${reason}: on`); } catch {}
  return startDiscordPresence();
}

const _menuCtx = {
  get win() { return win; },
  get sessions() { return sessions; },
  cancelRoam: () => _roam.cancelRoam(),
  resetKeepSizeFrozen: () => resetKeepSizeFrozen(),
  // Recovery actions must defeat a stranded drag lock (syncHitWin defers while
  // it is held); see pet-window-runtime releaseStrandedDragLock.
  releaseStrandedDragLock: () => petWindowRuntime.releaseStrandedDragLock(),
  // #1260: the context menu close callback releases a lock the menu's modal
  // loop stranded (renderer normally ends the drag before the menu opens).
  get dragLocked() { return petWindowRuntime.isDragLocked(); },
  get currentSize() { return currentSize; },
  set currentSize(v) { _settingsController.applyUpdate("size", v); },
  get doNotDisturb() { return doNotDisturb; },
  get lang() { return lang; },
  set lang(v) { _settingsController.applyUpdate("lang", v); },
  get openAtLogin() { return openAtLogin; },
  set openAtLogin(v) { _settingsController.applyUpdate("openAtLogin", v); },
  get soundMuted() { return soundMuted; },
  set soundMuted(v) { _settingsController.applyUpdate("soundMuted", v); },
  get soundVolume() { return soundVolume; },
  get petHidden() { return petWindowRuntime.isPetHidden(); },
  setPetVisibility: (visible) => setPetVisibility(visible),
  bringPetToPrimaryDisplay: () => bringPetToPrimaryDisplay(),
  get isQuitting() { return isQuitting; },
  set isQuitting(v) { isQuitting = v; },
  get menuOpen() { return menuOpen; },
  set menuOpen(v) {
    if (v) _mini.cancelPendingMiniPeek(true);
    menuOpen = v;
  },
  get tray() { return tray; },
  set tray(v) { tray = v; },
  get contextMenuOwner() { return contextMenuOwner; },
  set contextMenuOwner(v) { contextMenuOwner = v; },
  get contextMenu() { return contextMenu; },
  set contextMenu(v) { contextMenu = v; },
  enableDoNotDisturb: () => enableDoNotDisturb(),
  disableDoNotDisturb: () => disableDoNotDisturb(),
  enterMiniViaMenu: () => {
    if (!disableMiniModeCached) enterMiniViaMenu();
  },
  exitMiniMode: () => exitMiniMode(),
  getDisableMiniMode: () => disableMiniModeCached,
  getMiniMode: () => _mini.getMiniMode(),
  getMiniTransitioning: () => _mini.getMiniTransitioning(),
  miniHandleResize: (sizeKey) => _mini.handleResize(sizeKey),
  openDashboard: () => showDashboard(),
  // The settings controller is the only writer of persisted prefs. Toggle
  // setters above route through it; resize/sendToDisplay use
  // flushRuntimeStateToPrefs to capture window bounds after movement.
  flushRuntimeStateToPrefs,
  settings: _settingsController,
  syncHitWin,
  repositionBubbles: () => repositionAnchoredFloatingSurfaces(),
  getPetWindowBounds,
  applyPetWindowBounds,
  getCurrentPixelSize,
  getEffectiveCurrentPixelSize,
  getPixelSizeFor,
  isProportionalMode,
  PROPORTIONAL_RATIOS,
  getHookServerPort: () => getHookServerPort(),
  clampToScreenVisual,
  getNearestWorkArea,
  getSettingsWindow,
  discoverThemes: () => themeLoader.discoverThemes(),
  getActiveThemeId: () => themeRuntime.getActiveThemeId("clawd"),
  getActiveThemeCapabilities: () => themeRuntime.getActiveThemeCapabilities(),
  ensureUserThemesDir: () => themeLoader.ensureUserThemesDir(),
  openSettingsWindow: (options) => settingsWindowRuntime.open(options),
  showTutorial: () => _tutorial.open(),
};
const _menu = require("./menu")(_menuCtx);
const { t, buildContextMenu, buildTrayMenu, rebuildAllMenus, createTray,
        showPetContextMenu, ensureContextMenuOwner } = _menu;

// ── Settings effect router ──
const SETTINGS_MIRROR_SETTERS = {
  lang: (v) => { lang = v; }, size: (v) => { currentSize = v; resetKeepSizeFrozen(); },
  openAtLogin: (v) => { openAtLogin = v; },
  sessionHudEnabled: (v) => { sessionHudEnabled = v; },
  sessionHudShowStateLabels: (v) => { sessionHudShowStateLabels = v; },
  sessionHudShowElapsed: (v) => { sessionHudShowElapsed = v; },
  sessionHudShowContextUsage: (v) => { sessionHudShowContextUsage = v; },
  sessionHudCleanupDetached: (v) => { sessionHudCleanupDetached = v; },
  sessionHudPinned: (v) => { sessionHudPinned = v; },
  sessionStaleMs: (v) => { sessionStaleMs = v; }, workingStaleMs: (v) => { workingStaleMs = v; },
  detachedIdleStaleMs: (v) => { detachedIdleStaleMs = v; },
  soundMuted: (v) => { soundMuted = v; }, soundVolume: (v) => { soundVolume = v; }, lowPowerIdleMode: (v) => { lowPowerIdleMode = v; },
  keepAwakeWhileWorking: (v) => { keepAwakeWhileWorking = v; },
  petTint: (v) => { petTint = v; },
  allowEdgePinning: (v) => { allowEdgePinningCached = v; }, disableMiniMode: (v) => { disableMiniModeCached = v; }, eyeTrackingEnabled: (v) => { eyeTrackingEnabledCached = v; }, keepSizeAcrossDisplays: (v) => { keepSizeAcrossDisplaysCached = v; resetKeepSizeFrozen(); },
  petAlwaysOnTop: (v) => {
    petAlwaysOnTopCached = v;
    applyPetAlwaysOnTopPreference();
  },
  freeRoam: (v) => { _roam.setEnabled(v); },
  textScale: (v) => { textScale = v; textScalePreview = null; },
  textScaleByDisplay: (v) => { textScaleByDisplay = v; textScalePreview = null; },
};

function updateSettingsMirrors(changes) { for (const [key, value] of Object.entries(changes)) if (SETTINGS_MIRROR_SETTERS[key]) SETTINGS_MIRROR_SETTERS[key](value); }

function reclampPetAfterEdgePinningChange() {
  if (!win || win.isDestroyed() || petWindowRuntime.isDragLocked() || _mini.getMiniMode() || _mini.getMiniTransitioning()) return;
  const clamped = computeFinalDragBounds(getPetWindowBounds(), getEffectiveCurrentPixelSize(), clampToScreenVisual);
  if (clamped) applyPetWindowBounds(clamped);
  syncHitWin();
}

const holidayAccessoryRuntime = createHolidayAccessoryRuntime({
  powerMonitor,
  getSettingsSnapshot: () => _settingsController.getSnapshot(),
  getActiveTheme: () => getActiveTheme(),
  sendToRenderer,
  onAccessoryChange: syncHitWin,
  logWarn: console.warn,
});

const settingsEffectRouter = createSettingsEffectRouter({
  settingsController: _settingsController,
  recapRuntime,
  BrowserWindow,
  updateMirrors: updateSettingsMirrors,
  sendToRenderer,
  sendDashboardI18n: () => sendDashboardI18n(),
  sendSessionHudI18n: () => sendSessionHudI18n(),
  syncWindowTitles: () => {
    settingsWindowRuntime.applyTitleToWindow();
    // syncLocalization pushes BOTH the native title AND fresh renderer state
    // (dictionary/lang), so an external language change from Settings keeps
    // the tutorial body, buttons, and document.title in sync with the new
    // language — not just the native title bar.
    _tutorial.syncLocalization();
  },
  emitSessionSnapshot: (options) => _state.emitSessionSnapshot(options),
  cleanStaleSessions: () => _state.cleanStaleSessions(),
  applyTextScale: () => applyTextScaleNow(),
  repositionFloatingBubbles: () => repositionAnchoredFloatingSurfaces(),
  syncSessionHudVisibility: () => syncSessionHudVisibility(),
  handleSessionHudPinnedChanged: (next) => {
    if (_sessionHud && typeof _sessionHud.handlePinnedChanged === "function") {
      _sessionHud.handlePinnedChanged(next);
    }
  },
  reclampPetAfterEdgePinningChange,
  // #1276: the tick owns gaze dedup state, so it also owns the enable/disable
  // transition (resend on enable, park-at-center + pointer-bridge reset on
  // disable). Runs after the mirror above already updated eyeTrackingEnabledCached.
  applyEyeTrackingEnabledChange: (enabled) => _tick.handleEyeTrackingPreferenceChange(enabled === true),
  exitMiniMode: () => exitMiniMode(),
  getMiniMode: () => _mini.getMiniMode(),
  getActiveTheme: () => getActiveTheme(),
  syncActiveThemeAppearance: () => themeRuntime.syncActiveThemeAppearance(),
  syncHitWin,
  // #509: re-rest the pet on the newly selected idle visual right away, but
  // only while actually idle — task/sleep/mini states pick it up on their
  // next natural revert instead.
  refreshIdleVisual: () => {
    if (_state.getCurrentState() !== "idle") return;
    _state.applyState("idle", _state.getSvgOverride("idle"));
  },
  refreshDisplayedVisual: refreshDisplayedVisualForLowPowerMode,
  rebuildAllMenus,
  reconcilePowerSaveBlocker,
  setRecapEnabled: (enabled) => recapRuntime.setEnabled(enabled),
  logWarn: console.warn,
});
settingsEffectRouter.start();
_settingsController.subscribeKey("discordPresence", () => {
  syncDiscordPresence("settings");
});
animationOverridesMain = createSettingsAnimationOverridesMain({
  app,
  BrowserWindow,
  dialog,
  shell,
  fs,
  path,
  themeLoader,
  settingsController: _settingsController,
  getActiveTheme: () => getActiveTheme(),
  getSettingsWindow,
  getLang: () => lang,
  getThemeReloadInProgress: () => themeRuntime.isReloadInProgress(),
  getStateRuntime: () => _state,
  sendToRenderer,
});
registerSettingsAnimationOverridesIpc({
  ipcMain,
  animationOverridesMain,
});
// ── Doctor tab IPC ──
const { registerDoctorIpc } = require("./doctor-ipc");
registerDoctorIpc({
  ipcMain,
  app,
  shell,
  server: _server,
  getPrefsSnapshot: () => _settingsController.getSnapshot(),
  getPrefsReadFailure: () => _settingsController.hasReadFailure(),
  getPrefsRecovered: () => _initialPrefsRecovered && !_settingsController.hasReadFailure(),
  getPrefsRecoveryBackupFailed: () => _initialPrefsRecoveryBackupFailed,
  getDoNotDisturb: () => doNotDisturb,
  getLocale: () => _settingsController.get("lang") || "en",
});

// ── Settings panel window ──
//
// Single-instance, non-modal, system-titlebar BrowserWindow that hosts the
// settings UI. Reuses the settings IPC registration already wired up for the
// controller. The renderer subscribes to
// settings-changed broadcasts so menu changes and panel changes stay in sync.
const SIZE_PREVIEW_KEY_RE = /^P:\d+(?:\.\d+)?$/;

function isValidSizePreviewKey(value) {
  return typeof value === "string" && SIZE_PREVIEW_KEY_RE.test(value);
}

function beginSettingsSizePreviewProtection() {
  return petWindowRuntime.beginSettingsSizePreviewProtection();
}

function endSettingsSizePreviewProtection() {
  return petWindowRuntime.endSettingsSizePreviewProtection();
}

const settingsSizePreviewSession = createSettingsSizePreviewSession({
  beginProtection: async () => {
    beginSettingsSizePreviewProtection();
  },
  endProtection: async () => {
    endSettingsSizePreviewProtection();
  },
  applyPreview: async (sizeKey) => {
    if (!isValidSizePreviewKey(sizeKey)) {
      throw new Error(`invalid preview size "${sizeKey}"`);
    }
    if (_menu && typeof _menu.resizeWindow === "function") {
      _menu.resizeWindow(sizeKey, { mode: "preview" });
    }
  },
  commitFinal: async (sizeKey) => {
    if (!isValidSizePreviewKey(sizeKey)) {
      return { status: "error", message: `invalid preview size "${sizeKey}"` };
    }
    return _settingsController.applyCommand("resizePet", sizeKey);
  },
});

registerSettingsIpc({
  ipcMain,
  app,
  BrowserWindow,
  dialog,
  shell,
  fs,
  path,
  settingsController: _settingsController,
  recapRuntime,
  themeLoader,
  getSettingsWindow,
  getActiveTheme: () => getActiveTheme(),
  getLang: () => lang,
  roamFenceSettings,
  roamFencePicker: roamFencePickerRuntime,
  settingsSizePreviewSession,
  isValidSizePreviewKey,
  previewTextScale,
  endTextScalePreview,
  getTextScaleContext: () => ({
    percent: Math.round(
      resolveTextScaleForKey(textScaleByDisplay, textScale, getSettingsDisplayKey()) * 100
    ),
  }),
  getSizeContext: getSizeSliderContext,
  sendToRenderer,
  getDoNotDisturb: () => doNotDisturb,
  getSoundMuted: () => soundMuted,
  getSoundVolume: () => soundVolume,
  getAllAgents,
  getRecentHookEvents: (options) => _server.getRecentHookEvents(options),
  showTutorial: () => {
    _tutorial.open();
    return { status: "ok" };
  },
  aboutHeroSvgPath: path.join(__dirname, "..", "assets", "svg", "clawd-about-hero.svg"),
});

registerSessionIpc({
  ipcMain,
  getSessionSnapshot: () => _state.buildSessionSnapshot(),
  getI18n: () => getDashboardI18nPayload(),
  focusSession: (sessionId, options) => focusDashboardSession(sessionId, options),
  hideSession: (sessionId) => hideDashboardSession(sessionId),
  openSessionFolder: (sessionId) => openDashboardSessionFolder(sessionId),
  setSessionAlias: (payload) => _settingsController.applyCommand("setSessionAlias", payload),
  showDashboard: (options) => showDashboard(options),
  setSessionHudPinned: (value) => {
    const result = _settingsController.applyUpdate("sessionHudPinned", !!value);
    if (result && typeof result.then === "function") {
      result
        .then((r) => {
          if (r && r.status === "error") console.warn("Clawd: failed to pin Session HUD:", r.message);
        })
        .catch((err) => console.warn("Clawd: failed to pin Session HUD:", err && err.message));
    } else if (result && result.status === "error") {
      console.warn("Clawd: failed to pin Session HUD:", result.message);
    }
  },
});

function createWindow() {
  // Read everything from the settings controller. The mirror caches above
  // (lang/size/etc.) were already initialized at module-load time, so
  // here we just need the position/mini fields plus the legacy size migration.
  let prefs = _settingsController.getSnapshot();
  // Legacy S/M/L → P:N migration. Only kicks in for prefs files that haven't
  // been touched since v0; new files always store the proportional form.
  if (SIZES[prefs.size]) {
    const wa = getPrimaryWorkAreaSafe() || SYNTHETIC_WORK_AREA;
    const px = SIZES[prefs.size].width;
    const ratio = Math.round(px / wa.width * 100);
    const migrated = `P:${Math.max(1, Math.min(75, ratio))}`;
    _settingsController.applyUpdate("size", migrated); // subscriber updates currentSize mirror
    prefs = _settingsController.getSnapshot();
  }
  const launchSizingWorkArea = getLaunchSizingWorkArea(
    prefs,
    getPrimaryWorkAreaSafe() || SYNTHETIC_WORK_AREA,
    getNearestWorkArea,
  );
  // keepSizeAcrossDisplays preserves the last realized pixel size across restarts.
  const proportionalSize = getCurrentPixelSize(launchSizingWorkArea);
  const size = getLaunchPixelSize(prefs, proportionalSize);
  // #408: seed the in-memory frozen keep-size from the realized launch size, so
  // display events reuse it instead of re-reading transiently-wrong live bounds.
  if (keepSizeAcrossDisplaysCached && isProportionalMode()) {
    keepSizeFrozenPx = { width: size.width, height: size.height };
    // #408 round-2: restore the frozen origin Wa too. Prefer the dedicated
    // savedPixelWorkArea (post-fix prefs); fall back to positionDisplay.workArea
    // for legacy prefs — the next flush will rewrite with the new field.
    const persistedOrigin = snapshotKeepSizeOriginWa(prefs.savedPixelWorkArea);
    if (persistedOrigin) {
      keepSizeFrozenOriginWa = persistedOrigin;
    } else if (prefs.positionDisplay && prefs.positionDisplay.workArea) {
      keepSizeFrozenOriginWa = snapshotKeepSizeOriginWa(prefs.positionDisplay.workArea);
    }
  }

  const {
    initialVirtualBounds,
    initialWindowBounds,
  } = petWindowRuntime.resolveStartupPlacement(prefs, size, {
    restoreMiniFromPrefs: (prefsSnapshot, pixelSize) => _mini.restoreFromPrefs(prefsSnapshot, pixelSize),
  });

  const initialAccessoryDelivery = prepareCurrentAccessorySlotsDelivery();
  petWindowRuntime.createRenderWindow({
    BrowserWindow,
    size,
    initialWindowBounds,
    initialVirtualBounds,
    preloadPath: path.join(__dirname, "preload.js"),
    loadFilePath: path.join(__dirname, "index.html"),
    themeConfig: buildRendererThemeConfig(initialAccessoryDelivery.snapshot),
    rendererConfigChannel,
    setRenderWindow: (createdWindow) => { win = createdWindow; },
    isQuitting: () => isQuitting,
    applyNoInputHint: (createdWindow) => _linuxX11InputHint.applyNoInputHint(createdWindow),
  });
  finalizePetAccessorySlotsDelivery(initialAccessoryDelivery, true);

  buildContextMenu();
  createTray();
  ensureContextMenuOwner();

  // ── Create input window (hitWin) — small rect over hitbox, receives all pointer events ──
  hitWin = petWindowRuntime.createHitWindow({
    BrowserWindow,
    preloadPath: path.join(__dirname, "preload-hit.js"),
    loadFilePath: path.join(__dirname, "hit.html"),
    hitThemeConfig: themeRuntime.getHitRendererConfig(),
    rendererConfigChannel,
    onDidFinishLoad: () => {
      const hitConfig = themeRuntime.getHitRendererConfig();
      rendererConfigChannel.setHitConfig(hitConfig);
      sendToHitWin("theme-config", hitConfig);
      if (themeRuntime.isReloadInProgress()) return;
      syncHitStateAfterLoad();
    },
    onRenderProcessGone: (details, ownedHitWin) => {
      safeConsoleError("hitWin renderer crashed:", details.reason);
      petWindowRuntime.setDragLocked(false);
      petWindowRuntime.clearDragSnapshot();
      idlePaused = false;
      mouseOverPet = false;
      petWindowRuntime.reloadWindowWebContents(ownedHitWin, { crashKey: "hitWin", details });
    },
  });

  // Issue #690 plan §4.3.9: these replace (not supplement) the previous
  // synchronous "move"/"resize" -> syncFloatingWindowsAfterPetBoundsChange()
  // wiring. Native move/resize callbacks carry no geometry and must not
  // read/write anything themselves — onNativeGeometryEvent() only
  // (re)schedules a debounced quiet-point reconcile, which is what now calls
  // syncFloatingWindowsAfterPetBoundsChange() (as syncDerivedSurfaces()) once
  // it has classified the settled geometry.
  win.on("move", () => petWindowRuntime.onNativeGeometryEvent());
  win.on("resize", () => petWindowRuntime.onNativeGeometryEvent());
  // §4.3.11: the hit window gets the same geometry-blind debounced treatment,
  // on its own (longer) HIT_QUIET_MS quiet period.
  hitWin.on("move", () => petWindowRuntime.onHitNativeGeometryEvent());
  hitWin.on("resize", () => petWindowRuntime.onHitNativeGeometryEvent());

  syncSessionHudVisibility();

  registerPetInteractionIpc({
    ipcMain,
    showContextMenu: (event) => showPetContextMenu(event),
    moveWindowForDrag: () => moveWindowForDrag(),
    setIdlePaused: (value) => { idlePaused = !!value; },
    setLowPowerIdlePaused,
    setAccessoryMirror: setAccessoryMirrored,
    isMiniTransitioning: () => _mini.getMiniTransitioning(),
    getCurrentState: () => _state.getCurrentState(),
    getCurrentSvg: () => _state.getCurrentSvg(),
    sendToRenderer,
    requestDragReaction,
    requestClickReaction,
    refreshIdleVisualAfterDrag,
    settleVisual: (event, payload) => {
      if (
        !win
        || win.isDestroyed()
        || !isTrustedMainFrameEvent(event, win.webContents)
      ) return false;
      return displayedVisualProjection.settle(payload);
    },
    setDragLocked: (value) => {
      if (value) _mini.cancelPendingMiniPeek(true);
      petWindowRuntime.setDragLocked(value);
    },
    setMouseOverPet: (value) => { mouseOverPet = !!value; },
    cancelRoam: () => _roam.cancelRoam(),
    beginDragSnapshot: () => beginDragSnapshot(),
    clearDragSnapshot: () => clearDragSnapshot(),
    syncHitWin: () => syncHitWin(),
    syncDisplayedVisualGeometry,
    isMiniMode: () => _mini.getMiniMode(),
    checkMiniModeSnap: () => checkMiniModeSnap(),
    getDisableMiniMode: () => disableMiniModeCached,
    hasPetWindow: () => !!(win && !win.isDestroyed()),
    getPetWindowBounds: () => getPetWindowBounds(),
    getKeepSizeAcrossDisplays: () => keepSizeAcrossDisplaysCached,
    getCurrentPixelSize: () => getCurrentPixelSize(),
    getEffectiveCurrentPixelSize: () => getEffectiveCurrentPixelSize(),
    computeDragEndBounds: (virtualBounds, size) =>
      computeFinalDragBounds(virtualBounds, size, clampToScreenVisual),
    applyPetWindowBounds: (bounds) => applyPetWindowBounds(bounds),
    flushRuntimeStateToPrefs: () => flushRuntimeStateToPrefs(),
    repositionFloatingBubbles: () => repositionAnchoredFloatingSurfaces(),
    exitMiniMode: () => exitMiniMode(),
    getFocusableLocalHudSessionIds: () => getFocusableLocalHudSessionIds(),
    focusLog: (message) => focusLog(message),
    showDashboard: () => showDashboard(),
    focusSession: (sessionId, options) => focusDashboardSession(sessionId, options),
    revealSessionHud: () => {
      if (_sessionHud && typeof _sessionHud.revealFromPet === "function") {
        _sessionHud.revealFromPet();
      }
    },
    statPath: (p) => fs.promises.stat(p),
    openTerminalAt: (dir) => openTerminalAt(dir),
    dropLog: (message) => console.log(`Clawd: ${message}`),
  });

  startMainTick();
  startHttpServer().catch(() => {});
  startStaleCleanup();
  // Wait for renderer to be ready before sending initial state
  // If hooks arrived during startup, respect them instead of forcing idle
  // Also handles crash recovery (render-process-gone → reload)
  win.webContents.on("did-start-loading", () => {
    setLowPowerIdlePaused(false);
    // A fresh document draws upright: no .mini-left class, no inline scale on
    // the direction stage. Keeping the old facing here would leave the hit
    // window mirrored against an unmirrored pet until something happens to
    // make the renderer report again.
    setAccessoryMirrored(false);
  });
  win.webContents.on("did-finish-load", () => {
    deliverRendererThemeConfig();
    petWindowRuntime.resendViewportOffsets();
    if (themeRuntime.isReloadInProgress()) return;
    syncRendererStateAfterLoad();
  });

  // ── Crash recovery: renderer process can die from <object> churn ──
  win.webContents.on("render-process-gone", (_event, details) => {
    safeConsoleError("Renderer crashed:", details.reason);
    setLowPowerIdlePaused(false);
    petWindowRuntime.setDragLocked(false);
    idlePaused = false;
    mouseOverPet = false;
    resetDisplayedVisualProjection("renderer-process-gone", { preserveCommitted: true });
    petWindowRuntime.reloadWindowWebContents(win, { crashKey: "renderWin", details });
  });

  // display-metrics-changed fires in bursts during DPI changes and RDP
  // reconnects, and each one re-clamps/repositions the pet — running them all
  // makes the pet visibly jitter mid-transition. Debounce the geometry handler
  // to the settled state, mirroring the textScale debounce below. (Keep
  // display-removed/added immediate: those rescue the pet off a vanished
  // display and must not be delayed.)
  let displayMetricsGeometryTimer = null;
  const reapplyDisplayGeometryAfterMetricsChange = () => {
    if (displayMetricsGeometryTimer) clearTimeout(displayMetricsGeometryTimer);
    displayMetricsGeometryTimer = setTimeout(() => {
      displayMetricsGeometryTimer = null;
      petWindowRuntime.handleDisplayMetricsChanged();
      settingsWindowRuntime.notifySizeContextChanged();
    }, 400);
  };
  // PR #751 second-review C-6 (Codex non-blocking): §4.3.14's
  // observedClampInset is only valid until the topology it was learned
  // against changes — clearing it (and invalidating the displays cache,
  // B-5) used to wait for the SAME 400ms debounce as the geometry reflow
  // above, so a burst of metrics events could keep re-arming the debounce
  // and delay the clear indefinitely while stale insets kept getting used
  // for clamp classification in the meantime. Both now run immediately, in
  // the raw event callback, decoupled from the (still debounced, to avoid
  // visible jitter) geometry reflow itself. Clearing the whole table here
  // is a safe superset of "clear the affected display's entries" —
  // Electron doesn't cheaply say WHICH display changed from this event
  // alone.
  screen.on("display-metrics-changed", () => {
    petWindowRuntime.clearObservedClampInsets();
    petWindowRuntime.invalidateDisplaysCache();
    reapplyDisplayGeometryAfterMetricsChange();
  });
  // PR #751 second-review C-4 (Codex B4): display-removed/added now also
  // clear the inset table (handleDisplayRemoved()/handleDisplayAdded()
  // themselves do this now, as their own first lines alongside their
  // existing invalidateDisplaysCache() call) — previously only
  // metrics-changed did, leaving a stale inset alive across a monitor
  // unplug/replug or a genuine topology addition.
  screen.on("display-removed", () => {
    petWindowRuntime.handleDisplayRemoved();
    settingsWindowRuntime.notifySizeContextChanged();
  });
  screen.on("display-added", () => {
    petWindowRuntime.handleDisplayAdded();
    settingsWindowRuntime.notifySizeContextChanged();
  });

  // textScale is per-display: when the topology changes, window→display
  // mappings (and therefore effective scales) can change wholesale. Debounced
  // because these events arrive in bursts during reconnects.
  let textScaleTopologyTimer = null;
  const reapplyTextScaleAfterTopologyChange = () => {
    if (textScaleTopologyTimer) clearTimeout(textScaleTopologyTimer);
    textScaleTopologyTimer = setTimeout(() => {
      textScaleTopologyTimer = null;
      applyTextScaleNow();
    }, 400);
  };
  screen.on("display-metrics-changed", reapplyTextScaleAfterTopologyChange);
  screen.on("display-removed", reapplyTextScaleAfterTopologyChange);
  screen.on("display-added", reapplyTextScaleAfterTopologyChange);
}

// Read primary display safely — getPrimaryDisplay() can also throw during
// display topology changes, so wrap it. Returns null on failure; the pure
// helpers in work-area.js will fall through to a synthetic last-resort.
function getPrimaryWorkAreaSafe() {
  try {
    const primary = screen.getPrimaryDisplay();
    return (primary && primary.workArea) || null;
  } catch {
    return null;
  }
}

function getNearestWorkArea(cx, cy) {
  return findNearestWorkArea(screen.getAllDisplays(), getPrimaryWorkAreaSafe(), cx, cy);
}

function clampToScreenVisual(x, y, w, h, options = {}) { return petWindowRuntime.clampToScreenVisual(x, y, w, h, options); }

function computeFinalDragBounds(bounds, size, clampPosition = clampToScreenVisual) {
  return petWindowRuntime.computeFinalDragBounds(bounds, size, clampPosition);
}

// ── Mini Mode — initialized here after state module ──
const _miniCtx = {
  get theme() { return getActiveTheme(); },
  get win() { return win; },
  get currentSize() { return currentSize; },
  get doNotDisturb() { return doNotDisturb; },
  set doNotDisturb(v) { doNotDisturb = v; },
  get currentState() { return _state.getCurrentState(); },
  get mouseOverPet() { return mouseOverPet; },
  get dragLocked() { return petWindowRuntime.isDragLocked(); },
  get menuOpen() { return menuOpen; },
  SIZES,
  getCurrentPixelSize,
  getEffectiveCurrentPixelSize,
  getPixelSizeFor,
  isProportionalMode,
  sendToRenderer,
  sendToHitWin,
  syncHitWin,
  applyState,
  resolveDisplayState,
  getSvgOverride,
  stopWakePoll,
  clampToScreenVisual,
  getNearestWorkArea,
  getPetWindowBounds,
  getHitRectScreen,
  applyPetWindowBounds,
  applyPetWindowPosition,
  setViewportOffsetY,
  // Issue #690 plan §4.3.10's mini transition+animation reconcile protection
  // period release point (mirrors _roamCtx's identical wiring below).
  releaseReconcileProtection: () => petWindowRuntime.releaseReconcileProtection(),
  syncSessionHudVisibility: () => syncSessionHudVisibility(),
  repositionSessionHud: () => repositionSessionHud(),
  buildContextMenu: () => buildContextMenu(),
  buildTrayMenu: () => buildTrayMenu(),
  getAnimationAssetCycleMs: (file) => {
    if (!file) return null;
    const probe = animationOverridesMain && typeof animationOverridesMain.buildAnimationAssetProbe === "function"
      ? animationOverridesMain.buildAnimationAssetProbe(file)
      : null;
    return Number.isFinite(probe && probe.assetCycleMs) && probe.assetCycleMs > 0
      ? probe.assetCycleMs
      : null;
  },
};
const _mini = require("./mini")(_miniCtx);

const { exitMiniMode, enterMiniViaMenu, miniPeekIn, miniPeekOut, checkMiniModeSnap } = _mini;

// ── Free Roam — initialized here after state and mini modules ──
const _roamCtx = {
  hasActiveSessions: anySessionInProgress,
  resolveDisplayState,
  get win() { return win; },
  get dragLocked() { return petWindowRuntime.isDragLocked(); },
  getPetWindowBounds,
  applyPetWindowBounds,
  // #569: lets roam anchor to the keep-size frozen size when that toggle is on
  getEffectiveCurrentPixelSize,
  syncHitWin: () => syncHitWin(),
  // Issue #690 plan §4.3.10's roam protection-period release point.
  releaseReconcileProtection: () => petWindowRuntime.releaseReconcileProtection(),
  repositionSessionHud: () => repositionSessionHud(),
  repositionAnchoredSurfaces: () => repositionAnchoredFloatingSurfaces(),
  getNearestWorkArea,
  clampToScreenVisual,
  getMiniMode: () => _mini.getMiniMode(),
  getCurrentState: () => _state.getCurrentState(),
  getUnattendedMs: () => {
    const mouseStillSince = _tick ? _tick._mouseStillSince : Date.now();
    return Date.now() - mouseStillSince;
  },
  getSleepTimeoutMs: () => getActiveTheme().timings.mouseSleepTimeout,
  isSizePreviewActive: () => petWindowRuntime.isSettingsSizePreviewActive(),
  isPetHidden: () => petWindowRuntime.isPetHidden(),
  isIdleActivityPlaying: () => _idleActivity.isAnimating(),
  get miniTransitioning() { return _mini.getMiniTransitioning(); },
  applyState: (state, svgOverride, opts) => _state.applyState(state, svgOverride, opts),
  setState: (state, svgOverride, opts) => _state.setState(state, svgOverride, opts),
  setRoamHeading: (headingLeft) => {
    const turned = roamHeadingLeft !== !!headingLeft;
    roamHeadingLeft = !!headingLeft;
    sendToRenderer("roam-heading", roamHeadingLeft);
    // A turn between walks keeps the "roam" state, so setState() sends no new
    // visual; re-request it when the theme has a mirrored variant to swap.
    const roamSvg = _state.getCurrentSvg();
    if (turned && _state.getCurrentState() === "roam"
      && resolveMirroredFile(getActiveTheme(), roamSvg, true) !== roamSvg) {
      sendToRenderer("state-change", "roam", roamSvg);
    }
  },
  // #810: optional roam fence — validated async loader for
  // ~/.omp-pet/roam-area.json; roam reads its in-memory cache at target pick
  // time and kicks refresh() when scheduling walks (see src/roam-fence.js).
  roamFence: roamFenceLoader,
};
const _roam = require("./roam")(_roamCtx);
// #810: resolve the fence's initial status right away so the first roam
// round doesn't have to hold on an UNKNOWN state (get() === null) when a
// fence file exists — or confirm quickly that none does.
_roamCtx.roamFence.refresh();

// Free roam: initialize from prefs and react to toggle changes
_roam.setEnabled(_settingsController.get("freeRoam") === true);
_roam.setConstrainAxis(_settingsController.get("roamConstrainAxis") === true);
try {
  _settingsController.subscribeKey("freeRoam", (value) => {
    _roam.setEnabled(value === true);
  });
  _settingsController.subscribeKey("roamConstrainAxis", (value) => {
    _roam.setConstrainAxis(value === true);
  });
} catch (err) {
  console.warn("Clawd: freeRoam subscribeKey failed:", err && err.message);
}

// ── Idle activities — decorative state beats while no agent is active (#1252) ──
// The controller keeps the logical state at "idle" and only swaps the visual,
// so every normal event path still wins. These gates mirror Free roam's plus
// the ones that make a passive animation inappropriate (sleep, low power,
// settings previews, hidden windows).
function canPlayIdleActivity() {
  if (!win || win.isDestroyed()) return false;
  if (doNotDisturb || lowPowerIdlePaused || idlePaused || menuOpen) return false;
  if (petWindowRuntime.isDragLocked()) return false;
  if (_mini.getMiniMode() || _mini.getMiniTransitioning()) return false;
  if (anySessionInProgress()) return false;
  if (petWindowRuntime.isSettingsSizePreviewActive()) return false;
  if (petWindowRuntime.isPetHidden()) return false;
  if (typeof win.isVisible === "function" && !win.isVisible()) return false;
  if (_state.isSettingsPreviewVisual()) return false;
  // Same sleep guard as Free roam: do not start a beat that the sleep
  // sequence is about to interrupt.
  const theme = getActiveTheme();
  const sleepTimeoutMs = theme && theme.timings ? theme.timings.mouseSleepTimeout : null;
  if (Number.isFinite(sleepTimeoutMs) && _tick
    && Date.now() - _tick._mouseStillSince >= sleepTimeoutMs) return false;
  return true;
}

const _idleActivity = require("./idle-activity").createIdleActivityController({
  getTheme: () => getActiveTheme(),
  getCurrentState: () => _state.getCurrentState(),
  canPlay: canPlayIdleActivity,
  restoreIdleVisual: () => _tick.restoreIdleVisual(),
  isVisualGenerationCurrent,
  sendToRenderer,
});
_idleActivity.setEnabled(_settingsController.get("idleActivities") === true);
_idleActivity.setFrequency(_settingsController.get("idleActivityFrequency"));
try {
  _settingsController.subscribeKey("idleActivities", (value) => {
    _idleActivity.setEnabled(value === true);
  });
  _settingsController.subscribeKey("idleActivityFrequency", (value) => {
    _idleActivity.setFrequency(value);
  });
} catch (err) {
  console.warn("Clawd: idleActivity subscribeKey failed:", err && err.message);
}

// Convenience getters for mini state (used throughout main.js)
Object.defineProperties(this || {}, {}); // no-op placeholder
// Mini state is accessed via _mini getters in ctx objects below

// ── Theme switching ──
//
// The settings controller calls themeRuntime.activateTheme through lazy
// injected deps. main.js remains the composition root; theme-runtime owns the
// active theme source and the cleanup/refresh/reload protocol.

// ── Single instance lock ──
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  // Another instance is already running — quit silently
  app.quit();
} else {
  // Relaunching while the pet runs is a "where is my pet?" signal.
  app.on("second-instance", () => {
    if (petWindowRuntime.isPetHidden()) {
      petWindowRuntime.setPetHidden(false);
      return;
    }
    if (win && !win.isDestroyed()) {
      win.showInactive();
      keepOutOfTaskbar(win);
    }
    if (hitWin && !hitWin.isDestroyed()) {
      hitWin.showInactive();
      keepOutOfTaskbar(hitWin);
    }
  });

  function notifyPrefsAuthorityFailure() {
    const readFailure = _settingsController.hasReadFailure();
    if (!readFailure && !_initialPrefsRecovered) return false;
    const title = translate(_initialPrefsRecoveryBackupFailed
      ? "prefsRecoveryBackupFailedNudgeTitle"
      : (readFailure ? "prefsReadFailureNudgeTitle" : "prefsRecoveredNudgeTitle"));
    const body = translate(_initialPrefsRecoveryBackupFailed
      ? "prefsRecoveryBackupFailedNudgeBody"
      : (readFailure ? "prefsReadFailureNudgeBody" : "prefsRecoveredNudgeBody"));
    const onClick = () => settingsWindowRuntime.open();
    try {
      if (Notification && typeof Notification.isSupported === "function" && Notification.isSupported()) {
        const notification = new Notification({ title, body });
        notification.once("click", onClick);
        notification.show();
        return true;
      }
    } catch (err) {
      console.warn("Clawd: preferences authority nudge failed:", err && err.message);
    }
    console.warn(`Clawd: ${body}`);
    return false;
  }

  app.whenReady().then(async () => {
    // Linux X11: Electron's getCursorScreenPoint() freezes once the cursor
    // leaves our windows; replace it with a live xcb_query_pointer for every
    // caller. Same backend check as linux-x11-input-hint. The screen module is
    // only usable after ready.
    require("./linux-x11-cursor").installLinuxX11CursorFallback(screen, {
      isLinuxX11: app.commandLine.getSwitchValue("ozone-platform") === "x11",
      displayName: app.commandLine.getSwitchValue("display"),
      onError: (err) => console.warn("omp-pet: linux-x11-cursor failed:", err && err.message),
    });

    // Import system-backed settings (openAtLogin) into prefs on first run.
    // Must run before createWindow() so the first menu draw sees the
    // hydrated value rather than the schema default.
    hydrateSystemBackedSettings();
    // First-run only: seed UI language from the device locale, before createWindow
    // so the very first menu/tray render is already in the user's language.
    hydrateFreshInstallLanguage();
    sessionDebugLog = path.join(app.getPath("userData"), "session-debug.log");
    focusDebugLog = path.join(app.getPath("userData"), "focus-debug.log");
    try { syncDiscordPresence("startup"); }
    catch (err) { console.warn("Clawd: discord presence startup failed:", err && err.message); }
    createWindow();
    try { recapRuntime.start(); }
    catch (err) { console.warn("Clawd: local recap startup failed:", err && err.code ? err.code : "storage-error"); }
    // nativeTheme reads are only used to pick an appearance, so subscribing
    // after the pet window exists keeps startup free of extra reloads. The
    // first did-finish-load repeats the resolution once because the value
    // read before app.whenReady is not guaranteed on every platform.
    systemThemeAppearanceHandler = () => themeRuntime.syncActiveThemeAppearance();
    nativeTheme.on("updated", systemThemeAppearanceHandler);
    if (win && !win.isDestroyed()) {
      win.webContents.once("did-finish-load", () => themeRuntime.syncActiveThemeAppearance());
    }
    notifyPrefsAuthorityFailure();
    holidayAccessoryRuntime.start();
    // WSL agent detection is NOT started here: scanning runs a command inside
    // every installed distro, which boots each stopped VM — too aggressive for
    // app launch. The first Settings→Agents visit triggers the scan instead
    // (see fetchAgentInstallationHints in settings-ui-core.js).
    systemWakeRecovery = createSystemWakeRecovery({
      powerMonitor,
      ipcMain,
      sendToRenderer,
      onRecovered: () => {
        setLowPowerIdlePaused(false);
        // The main mirror can already be false while the renderer still owns a
        // paused SVG. Always resend the latest cursor position after receipt.
        setForceEyeResend(true);
      },
      log: sessionLog,
      onError: (err) => safeConsoleError(
        "Clawd: system wake recovery failed:",
        err && err.message ? err.message : err
      ),
    });
    systemWakeRecovery.start();
    // First-run onboarding: anyone who has never seen the tutorial gets it once.
    // `tutorialSeen` is persisted but deliberately NOT migration-backfilled, so
    // existing users who update also see it once on their next launch, then the
    // flag flips to true forever (any dismissal counts). See prefs.js SCHEMA.
    try {
      if (!_settingsController.get("tutorialSeen")) _tutorial.open();
    } catch (err) {
      console.warn("Clawd: failed to open first-run tutorial:", err && err.message);
    }
    // Register persistent global shortcuts from the validated prefs snapshot.
    shortcutRuntime.registerPersistentShortcutsFromSettings();

  });

  app.on("before-quit", () => {
    isQuitting = true;
    if (quitCleanupStarted) return;
    quitCleanupStarted = true;
    holidayAccessoryRuntime.dispose();
    if (systemWakeRecovery) systemWakeRecovery.dispose();
    releasePowerSaveBlocker();
    flushRuntimeStateToPrefs();
    globalShortcut.unregisterAll();
    void settingsSizePreviewSession.cleanup();
    roamFencePickerRuntime.dispose();
    if (discordPresenceBridge) discordPresenceBridge.stop();
    _server.cleanup();
    if (displayedVisualProjection) displayedVisualProjection.dispose();
    try { recapRuntime.dispose(); } catch {}
    _state.cleanup();
    _tick.cleanup();
    _mini.cleanup();
    _sessionHud.cleanup();
    agentRuntime.cleanup();
    themeRuntime.cleanup();
    if (systemThemeAppearanceHandler) {
      nativeTheme.removeListener("updated", systemThemeAppearanceHandler);
      systemThemeAppearanceHandler = null;
    }
    if (animationOverridesMain) animationOverridesMain.cleanup();
    if (hitWin && !hitWin.isDestroyed()) hitWin.destroy();
  });

  app.on("window-all-closed", () => {
    if (!isQuitting) return;
    app.quit();
  });
}
