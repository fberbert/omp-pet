"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { registerSessionIpc } = require("../src/session-ipc");

class FakeIpcMain {
  constructor() {
    this.handlers = new Map();
    this.listeners = new Map();
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
    return listener({ sender: "sender-web-contents" }, ...args);
  }

  invokeFrom(event, channel, ...args) {
    const listener = this.handlers.get(channel);
    assert.strictEqual(typeof listener, "function", `missing IPC handler ${channel}`);
    return listener(event, ...args);
  }

  send(channel, ...args) {
    const listener = this.listeners.get(channel);
    assert.strictEqual(typeof listener, "function", `missing IPC listener ${channel}`);
    return listener({ sender: "sender-web-contents" }, ...args);
  }
}

function createHarness(overrides = {}) {
  const calls = [];
  const ipcMain = new FakeIpcMain();
  const dashboardMainFrame = {
    url: pathToFileURL(path.join(__dirname, "..", "src", "dashboard.html")).toString(),
  };
  // The page's WebContents belongs to a WebContentsView on darwin/win32, so
  // the trust check must resolve it directly and never through a window.
  const dashboardWebContents = {
    mainFrame: dashboardMainFrame,
    isDestroyed: () => false,
  };
  // A supported-platform quick mode by default, so the shared channel set
  // reflects a darwin/win32 install.
  const quickMode = {
    isSupported: () => overrides.quickSupported !== false,
    getPendingRevision: () => 7,
    enter: (payload) => { calls.push(["quickEnter", payload]); return { status: "ok" }; },
    ready: (payload) => { calls.push(["quickReady", payload]); return { status: "ok" }; },
    activate: (payload) => { calls.push(["quickActivate", payload]); return { status: "submitted" }; },
    dismissFromRenderer: (payload) => {
      calls.push(["quickDismiss", payload]);
      return { status: "ok" };
    },
  };
  const runtime = registerSessionIpc({
    ipcMain,
    getSessionSnapshot: overrides.getSessionSnapshot || (() => ({ sessions: [{ id: "s1" }] })),
    getI18n: overrides.getI18n || (() => ({ lang: "en", translations: { title: "Sessions" } })),
    focusSession: overrides.focusSession || ((sessionId, options) => {
      calls.push(["focusSession", sessionId, options]);
    }),
    hideSession: overrides.hideSession || ((sessionId) => {
      calls.push(["hideSession", sessionId]);
      return { status: "ok", hidden: sessionId };
    }),
    setSessionAlias: overrides.setSessionAlias || (async (payload) => {
      calls.push(["setSessionAlias", payload]);
      return { status: "ok", alias: payload.alias };
    }),
    showDashboard: overrides.showDashboard || ((options) => {
      calls.push(["showDashboard", options]);
    }),
    setSessionHudPinned: overrides.setSessionHudPinned || ((value) => {
      calls.push(["setSessionHudPinned", value]);
    }),
    ackSessionCompletion: overrides.ackSessionCompletion || ((sessionId) => {
      calls.push(["ackSessionCompletion", sessionId]);
      return true;
    }),
    openSessionFolder: overrides.openSessionFolder || (async (sessionId) => {
      calls.push(["openSessionFolder", sessionId]);
      return { status: "ok" };
    }),
    setSessionAutomationOverride: overrides.setSessionAutomationOverride || (async (payload, context) => {
      calls.push(["setSessionAutomationOverride", payload, context]);
      return { status: "applied" };
    }),
    clearSessionAutomationGrant: overrides.clearSessionAutomationGrant || ((payload) => {
      calls.push(["clearSessionAutomationGrant", payload]);
      return { status: "applied" };
    }),
    getSessionHistory: overrides.getSessionHistory || (() => {
      calls.push(["getSessionHistory"]);
      return [{ agentId: "claude-code", sessionId: "h1", cwd: "/work" }];
    }),
    resumeSessionFromHistory: overrides.resumeSessionFromHistory || ((payload) => {
      calls.push(["resumeSessionFromHistory", payload]);
      return { status: "ok" };
    }),
    ...(overrides.openSessionInTerminal ? { openSessionInTerminal: overrides.openSessionInTerminal } : {}),
    getDashboardWebContents: overrides.getDashboardWebContents
      || (() => dashboardWebContents),
    quickMode: Object.prototype.hasOwnProperty.call(overrides, "quickMode")
      ? overrides.quickMode
      : quickMode,
    getKimiQuotaStatus: overrides.getKimiQuotaStatus || (() => ({
      status: "ok",
      configured: true,
      decryptable: true,
      collectionEnabled: true,
      agentEnabled: true,
    })),
    refreshKimiQuota: overrides.refreshKimiQuota || (() => {
      calls.push(["refreshKimiQuota"]);
      return { status: "ok" };
    }),
  });
  return {
    ipcMain,
    runtime,
    calls,
    trustedDashboardEvent: {
      sender: dashboardWebContents,
      senderFrame: dashboardMainFrame,
    },
  };
}

test("session IPC delegates dashboard and HUD behavior", async () => {
  const { ipcMain, calls } = createHarness();

  assert.deepStrictEqual(await ipcMain.invoke("dashboard:get-snapshot"), {
    sessions: [{ id: "s1" }],
  });
  assert.deepStrictEqual(await ipcMain.invoke("dashboard:get-i18n"), {
    lang: "en",
    translations: { title: "Sessions" },
  });
  assert.deepStrictEqual(await ipcMain.invoke("session-hud:get-i18n"), {
    lang: "en",
    translations: { title: "Sessions" },
  });
  ipcMain.send("dashboard:focus-session", "dash-session");
  ipcMain.send("session-hud:focus-session", "hud-session");
  ipcMain.send("session-hud:set-pinned", true);
  ipcMain.send("session-hud:set-pinned", 0);
  assert.deepStrictEqual(await ipcMain.invoke("dashboard:hide-session", "hidden-session"), {
    status: "ok",
    hidden: "hidden-session",
  });
  assert.deepStrictEqual(
    await ipcMain.invoke("dashboard:set-session-alias", { sessionId: "s1", alias: "Frontend" }),
    { status: "ok", alias: "Frontend" }
  );
  assert.deepStrictEqual(
    await ipcMain.invoke("dashboard:open-session-folder", "folder-session"),
    { status: "ok" }
  );
  assert.deepStrictEqual(
    await ipcMain.invoke("session-hud:open-session-folder", "hud-folder-session"),
    { status: "ok" }
  );

  assert.deepStrictEqual(calls, [
    ["focusSession", "dash-session", { requestSource: "dashboard" }],
    ["focusSession", "hud-session", { requestSource: "hud" }],
    ["setSessionHudPinned", true],
    ["setSessionHudPinned", false],
    ["hideSession", "hidden-session"],
    ["setSessionAlias", { sessionId: "s1", alias: "Frontend" }],
    ["openSessionFolder", "folder-session"],
    ["openSessionFolder", "hud-folder-session"],
  ]);
});

test("dashboard and HUD open-folder IPC accept only a sessionId string", async () => {
  const { ipcMain, calls } = createHarness();
  for (const channel of ["dashboard:open-session-folder", "session-hud:open-session-folder"]) {
    for (const bad of [null, undefined, "", 42, { sessionId: "s1", cwd: "/tmp" }]) {
      const result = await ipcMain.invoke(channel, bad);
      assert.strictEqual(result.status, "error");
    }
  }
  assert.deepStrictEqual(calls, []);
});

test("session IPC owns dashboard open bridges", () => {
  const { ipcMain, calls } = createHarness();

  ipcMain.send("session-hud:open-dashboard");
  ipcMain.send("settings:open-dashboard");
  ipcMain.send("show-dashboard");

  assert.deepStrictEqual(calls, [
    ["showDashboard", { source: "hud" }],
    ["showDashboard", { source: "settings" }],
    ["showDashboard", undefined],
  ]);
});

test("main forwards dashboard open source options into session IPC", () => {
  const mainSource = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
  const preservesOptions = [
    /registerSessionIpc\(\{[\s\S]*?showDashboard\s*,/,
    /registerSessionIpc\(\{[\s\S]*?showDashboard:\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>\s*showDashboard\(\s*\1\s*\)/,
    /registerSessionIpc\(\{[\s\S]*?showDashboard:\s*\(\s*\.\.\.\s*([A-Za-z_$][\w$]*)\s*\)\s*=>\s*showDashboard\(\s*\.\.\.\s*\1\s*\)/,
  ].some((pattern) => pattern.test(mainSource));

  assert.strictEqual(
    preservesOptions,
    true,
    "main.js should preserve dashboard open options when wiring session IPC"
  );
});
