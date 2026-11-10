"use strict";

const {
  getPetTintIdForTheme,
  resolvePetTintPayload,
  getPetMouthAccessoryIdForTheme,
  buildPetAccessorySlotsCandidate,
} = require("./pet-customization-catalog");
const {
  getEffectivePetAccessoryIdForTheme,
} = require("./holiday-accessory");
const {
  commitPetAccessorySlotsCandidate,
  describeGeometrySync,
  setPetAccessoryFloatingSurfaceRepositioner,
  repositionPetAccessoryFloatingSurfaces,
} = require("./pet-accessory-state");

const MENU_AFFECTING_KEYS = new Set([
  "lang",
  "soundMuted",
  "openAtLogin",
  "theme",
  "size",
  "sessionAliases",
  "disableMiniMode",
]);

function requiredDependency(value, name) {
  if (!value) throw new Error(`createSettingsEffectRouter requires ${name}`);
  return value;
}

function noop() {}

function warn(logWarn, message, err) {
  try {
    logWarn(message, err && err.message);
  } catch {}
}

function safeCall(logWarn, message, fn, ...args) {
  if (typeof fn !== "function") return undefined;
  try {
    return fn(...args);
  } catch (err) {
    warn(logWarn, message, err);
    return undefined;
  }
}

function createSettingsEffectRouter(options = {}) {
  const settingsController = requiredDependency(options.settingsController, "settingsController");
  const BrowserWindow = options.BrowserWindow || { getAllWindows: () => [] };
  const logWarn = options.logWarn || console.warn;
  const updateMirrors = options.updateMirrors || noop;
  const sendToRenderer = options.sendToRenderer || noop;
  const sendDashboardI18n = options.sendDashboardI18n || noop;
  const sendSessionHudI18n = options.sendSessionHudI18n || noop;
  const syncWindowTitles = options.syncWindowTitles || noop;
  const emitSessionSnapshot = options.emitSessionSnapshot || noop;
  const cleanStaleSessions = options.cleanStaleSessions || noop;
  const refreshPendingAttention = options.refreshPendingAttention || noop;
  const repositionFloatingBubbles = options.repositionFloatingBubbles || noop;
  const applyTextScale = options.applyTextScale || noop;
  const syncSessionHudVisibility = options.syncSessionHudVisibility || noop;
  const handleSessionHudPinnedChanged = options.handleSessionHudPinnedChanged || noop;
  const reclampPetAfterEdgePinningChange = options.reclampPetAfterEdgePinningChange || noop;
  const applyEyeTrackingEnabledChange = options.applyEyeTrackingEnabledChange || noop;
  const exitMiniMode = options.exitMiniMode || noop;
  const getMiniMode = options.getMiniMode || (() => false);
  const getActiveTheme = options.getActiveTheme || (() => null);
  const syncActiveThemeAppearance = options.syncActiveThemeAppearance || noop;
  const syncHitWin = options.syncHitWin || noop;
  const refreshIdleVisual = options.refreshIdleVisual || noop;
  const refreshDisplayedVisual = options.refreshDisplayedVisual || noop;
  const rebuildAllMenus = options.rebuildAllMenus || noop;
  const reconcilePowerSaveBlocker = options.reconcilePowerSaveBlocker || noop;
  const setRecapEnabled = options.setRecapEnabled || noop;
  const now = options.now || (() => new Date());

  setPetAccessoryFloatingSurfaceRepositioner(repositionFloatingBubbles);

  let started = false;
  let unsubscribeSettings = null;
  let unsubscribeShortcuts = null;
  let lastTogglePetShortcut = ((settingsController.getSnapshot().shortcuts) || {}).togglePet || null;

  function applyAccessoryCandidate(activeTheme, snapshot) {
    const themeId = activeTheme && activeTheme._id;
    const headId = getEffectivePetAccessoryIdForTheme({
      petAccessory: snapshot.petAccessory,
      holidayAccessoryEnabled: snapshot.holidayAccessoryEnabled,
      themeId,
      date: now(),
    });
    const mouthId = getPetMouthAccessoryIdForTheme(snapshot.petMouthAccessory, themeId);
    const candidate = buildPetAccessorySlotsCandidate({ headId, mouthId }, activeTheme);
    try {
      if (sendToRenderer("pet-accessory-slots-change", candidate) === false) {
        throw new Error("renderer unavailable");
      }
    } catch (err) {
      warn(logWarn, "omp-pet: accessory renderer delivery failed:", err);
      return false;
    }

    commitPetAccessorySlotsCandidate(candidate);
    try {
      const geometry = describeGeometrySync(syncHitWin());
      if (!geometry.applied) {
        // Deferred is not a failure: the payload is already canonical, so the
        // next sync (drag release, window show, next move) picks up the new
        // envelope on its own. Warning here would fire every time the user
        // changes a hat while holding the pet.
        if (geometry.deferred) return true;
        throw new Error("native hit geometry was not applied");
      }
      repositionPetAccessoryFloatingSurfaces();
      return true;
    } catch (err) {
      warn(logWarn, "omp-pet: accessory geometry apply failed:", err);
      return false;
    }
  }

  function handleSettingsChange({ changes } = {}) {
    if (!changes || typeof changes !== "object") return;

    // 1. Update mirror caches first so any side-effect handler reads fresh values.
    updateMirrors(changes);

    if ("lowPowerIdleMode" in changes) {
      sendToRenderer("low-power-idle-mode-change", changes.lowPowerIdleMode);
      // The renderer owns the media-channel substitution, but main must own
      // the request generation and settlement. Re-request only after the mode
      // IPC so the next state-change resolves against the new low-power flag.
      safeCall(logWarn, "omp-pet: low-power visual refresh failed:", refreshDisplayedVisual);
      // If the HUD was already hidden when low-power mode was enabled,
      // no visibility transition would otherwise schedule their delayed
      // destruction. Re-sync after mirrors update so hidden windows are
      // reclaimed under the new policy.
      safeCall(
        logWarn,
        "omp-pet: low-power Session HUD sync failed:",
        syncSessionHudVisibility
      );
    }
    if ("petTint" in changes) {
      const activeTheme = getActiveTheme();
      const tintId = getPetTintIdForTheme(changes.petTint, activeTheme && activeTheme._id);
      sendToRenderer("pet-tint-change", resolvePetTintPayload(tintId, activeTheme));
    }
    if ("themeAppearance" in changes) {
      // Prefs are already committed here, so the runtime reads the new value
      // itself; no appearance argument needs to be threaded through commands.
      safeCall(logWarn, "omp-pet: theme appearance sync failed:", syncActiveThemeAppearance);
    }
    if (
      "petAccessory" in changes
      || "petMouthAccessory" in changes
      || "holidayAccessoryEnabled" in changes
    ) {
      const activeTheme = getActiveTheme();
      const snapshot = settingsController.getSnapshot();
      applyAccessoryCandidate(activeTheme, snapshot);
    }
    if ("keepAwakeWhileWorking" in changes) {
      safeCall(logWarn, "omp-pet: reconcilePowerSaveBlocker failed:", reconcilePowerSaveBlocker);
    }
    if ("recapEnabled" in changes) {
      safeCall(logWarn, "omp-pet: recap recording toggle failed:", setRecapEnabled, changes.recapEnabled);
    }
    if ("lang" in changes) {
      safeCall(logWarn, "omp-pet: dashboard lang broadcast failed:", sendDashboardI18n);
      safeCall(logWarn, "omp-pet: session HUD lang broadcast failed:", sendSessionHudI18n);
      safeCall(logWarn, "omp-pet: window title sync failed:", syncWindowTitles);
    }
    // Localized display labels live in snapshots. Refresh after mirrors and
    // dictionaries, also coalescing a simultaneous alias change into one send.
    if ("lang" in changes || "sessionAliases" in changes || "agents" in changes) {
      safeCall(
        logWarn,
        "omp-pet: session title snapshot broadcast failed:",
        emitSessionSnapshot,
        { force: true }
      );
    }
    // 2. Reactive side effects.
    if ("agents" in changes) {
      safeCall(logWarn, "omp-pet: pending attention refresh failed:", refreshPendingAttention);
    }
    if ("textScale" in changes || "textScaleByDisplay" in changes) {
      // applyTextScale owns the whole cascade: per-display zoom on live text
      // windows, fixed-width window resize, and HUD repositioning.
      safeCall(logWarn, "omp-pet: applyTextScale failed:", applyTextScale);
    }
    if ("sessionHudPinned" in changes) {
      // Pinned transitions are handled inside session-hud.js so the visible
      // state can be inspected BEFORE the new mirror takes effect during a
      // generic sync. handlePinnedChanged internally calls syncSessionHud,
      // which triggers reposition via the reserved-offset callback, so there is no
      // need to call repositionFloatingBubbles here as well.
      try {
        handleSessionHudPinnedChanged(changes.sessionHudPinned);
      } catch (err) {
        warn(logWarn, "omp-pet: session HUD pinned change failed:", err);
      }
    }
    if (
      "sessionHudEnabled" in changes
      || "sessionHudShowStateLabels" in changes
      || "sessionHudShowElapsed" in changes
    ) {
      try {
        syncSessionHudVisibility();
        repositionFloatingBubbles();
      } catch (err) {
        warn(logWarn, "omp-pet: session HUD setting sync failed:", err);
      }
    }
    if ("sessionHudCleanupDetached" in changes && changes.sessionHudCleanupDetached === true) {
      try {
        cleanStaleSessions();
        emitSessionSnapshot({ force: true });
      } catch (err) {
        warn(logWarn, "omp-pet: detached session cleanup sweep failed:", err);
      }
    } else if ("sessionHudCleanupDetached" in changes) {
      safeCall(
        logWarn,
        "omp-pet: detached session cleanup snapshot refresh failed:",
        emitSessionSnapshot,
        { force: true }
      );
    }
    if (
      "sessionStaleMs" in changes
      || "workingStaleMs" in changes
      || "detachedIdleStaleMs" in changes
    ) {
      try {
        cleanStaleSessions();
        emitSessionSnapshot({ force: true });
      } catch (err) {
        warn(logWarn, "omp-pet: stale cleanup config refresh failed:", err);
      }
    }
    if ("allowEdgePinning" in changes) {
      safeCall(
        logWarn,
        "omp-pet: allowEdgePinning re-clamp failed:",
        reclampPetAfterEdgePinningChange
      );
    }
    if ("disableMiniMode" in changes && changes.disableMiniMode && getMiniMode()) {
      safeCall(logWarn, "omp-pet: disableMiniMode exit failed:", exitMiniMode);
    }
    if ("eyeTrackingEnabled" in changes) {
      // #1276: park the gaze forward (or force a resend when re-enabled) so
      // the toggle applies without waiting for the next cursor move.
      safeCall(
        logWarn,
        "omp-pet: eyeTrackingEnabled change failed:",
        applyEyeTrackingEnabledChange,
        changes.eyeTrackingEnabled
      );
    }
    if ("idleVisual" in changes) {
      safeCall(logWarn, "omp-pet: idle visual refresh failed:", refreshIdleVisual);
    }

    // 3. Menu rebuild: only for menu-affecting keys to avoid thrashing on
    // window position / mini state changes.
    for (const key of Object.keys(changes)) {
      if (MENU_AFFECTING_KEYS.has(key)) {
        safeCall(logWarn, "omp-pet: rebuildAllMenus failed:", rebuildAllMenus);
        break;
      }
    }

    // 4. Broadcast to all renderer windows for the future settings panel.
    try {
      for (const bw of BrowserWindow.getAllWindows()) {
        if (!bw.isDestroyed() && bw.webContents && !bw.webContents.isDestroyed()) {
          bw.webContents.send("settings-changed", {
            changes,
            snapshot: settingsController.getSnapshot(),
          });
        }
      }
    } catch (err) {
      warn(logWarn, "omp-pet: settings-changed broadcast failed:", err);
    }
  }

  function handleShortcutsChange(_value, snapshot) {
    const nextTogglePetShortcut = (snapshot && snapshot.shortcuts && snapshot.shortcuts.togglePet) || null;
    if (nextTogglePetShortcut === lastTogglePetShortcut) return;
    lastTogglePetShortcut = nextTogglePetShortcut;
    safeCall(logWarn, "omp-pet: rebuildAllMenus failed:", rebuildAllMenus);
  }

  function start() {
    if (started) return;
    started = true;
    unsubscribeSettings = settingsController.subscribe(handleSettingsChange);
    unsubscribeShortcuts = settingsController.subscribeKey("shortcuts", handleShortcutsChange);
  }

  function dispose() {
    if (typeof unsubscribeShortcuts === "function") unsubscribeShortcuts();
    if (typeof unsubscribeSettings === "function") unsubscribeSettings();
    unsubscribeShortcuts = null;
    unsubscribeSettings = null;
    started = false;
  }

  return {
    start,
    dispose,
  };
}

module.exports = createSettingsEffectRouter;
module.exports.MENU_AFFECTING_KEYS = MENU_AFFECTING_KEYS;
