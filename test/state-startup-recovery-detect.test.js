const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const childProcess = require("child_process");
const themeLoader = require("../src/theme-loader");

themeLoader.init(path.join(__dirname, "..", "src"));
const defaultTheme = themeLoader.loadTheme("clawd");

function makeApi(overrides = {}) {
  const noop = () => {};
  return require("../src/state")({
    lang: "en",
    theme: defaultTheme,
    doNotDisturb: false,
    miniMode: false,
    playSound: noop,
    sendToRenderer: noop,
    syncHitWin: noop,
    sendToHitWin: noop,
    miniPeekIn: noop,
    miniPeekOut: noop,
    buildContextMenu: noop,
    buildTrayMenu: noop,
    processKill: () => { const e = new Error("ESRCH"); e.code = "ESRCH"; throw e; },
    getCursorScreenPoint: () => ({ x: 100, y: 100 }),
    ...overrides,
  });
}

function detect(api) {
  return new Promise((resolve) => api.detectRunningAgentProcesses(resolve));
}

describe("detectRunningAgentProcesses()", () => {
  let api;
  let originalExecFile;

  beforeEach(() => { originalExecFile = childProcess.execFile; });
  afterEach(() => {
    childProcess.execFile = originalExecFile;
    api.cleanup();
  });

  it("looks for the OMP CLI by its package path and reports a match", async () => {
    const calls = [];
    childProcess.execFile = (file, args, opts, cb) => { calls.push([file, args]); cb(null, "1234\n"); };
    api = makeApi({ isAgentEnabled: () => true });
    assert.strictEqual(await detect(api), true);
    assert.deepStrictEqual(calls, [["pgrep", ["-f", "@oh-my-pi/pi-coding-agent"]]]);
  });

  it("reports no match when pgrep finds nothing", async () => {
    childProcess.execFile = (file, args, opts, cb) => cb(Object.assign(new Error("exit 1"), { code: 1 }));
    api = makeApi({ isAgentEnabled: () => true });
    assert.strictEqual(await detect(api), false);
  });

  it("does not scan while OMP is disabled", async () => {
    let calls = 0;
    childProcess.execFile = () => { calls++; };
    api = makeApi({ isAgentEnabled: () => false });
    assert.strictEqual(await detect(api), false);
    assert.strictEqual(calls, 0);
  });
});
