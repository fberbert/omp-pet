"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { pathToFileURL } = require("node:url");

const { registerSettingsIpc } = require("../src/settings-ipc");

class FakeIpcMain {
  constructor() {
    this.handlers = new Map();
    this.listeners = new Map();
    this.invokeEvent = { sender: "sender-web-contents", senderFrame: null };
  }

  handle(channel, listener) {
    this.handlers.set(channel, listener);
  }

  on(channel, listener) {
    this.listeners.set(channel, listener);
  }

  removeHandler(channel) {
    this.handlers.delete(channel);
  }

  removeListener(channel, listener) {
    if (this.listeners.get(channel) === listener) this.listeners.delete(channel);
  }

  invoke(channel, ...args) {
    const listener = this.handlers.get(channel);
    assert.strictEqual(typeof listener, "function", `missing IPC handler ${channel}`);
    return listener(this.invokeEvent, ...args);
  }

  send(channel, ...args) {
    const listener = this.listeners.get(channel);
    assert.strictEqual(typeof listener, "function", `missing IPC listener ${channel}`);
    return listener({ sender: "sender-web-contents" }, ...args);
  }
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "clawd-settings-ipc-"));
}

function createHarness(overrides = {}) {
  const calls = [];
  const ipcMain = new FakeIpcMain();
  const settingsMainFrame = {
    url: pathToFileURL(path.join(__dirname, "..", "src", "settings.html")).href,
  };
  const settingsWebContents = new EventEmitter();
  settingsWebContents.mainFrame = settingsMainFrame;
  const settingsWindow = {
    id: "settings-window",
    webContents: settingsWebContents,
    isDestroyed: () => false,
  };
  ipcMain.invokeEvent = {
    sender: settingsWebContents,
    senderFrame: settingsMainFrame,
  };
  const activeTheme = overrides.activeTheme || {
    _id: "clawd",
    sounds: { complete: "complete.mp3" },
  };
  const settingsController = overrides.settingsController || {
    getSnapshot: () => ({ lang: "en" }),
    applyUpdate: (key, value) => {
      calls.push(["applyUpdate", key, value]);
      return { status: "ok", key, value };
    },
    applyCommand: async (action, payload) => {
      calls.push(["applyCommand", action, payload]);
      return { status: "ok" };
    },
  };
  const themeLoader = overrides.themeLoader || {
    getPreviewSoundUrl: () => "file:///preview.mp3",
    getSoundOverridesDir: () => null,
    getSoundUrl: () => null,
    listThemesWithMetadata: () => [],
    getThemeMetadata: (themeId) => ({ name: themeId }),
    ensureUserThemesDir: () => path.join(os.tmpdir(), "clawd-user-themes"),
  };
  const codexPetMain = overrides.codexPetMain || {
    decorateThemeMetadata: (theme) => theme,
    refreshFromSettings: () => ({ status: "ok", refreshed: true }),
    openCodexPetsDir: () => ({ status: "ok", opened: true }),
    importCodexPetZip: (event) => ({ status: "ok", sender: event.sender }),
    removeCodexPet: (themeId) => ({ status: "ok", removed: themeId }),
  };
  const dialog = overrides.dialog || {
    showOpenDialog: async () => ({ canceled: true }),
    showMessageBox: async () => ({ response: 1 }),
  };
  const shell = overrides.shell || {
    openPath: async () => "",
    openExternal: async (url) => calls.push(["openExternal", url]),
  };
  const settingsSizePreviewSession = overrides.settingsSizePreviewSession || {
    begin: () => {
      calls.push(["sizeBegin"]);
      return { status: "ok", phase: "begin" };
    },
    preview: async (value) => {
      calls.push(["sizePreview", value]);
      return { status: "ok" };
    },
    end: (value) => {
      calls.push(["sizeEnd", value]);
      return { status: "ok", phase: "end", value };
    },
  };
  const roamFenceSettings = overrides.roamFenceSettings || {
    getStatus: async () => ({ status: "ok", active: false, fence: null }),
    saveFence: async (fence) => ({ status: "ok", active: true, fence }),
    clearFence: async () => ({ status: "ok", active: false, fence: null }),
  };
  const roamFencePicker = overrides.roamFencePicker || {
    selectArea: async () => ({ status: "cancel" }),
  };
  const runtime = registerSettingsIpc({
    ipcMain,
    app: { getVersion: () => "1.2.3" },
    BrowserWindow: {
      fromWebContents: (sender) => ({ id: "parent", sender }),
    },
    dialog,
    shell,
    fs: overrides.fs || fs,
    path: overrides.path || path,
    settingsController,
    recapRuntime: overrides.recapRuntime,
    themeLoader,
    codexPetMain,
    officialThemeMain: overrides.officialThemeMain,
    getSettingsWindow: () => settingsWindow,
    getActiveTheme: () => activeTheme,
    getLang: overrides.getLang || (() => "en"),
    getSizeContext: overrides.getSizeContext,
    getHardwareAccelerationDisabledAtStartup: overrides.getHardwareAccelerationDisabledAtStartup,
    getPetAlwaysOnTopAtStartup: overrides.getPetAlwaysOnTopAtStartup,
    roamFenceSettings,
    roamFencePicker,
    settingsSizePreviewSession,
    isValidSizePreviewKey: (value) => /^P:\d+$/.test(value),
    sendToRenderer: (...args) => calls.push(["sendToRenderer", ...args]),
    getDoNotDisturb: overrides.getDoNotDisturb || (() => false),
    getSoundMuted: overrides.getSoundMuted || (() => false),
    getSoundVolume: overrides.getSoundVolume || (() => 0.4),
    getAllAgents: overrides.getAllAgents || (() => []),
    getHookServerPort: overrides.getHookServerPort,
    getRecentHookEvents: overrides.getRecentHookEvents,
    getQuotaSourceCount: overrides.getQuotaSourceCount,
    kimiQuotaRuntime: overrides.kimiQuotaRuntime,
    detectAgentInstallations: overrides.detectAgentInstallations,
    readDshNotices: overrides.readDshNotices,
    acknowledgeDshNotice: overrides.acknowledgeDshNotice,
    platform: overrides.platform,
    refreshDshDesktopDiscovery: overrides.refreshDshDesktopDiscovery,
    refreshWslDetection: overrides.refreshWslDetection,
    showTutorial: overrides.showTutorial || (() => {
      calls.push(["showTutorial"]);
      return { status: "ok" };
    }),
    aboutHeroSvgPath: overrides.aboutHeroSvgPath || path.join(__dirname, "missing-about-hero.svg"),
    getLanWsServer: overrides.getLanWsServer || (() => null),
    now: overrides.now || (() => 12345),
    saveFeishuApproverByEmail: overrides.saveFeishuApproverByEmail || (async ({ email, signal }) => {
      calls.push(["saveFeishuApproverByEmail", email, signal]);
      return { status: "ok" };
    }),
  });
  return { ipcMain, runtime, calls, activeTheme, settingsWindow };
}

test("settings IPC returns the current pet size slider context", async () => {
  const expected = { ui: 70, overMax: false, synced: false };
  const { ipcMain } = createHarness({ getSizeContext: () => expected });
  assert.deepStrictEqual(await ipcMain.invoke("settings:get-size-context"), expected);
});

test("recap IPC exposes only bounded queries and explicit clear to the trusted Settings window", async () => {
  const calls = [];
  const harness = createHarness({
    recapRuntime: {
      query(period) {
        calls.push(["query", period]);
        return { status: "ready", period, days: [] };
      },
      clear() {
        calls.push(["clear"]);
        return true;
      },
    },
  });
  assert.deepStrictEqual(await harness.ipcMain.invoke("settings:recap-query", "year"), {
    status: "ready",
    period: "year",
    days: [],
  });
  assert.deepStrictEqual(await harness.ipcMain.invoke("settings:recap-query", "arbitrary"), {
    status: "error",
    reason: "invalid-period",
  });
  assert.deepStrictEqual(await harness.ipcMain.invoke("settings:recap-clear"), { status: "ok" });
  assert.deepStrictEqual(calls, [["query", "year"], ["clear"]]);

  harness.ipcMain.invokeEvent = { sender: {}, senderFrame: null };
  assert.deepStrictEqual(await harness.ipcMain.invoke("settings:recap-query", "today"), {
    status: "error",
    message: "untrusted settings sender",
  });
  assert.deepStrictEqual(await harness.ipcMain.invoke("settings:recap-clear"), {
    status: "error",
    message: "untrusted settings sender",
  });
  assert.equal(calls.length, 2);
});

test("settings IPC reads, selects, and clears the shared roam fence", async () => {
  const calls = [];
  const initial = {
    status: "ok",
    active: true,
    fence: { left: 0.1, top: 0.2, right: 0.8, bottom: 0.9 },
  };
  const selected = { left: 0.25, top: 0.3, right: 0.75, bottom: 0.85 };
  const harness = createHarness({
    getLang: () => "zh",
    roamFenceSettings: {
      getStatus: async () => { calls.push(["get"]); return initial; },
      saveFence: async (fence) => { calls.push(["save", fence]); return { status: "ok", active: true, fence }; },
      clearFence: async () => { calls.push(["clear"]); return { status: "ok", active: false, fence: null }; },
    },
    roamFencePicker: {
      selectArea: async (payload) => { calls.push(["pick", payload]); return { status: "ok", fence: selected }; },
    },
  });

  assert.deepStrictEqual(await harness.ipcMain.invoke("settings:get-roam-fence"), initial);
  assert.deepStrictEqual(await harness.ipcMain.invoke("settings:select-roam-fence"), {
    status: "ok", active: true, fence: selected,
  });
  assert.deepStrictEqual(await harness.ipcMain.invoke("settings:clear-roam-fence"), {
    status: "ok", active: false, fence: null,
  });
  assert.deepStrictEqual(calls, [
    ["get"],
    ["pick", { lang: "zh" }],
    ["save", selected],
    ["clear"],
  ]);
});

test("roam fence IPC rejects external senders, subframes, and a navigated Settings frame", async () => {
  const calls = [];
  const harness = createHarness({
    roamFenceSettings: {
      getStatus: async () => { calls.push("get"); return { status: "ok" }; },
      saveFence: async () => { calls.push("save"); return { status: "ok" }; },
      clearFence: async () => { calls.push("clear"); return { status: "ok" }; },
    },
    roamFencePicker: {
      selectArea: async () => { calls.push("pick"); return { status: "cancel" }; },
    },
  });
  const contents = harness.settingsWindow.webContents;
  const frame = contents.mainFrame;
  const channels = [
    "settings:get-roam-fence",
    "settings:select-roam-fence",
    "settings:clear-roam-fence",
  ];

  for (const event of [
    { sender: {}, senderFrame: null },
    { sender: contents, senderFrame: { url: frame.url } },
  ]) {
    harness.ipcMain.invokeEvent = event;
    for (const channel of channels) {
      assert.deepStrictEqual(await harness.ipcMain.invoke(channel), {
        status: "error",
        message: "untrusted settings sender",
      });
    }
  }

  const localUrl = frame.url;
  frame.url = "https://example.invalid/";
  harness.ipcMain.invokeEvent = { sender: contents, senderFrame: frame };
  for (const channel of channels) {
    assert.deepStrictEqual(await harness.ipcMain.invoke(channel), {
      status: "error",
      message: "untrusted settings sender",
    });
  }
  frame.url = localUrl;
  assert.deepStrictEqual(calls, [], "untrusted callers must have no picker or file side effects");
  harness.runtime.dispose();
});

test("settings IPC does not write when roam area selection is canceled", async () => {
  let saveCalls = 0;
  const harness = createHarness({
    roamFenceSettings: {
      getStatus: async () => ({ status: "ok", active: false, fence: null }),
      saveFence: async () => { saveCalls += 1; return { status: "ok" }; },
      clearFence: async () => ({ status: "ok", active: false, fence: null }),
    },
    roamFencePicker: { selectArea: async () => ({ status: "cancel" }) },
  });
  assert.deepStrictEqual(await harness.ipcMain.invoke("settings:select-roam-fence"), { status: "cancel" });
  assert.strictEqual(saveCalls, 0);
});

test("settings IPC preserves picker error codes and does not write an impossible area", async () => {
  let saveCalls = 0;
  const tooLarge = {
    status: "error",
    code: "pet-too-large",
    message: "the pet is larger than this display's work area",
  };
  const harness = createHarness({
    roamFenceSettings: {
      getStatus: async () => ({ status: "ok", active: false, fence: null }),
      saveFence: async () => { saveCalls += 1; return { status: "ok" }; },
      clearFence: async () => ({ status: "ok", active: false, fence: null }),
    },
    roamFencePicker: { selectArea: async () => tooLarge },
  });
  assert.deepStrictEqual(await harness.ipcMain.invoke("settings:select-roam-fence"), tooLarge);
  assert.strictEqual(saveCalls, 0);
});

test("settings:list-themes uses active runtime capabilities over raw metadata", async () => {
  const { ipcMain } = createHarness({
    activeTheme: {
      _id: "clawd",
      _capabilities: { petTint: true, accessories: false },
      sounds: {},
    },
    themeLoader: {
      getPreviewSoundUrl: () => null,
      getSoundOverridesDir: () => null,
      getSoundUrl: () => null,
      listThemesWithMetadata: () => [{
        id: "clawd",
        capabilities: { petTint: true, accessories: true, reactions: true },
      }],
      getThemeMetadata: () => null,
      ensureUserThemesDir: () => null,
    },
  });

  assert.deepStrictEqual(await ipcMain.invoke("settings:list-themes"), [{
    id: "clawd",
    active: true,
    capabilities: { petTint: true, accessories: false, reactions: true },
  }]);
});

test("settings IPC opens the tutorial from Settings", async () => {
  const { ipcMain, runtime, calls } = createHarness();

  const result = await ipcMain.invoke("settings:show-tutorial");

  assert.deepStrictEqual(result, { status: "ok" });
  assert.deepStrictEqual(calls, [["showTutorial"]]);
  runtime.dispose();
});

test("settings IPC reports the GPU mode this process launched with (#1183)", async () => {
  const off = createHarness();
  assert.deepStrictEqual(
    await off.ipcMain.invoke("settings:get-startup-render-state"),
    { hardwareAccelerationDisabled: false, petAlwaysOnTop: true },
  );
  off.runtime.dispose();

  const on = createHarness({ getHardwareAccelerationDisabledAtStartup: () => true });
  assert.deepStrictEqual(
    await on.ipcMain.invoke("settings:get-startup-render-state"),
    { hardwareAccelerationDisabled: true, petAlwaysOnTop: true },
  );
  on.runtime.dispose();
});

test("settings IPC opens the user themes directory", async () => {
  const openCalls = [];
  const { ipcMain } = createHarness({
    themeLoader: {
      getPreviewSoundUrl: () => null,
      getSoundOverridesDir: () => null,
      getSoundUrl: () => null,
      listThemesWithMetadata: () => [],
      getThemeMetadata: () => null,
      ensureUserThemesDir: () => "C:\\Users\\Example\\AppData\\Roaming\\Clawd\\themes",
    },
    shell: {
      openPath: async (dir) => {
        openCalls.push(dir);
        return "";
      },
      openExternal: async () => {},
    },
  });

  assert.deepStrictEqual(await ipcMain.invoke("settings:open-user-themes-dir"), {
    status: "ok",
    path: "C:\\Users\\Example\\AppData\\Roaming\\Clawd\\themes",
  });
  assert.deepStrictEqual(openCalls, ["C:\\Users\\Example\\AppData\\Roaming\\Clawd\\themes"]);
});

test("settings IPC copies sound overrides, removes stale siblings, and invalidates renderer cache", async () => {
  const root = makeTempDir();
  try {
    const overridesDir = path.join(root, "overrides");
    const sourcePath = path.join(root, "picked.wav");
    fs.mkdirSync(overridesDir, { recursive: true });
    fs.writeFileSync(sourcePath, "new audio", "utf8");
    fs.writeFileSync(path.join(overridesDir, "complete.mp3"), "old audio", "utf8");

    let dialogOptions = null;
    const { ipcMain, calls, activeTheme } = createHarness({
      dialog: {
        showOpenDialog: async (_parent, options) => {
          dialogOptions = options;
          return { canceled: false, filePaths: [sourcePath] };
        },
        showMessageBox: async () => ({ response: 1 }),
      },
      themeLoader: {
        getPreviewSoundUrl: () => null,
        getSoundOverridesDir: () => overridesDir,
        getSoundUrl: (soundName) => `file:///${soundName}.wav`,
        listThemesWithMetadata: () => [],
        getThemeMetadata: () => null,
      },
    });

    assert.deepStrictEqual(await ipcMain.invoke("settings:pick-sound-file", { soundName: "../nope" }), {
      status: "error",
      message: 'pickSoundFile.soundName "../nope" contains invalid characters',
    });
    assert.deepStrictEqual(await ipcMain.invoke("settings:pick-sound-file", { soundName: "complete" }), {
      status: "ok",
      file: "complete.wav",
    });

    assert.deepStrictEqual(dialogOptions.properties, ["openFile"]);
    assert.deepStrictEqual(dialogOptions.filters[0].extensions.sort(), [
      "aac",
      "flac",
      "m4a",
      "mp3",
      "ogg",
      "wav",
    ]);
    assert.strictEqual(fs.readFileSync(path.join(overridesDir, "complete.wav"), "utf8"), "new audio");
    assert.strictEqual(fs.existsSync(path.join(overridesDir, "complete.mp3")), false);
    assert.strictEqual(activeTheme._soundOverrideFiles.complete, path.join(overridesDir, "complete.wav"));
    assert.deepStrictEqual(calls, [
      ["applyCommand", "setSoundOverride", {
        themeId: "clawd",
        soundName: "complete",
        file: "complete.wav",
        originalName: "picked.wav",
      }],
      ["sendToRenderer", "invalidate-sound-cache", "file:///complete.wav"],
      ["sendToRenderer", "preload-sounds", { urls: ["file:///complete.wav"] }],
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("settings IPC previews sound only when not muted or in DND", async () => {
  const { ipcMain, calls } = createHarness({
    themeLoader: {
      getPreviewSoundUrl: () => null,
      getSoundOverridesDir: () => null,
      getSoundUrl: (soundName) => `file:///${soundName}.mp3?base=1`,
      listThemesWithMetadata: () => [],
      getThemeMetadata: () => null,
    },
    now: () => 987,
  });
  assert.deepStrictEqual(await ipcMain.invoke("settings:preview-sound", { soundName: "complete" }), {
    status: "ok",
  });
  assert.deepStrictEqual(calls, [
    ["sendToRenderer", "play-sound", { url: "file:///complete.mp3?base=1&_t=987", volume: 0.4 }],
  ]);

  const muted = createHarness({ getSoundMuted: () => true });
  assert.deepStrictEqual(await muted.ipcMain.invoke("settings:preview-sound", { soundName: "complete" }), {
    status: "skipped",
    reason: "muted",
  });

  const dnd = createHarness({ getDoNotDisturb: () => true });
  assert.deepStrictEqual(await dnd.ipcMain.invoke("settings:preview-sound", { soundName: "complete" }), {
    status: "skipped",
    reason: "dnd",
  });
});

test("settings IPC exposes read-only agent installation detection", async () => {
  let sawFs = false;
  let sawPath = false;
  const { ipcMain, runtime } = createHarness({
    now: () => 777,
    detectAgentInstallations: (options) => {
      sawFs = !!options.fs;
      sawPath = !!options.path;
      return {
        checkedAt: options.now(),
        agents: [{ agentId: "qwen-code", detectedInstalled: true }],
        skippedAgentIds: ["claude-code"],
      };
    },
  });

  assert.deepStrictEqual(await ipcMain.invoke("settings:detect-agent-installations"), {
    checkedAt: 777,
    agents: [{ agentId: "qwen-code", detectedInstalled: true }],
    skippedAgentIds: ["claude-code"],
  });
  assert.strictEqual(sawFs, true);
  assert.strictEqual(sawPath, true);

  runtime.dispose();
});

// #895 T11d: asserted through the real detector against a throwaway home, so it
// pins the behaviour the Settings page depends on rather than which option keys
// happen to be passed. Codex must reach the Agents tab; Claude must not, because
// Clawd's own sync creates ~/.claude and its presence proves nothing. Settings
// previously withheld both, and the catalog then labelled the ones it had never
// examined as "not detected locally".

test("#1275: startup render state reports both pet topmost launch values", async () => {
  for (const launch of [false, true]) {
    const h = createHarness({ getPetAlwaysOnTopAtStartup: () => launch });
    assert.deepStrictEqual(await h.ipcMain.invoke("settings:get-startup-render-state"), {
      hardwareAccelerationDisabled: false,
      petAlwaysOnTop: launch,
    });
    h.runtime.dispose();
  }
});
