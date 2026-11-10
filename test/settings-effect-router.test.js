"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const createSettingsEffectRouter = require("../src/settings-effect-router");
const {
  getPetAccessorySlotsSnapshot,
  resetPetAccessoryStateForTests,
} = require("../src/pet-accessory-state");

function createFakeSettingsController(initialSnapshot = {}) {
  let snapshot = { shortcuts: {}, ...initialSnapshot };
  const subscribers = new Set();
  const keySubscribers = new Set();
  const controller = {
    getSnapshot: () => ({ ...snapshot }),
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    subscribeKey(key, fn) {
      const entry = { key, fn };
      keySubscribers.add(entry);
      return () => keySubscribers.delete(entry);
    },
  };

  function emit(changes) {
    snapshot = { ...snapshot, ...changes };
    const event = { changes, snapshot: { ...snapshot } };
    for (const fn of [...subscribers]) fn(event);
    for (const entry of [...keySubscribers]) {
      if (entry.key in changes) entry.fn(changes[entry.key], { ...snapshot });
    }
  }

  return { controller, emit };
}

function createHarness(options = {}) {
  resetPetAccessoryStateForTests();
  const calls = [];
  const logs = [];
  const { controller, emit } = createFakeSettingsController(options.initialSnapshot);
  const router = createSettingsEffectRouter({
    settingsController: controller,
    BrowserWindow: options.BrowserWindow || { getAllWindows: () => [] },
    updateMirrors: (changes) => calls.push(["updateMirrors", { ...changes }]),
    createTray: () => calls.push(["createTray"]),
    destroyTray: () => calls.push(["destroyTray"]),
    applyDockVisibility: () => calls.push(["applyDockVisibility"]),
    sendToRenderer: (...args) => calls.push(["sendToRenderer", ...args]),
    sendDashboardI18n: () => calls.push(["sendDashboardI18n"]),
    sendSessionHudI18n: () => calls.push(["sendSessionHudI18n"]),
    syncWindowTitles: () => calls.push(["syncWindowTitles"]),
    emitSessionSnapshot: (...args) => calls.push(["emitSessionSnapshot", ...args]),
    cleanStaleSessions: () => calls.push(["cleanStaleSessions"]),
    syncPermissionShortcuts: () => calls.push(["syncPermissionShortcuts"]),
    dismissInteractivePermissionBubbles: () => calls.push(["dismissInteractivePermissionBubbles"]),
    clearCodexNotifyBubbles: (...args) => calls.push(["clearCodexNotifyBubbles", ...args]),
    clearCodexUserInputBubbles: (...args) => calls.push(["clearCodexUserInputBubbles", ...args]),
    clearKimiNotifyBubbles: (...args) => calls.push(["clearKimiNotifyBubbles", ...args]),
    clearKiroDesktopReminderCards: (...args) => calls.push(["clearKiroDesktopReminderCards", ...args]),
    refreshPassiveNotifyAutoClose: () => calls.push(["refreshPassiveNotifyAutoClose"]),
    hideUpdateBubbleForPolicy: () => calls.push(["hideUpdateBubbleForPolicy"]),
    refreshUpdateBubbleAutoClose: () => calls.push(["refreshUpdateBubbleAutoClose"]),
    repositionFloatingBubbles: () => calls.push(["repositionFloatingBubbles"]),
    applyTextScale: () => calls.push(["applyTextScale"]),
    syncSessionHudVisibility: () => calls.push(["syncSessionHudVisibility"]),
    refreshDisplayedVisual: () => calls.push(["refreshDisplayedVisual"]),
    handleSessionHudPinnedChanged: (next) => calls.push(["handleSessionHudPinnedChanged", next]),
    reclampPetAfterEdgePinningChange: () => calls.push(["reclampPetAfterEdgePinningChange"]),
    rebuildAllMenus: () => calls.push(["rebuildAllMenus"]),
    reconcilePowerSaveBlocker: () => calls.push(["reconcilePowerSaveBlocker"]),
    logWarn: (...args) => logs.push(args),
    ...(options.routerOptions || {}),
  });
  router.start();
  return { calls, logs, emit, router };
}

function makeWindow(name, calls, options = {}) {
  return {
    isDestroyed: () => !!options.destroyed,
    webContents: options.noWebContents ? null : {
      isDestroyed: () => !!options.webContentsDestroyed,
      send: (...args) => calls.push(["windowSend", name, ...args]),
    },
  };
}

describe("settings-effect-router", () => {

  it("routes textScale and textScaleByDisplay changes to applyTextScale without a menu rebuild", () => {
    const { calls, emit } = createHarness();

    emit({ textScale: 1.25 });
    assert.deepStrictEqual(calls, [
      ["updateMirrors", { textScale: 1.25 }],
      ["applyTextScale"],
    ]);

    calls.length = 0;
    emit({ textScaleByDisplay: { "1": 1.35 } });
    assert.deepStrictEqual(calls, [
      ["updateMirrors", { textScaleByDisplay: { "1": 1.35 } }],
      ["applyTextScale"],
    ]);
  });

  it("reconciles the power save blocker when keepAwakeWhileWorking changes", () => {
    const { calls, emit } = createHarness();

    emit({ keepAwakeWhileWorking: true });
    assert.deepStrictEqual(calls, [
      ["updateMirrors", { keepAwakeWhileWorking: true }],
      ["reconcilePowerSaveBlocker"],
    ]);

    calls.length = 0;
    emit({ keepAwakeWhileWorking: false });
    assert.deepStrictEqual(calls, [
      ["updateMirrors", { keepAwakeWhileWorking: false }],
      ["reconcilePowerSaveBlocker"],
    ]);
  });

  it("re-syncs hidden HUD windows when low-power mode changes", () => {
    const { calls, emit } = createHarness();
    emit({ lowPowerIdleMode: true });
    assert.deepStrictEqual(calls, [
      ["updateMirrors", { lowPowerIdleMode: true }],
      ["sendToRenderer", "low-power-idle-mode-change", true],
      ["refreshDisplayedVisual"],
      ["syncSessionHudVisibility"],
    ]);
  });

  it("orders combined HUD changes as handlePinnedChanged before generic sync", () => {
    const { calls, emit } = createHarness();

    emit({ sessionHudPinned: true, sessionHudEnabled: true });
    assert.deepStrictEqual(calls, [
      ["updateMirrors", { sessionHudPinned: true, sessionHudEnabled: true }],
      ["handleSessionHudPinnedChanged", true],
      ["syncSessionHudVisibility"],
      ["repositionFloatingBubbles"],
    ]);
  });

  it("delegates edge pinning changes to one injected reclamp helper", () => {
    const { calls, emit } = createHarness();

    emit({ allowEdgePinning: false });

    assert.deepStrictEqual(calls, [
      ["updateMirrors", { allowEdgePinning: false }],
      ["reclampPetAfterEdgePinningChange"],
    ]);
  });

  it("delegates eye tracking changes to the injected tick transition (#1276)", () => {
    const { calls, emit } = createHarness({
      routerOptions: {
        applyEyeTrackingEnabledChange: (enabled) => calls.push(["applyEyeTrackingEnabledChange", enabled]),
      },
    });

    emit({ eyeTrackingEnabled: false });

    assert.deepStrictEqual(calls, [
      ["updateMirrors", { eyeTrackingEnabled: false }],
      ["applyEyeTrackingEnabledChange", false],
    ]);
  });

  it("exits current mini mode when mini mode is disabled", () => {
    const { calls, emit } = createHarness({
      routerOptions: {
        getMiniMode: () => true,
        exitMiniMode: () => calls.push(["exitMiniMode"]),
      },
    });

    emit({ disableMiniMode: true });

    assert.deepStrictEqual(calls, [
      ["updateMirrors", { disableMiniMode: true }],
      ["exitMiniMode"],
      ["rebuildAllMenus"],
    ]);
  });

  it("does not enter mini mode when mini mode is re-enabled", () => {
    const { calls, emit } = createHarness({
      routerOptions: {
        getMiniMode: () => false,
        exitMiniMode: () => calls.push(["exitMiniMode"]),
      },
    });

    emit({ disableMiniMode: false });

    assert.deepStrictEqual(calls, [
      ["updateMirrors", { disableMiniMode: false }],
      ["rebuildAllMenus"],
    ]);
  });

  // #509: idleVisual changes re-rest the pet without rebuilding menus.
  it("refreshes the idle visual on idleVisual changes, without a menu rebuild", () => {
    const { calls, emit } = createHarness({
      routerOptions: {
        refreshIdleVisual: () => calls.push(["refreshIdleVisual"]),
      },
    });

    emit({ idleVisual: { clawd: "clawd-idle-reading.svg" } });

    assert.deepStrictEqual(calls, [
      ["updateMirrors", { idleVisual: { clawd: "clawd-idle-reading.svg" } }],
      ["refreshIdleVisual"],
    ]);
  });

  it("rebuilds menus only once for menu-affecting keys", () => {
    const { calls, emit } = createHarness();

    emit({ soundVolume: 0.5 });
    assert.strictEqual(calls.some((call) => call[0] === "rebuildAllMenus"), false);

    calls.length = 0;
    emit({ theme: "calico", size: "M" });
    assert.deepStrictEqual(calls, [
      ["updateMirrors", { theme: "calico", size: "M" }],
      ["rebuildAllMenus"],
    ]);
  });

  it("resolves the active theme's tint without rebuilding quick menus", () => {
    const clawd = { _id: "clawd", _builtin: true, _capabilities: { petTint: true } };
    const { calls, emit } = createHarness({
      routerOptions: { getActiveTheme: () => clawd },
    });

    emit({ petTint: { clawd: "gold", cloudling: "matcha" } });
    assert.deepStrictEqual(calls, [
      ["updateMirrors", { petTint: { clawd: "gold", cloudling: "matcha" } }],
      ["sendToRenderer", "pet-tint-change", {
        id: "gold",
        filter: "sepia(0.8) saturate(2.2) hue-rotate(-18deg) brightness(1.05)",
      }],
    ]);

    calls.length = 0;
    emit({ petTint: { cloudling: "vaporwave" } });
    assert.deepStrictEqual(calls, [
      ["updateMirrors", { petTint: { cloudling: "vaporwave" } }],
      ["sendToRenderer", "pet-tint-change", { id: "none", filter: "" }],
    ]);
  });

  it("uses the active theme's pet tint policy", () => {
    let activeTheme = {
      _id: "calico",
      _builtin: true,
      _capabilities: { petTint: false },
    };
    const { calls, emit } = createHarness({
      routerOptions: { getActiveTheme: () => activeTheme },
    });

    emit({ petTint: { calico: "vaporwave" } });
    assert.deepStrictEqual(calls[1], [
      "sendToRenderer",
      "pet-tint-change",
      { id: "none", filter: "" },
    ]);

    calls.length = 0;
    activeTheme = {
      _id: "cloudling",
      _builtin: true,
      _capabilities: { petTint: true },
    };
    emit({ petTint: { cloudling: "vaporwave" } });
    assert.deepStrictEqual(calls[1], [
      "sendToRenderer",
      "pet-tint-change",
      {
        id: "vaporwave",
        filter: "hue-rotate(75deg) saturate(1.25) brightness(1)",
      },
    ]);
  });

  it("resolves the active theme's accessory without rebuilding quick menus", () => {
    let activeTheme = {
      _id: "clawd",
      _builtin: true,
      _capabilities: { accessories: true },
    };
    const { calls, emit } = createHarness({
      routerOptions: { getActiveTheme: () => activeTheme },
    });

    emit({ petAccessory: { clawd: "wizard-hat", cloudling: "halo" } });
    assert.deepStrictEqual(calls, [
      ["updateMirrors", { petAccessory: { clawd: "wizard-hat", cloudling: "halo" } }],
      ["sendToRenderer", "pet-accessory-slots-change", {
        themeId: "clawd",
        payloads: {
          head: {
            id: "wizard-hat",
            assetFile: "wizard-hat.svg",
            aspect: 15 / 16,
            widthScale: 0.95,
            offsetY: 0.3,
          },
          mouth: { id: "none", assetFile: null, aspect: 1, widthScale: 1, offsetY: 0 },
        },
        accessoryGeneration: 1,
      }],
      ["repositionFloatingBubbles"],
    ]);

    calls.length = 0;
    activeTheme = {
      _id: "calico",
      _builtin: true,
      _capabilities: { accessories: false },
    };
    emit({ petAccessory: { calico: "halo" } });
    assert.deepStrictEqual(calls, [
      ["updateMirrors", { petAccessory: { calico: "halo" } }],
      ["sendToRenderer", "pet-accessory-slots-change", {
        themeId: "calico",
        payloads: {
          head: { id: "none", assetFile: null, aspect: 1, widthScale: 1, offsetY: 0 },
          mouth: { id: "none", assetFile: null, aspect: 1, widthScale: 1, offsetY: 0 },
        },
        accessoryGeneration: 2,
      }],
      ["repositionFloatingBubbles"],
    ]);
    assert.strictEqual(calls.some((call) => call[0] === "rebuildAllMenus"), false);
  });

  it("temporarily resolves the holiday accessory from an independent opt-in", () => {
    const clawd = {
      _id: "clawd",
      _builtin: true,
      _capabilities: { accessories: true },
    };
    const { calls, emit } = createHarness({
      initialSnapshot: {
        petAccessory: { clawd: "wizard-hat" },
        holidayAccessoryEnabled: {},
      },
      routerOptions: {
        getActiveTheme: () => clawd,
        now: () => new Date(2026, 11, 24, 12, 0, 0, 0),
      },
    });

    emit({ holidayAccessoryEnabled: { clawd: true } });
    assert.deepStrictEqual(calls[1], [
      "sendToRenderer",
      "pet-accessory-slots-change",
      {
        themeId: "clawd",
        payloads: {
          head: {
            id: "santa-hat",
            assetFile: "santa-hat.svg",
            aspect: 16 / 9,
            widthScale: 1,
            offsetY: 0.2,
          },
          mouth: { id: "none", assetFile: null, aspect: 1, widthScale: 1, offsetY: 0 },
        },
        accessoryGeneration: 1,
      },
    ]);

    calls.length = 0;
    emit({ petAccessory: { clawd: "halo" } });
    assert.strictEqual(calls[1][2].payloads.head.id, "santa-hat");

    calls.length = 0;
    emit({ holidayAccessoryEnabled: {} });
    assert.strictEqual(calls[1][2].payloads.head.id, "halo");
    assert.strictEqual(calls.some((call) => call[0] === "rebuildAllMenus"), false);
  });

  it("delivers a complete atomic snapshot when only the mouth selection changes", () => {
    const clawd = {
      _id: "clawd",
      _builtin: true,
      _capabilities: { accessories: true, mouthAccessories: true },
    };
    const { calls, emit } = createHarness({
      initialSnapshot: { petAccessory: { clawd: "top-hat" } },
      routerOptions: { getActiveTheme: () => clawd },
    });

    emit({ petMouthAccessory: { clawd: "cigarette" } });
    assert.strictEqual(calls[1][0], "sendToRenderer");
    assert.strictEqual(calls[1][1], "pet-accessory-slots-change");
    assert.strictEqual(calls[1][2].payloads.head.id, "top-hat");
    assert.strictEqual(calls[1][2].payloads.mouth.id, "cigarette");
    assert.strictEqual(calls[1][2].accessoryGeneration, 1);
    assert.strictEqual(getPetAccessorySlotsSnapshot(clawd), calls[1][2]);
  });

  it("does not commit or resize when renderer delivery rejects a slots candidate", () => {
    const clawd = {
      _id: "clawd",
      _builtin: true,
      _capabilities: { accessories: true, mouthAccessories: true },
    };
    const { calls, logs, emit } = createHarness({
      routerOptions: {
        getActiveTheme: () => clawd,
        sendToRenderer: (...args) => {
          calls.push(["sendToRenderer", ...args]);
          return false;
        },
        syncHitWin: () => calls.push(["syncHitWin"]),
      },
    });

    emit({ petMouthAccessory: { clawd: "cigarette" } });
    assert.strictEqual(getPetAccessorySlotsSnapshot(clawd), null);
    assert.strictEqual(calls.some((call) => call[0] === "syncHitWin"), false);
    assert.strictEqual(logs.length, 1);
    assert.match(String(logs[0][0]), /renderer delivery failed/);
  });

  it("resizes the input window after the effective accessory changes", () => {
    const clawd = {
      _id: "clawd",
      _builtin: true,
      _capabilities: { accessories: true },
    };
    const { calls, emit } = createHarness({
      routerOptions: {
        getActiveTheme: () => clawd,
        syncHitWin: () => calls.push(["syncHitWin"]),
      },
    });

    emit({ petAccessory: { clawd: "top-hat" } });
    assert.deepStrictEqual(calls.map((call) => call[0]), [
      "updateMirrors",
      "sendToRenderer",
      "syncHitWin",
      "repositionFloatingBubbles",
    ]);
  });

  it("stays quiet when the hit window defers, e.g. changing hats mid-drag", () => {
    const clawd = { _id: "clawd", _builtin: true, _capabilities: { accessories: true } };
    const { calls, logs, emit } = createHarness({
      routerOptions: {
        getActiveTheme: () => clawd,
        syncHitWin: () => {
          calls.push(["syncHitWin"]);
          return { applied: false, deferred: true };
        },
      },
    });

    emit({ petAccessory: { clawd: "top-hat" } });

    // The renderer still gets the new hat and the canonical payload is already
    // committed, so the next sync applies the envelope. Nothing failed.
    assert.deepStrictEqual(calls.map((call) => call[0]), [
      "updateMirrors",
      "sendToRenderer",
      "syncHitWin",
    ]);
    assert.deepStrictEqual(logs, []);
  });

  it("warns only when the hit window genuinely could not be resolved", () => {
    const clawd = { _id: "clawd", _builtin: true, _capabilities: { accessories: true } };
    const { logs, emit } = createHarness({
      routerOptions: {
        getActiveTheme: () => clawd,
        syncHitWin: () => ({ applied: false, deferred: false }),
      },
    });

    emit({ petAccessory: { clawd: "top-hat" } });

    assert.strictEqual(logs.length, 1);
    assert.match(String(logs[0][0]), /accessory geometry apply failed/);
  });

  it("broadcasts settings changes only to live renderer windows", () => {
    const calls = [];
    const windows = [
      makeWindow("live", calls),
      makeWindow("destroyed", calls, { destroyed: true }),
      makeWindow("web-destroyed", calls, { webContentsDestroyed: true }),
      makeWindow("no-webcontents", calls, { noWebContents: true }),
    ];
    const { emit } = createHarness({
      BrowserWindow: { getAllWindows: () => windows },
      routerOptions: {
        updateMirrors: () => {},
      },
    });

    emit({ soundVolume: 0.25 });

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0][0], "windowSend");
    assert.strictEqual(calls[0][1], "live");
    assert.strictEqual(calls[0][2], "settings-changed");
    assert.deepStrictEqual(calls[0][3].changes, { soundVolume: 0.25 });
    assert.strictEqual(calls[0][3].snapshot.soundVolume, 0.25);
  });

  it("rebuilds shortcut menus only when the toggle-pet shortcut changes", () => {
    const { calls, emit } = createHarness({
      initialSnapshot: { shortcuts: { togglePet: "Ctrl+A" } },
    });

    emit({ shortcuts: { togglePet: "Ctrl+A", openDashboard: "Ctrl+D" } });
    assert.strictEqual(calls.some((call) => call[0] === "rebuildAllMenus"), false);

    calls.length = 0;
    emit({ shortcuts: { togglePet: "Ctrl+B" } });
    assert.deepStrictEqual(calls, [
      ["updateMirrors", { shortcuts: { togglePet: "Ctrl+B" } }],
      ["rebuildAllMenus"],
    ]);

    calls.length = 0;
    emit({ shortcuts: { togglePet: "Ctrl+B", openSettings: "Ctrl+S" } });
    assert.deepStrictEqual(calls, [
      ["updateMirrors", { shortcuts: { togglePet: "Ctrl+B", openSettings: "Ctrl+S" } }],
    ]);
  });

  it("dispose unsubscribes both settings routes", () => {
    const { calls, emit, router } = createHarness();

    router.dispose();
    emit({ theme: "calico", shortcuts: { togglePet: "Ctrl+Shift+P" } });

    assert.deepStrictEqual(calls, []);
  });
});

describe("issue #1323: theme appearance routing", () => {
  it("issue #1323: commits route themeAppearance to the appearance sync", () => {
    const synced = [];
    const { emit } = createHarness({
      routerOptions: {
        syncActiveThemeAppearance: () => synced.push("sync"),
      },
    });

    emit({ themeAppearance: { night: "dark" } });

    assert.deepStrictEqual(synced, ["sync"]);
  });

  it("issue #1323: a throwing appearance sync is contained by safeCall", () => {
    const { emit, logs } = createHarness({
      routerOptions: {
        syncActiveThemeAppearance: () => {
          throw new Error("sync exploded");
        },
      },
    });

    assert.doesNotThrow(() => emit({ themeAppearance: { night: "light" } }));
    assert.ok(logs.some((entry) => String(entry[0]).includes("appearance")));
  });
});
