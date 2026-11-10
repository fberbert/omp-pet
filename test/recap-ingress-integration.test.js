"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const themeLoader = require("../src/theme-loader");
const { createMemoryRecapSink } = require("../src/recap-sink");

themeLoader.init(path.join(__dirname, "..", "src"));
const theme = themeLoader.loadTheme("clawd");

function makeRuntime(options = {}) {
  const sink = createMemoryRecapSink();
  const noop = () => {};
  const api = require("../src/state")({
    lang: "en",
    theme,
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
    processKill: () => { const error = new Error("ESRCH"); error.code = "ESRCH"; throw error; },
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    recapSink: sink,
    isAgentEnabled: options.isAgentEnabled || (() => true),
  });
  return { api, sink };
}

function send(api, event, state, options = {}) {
  api.updateSession("omp:session-1", state, event, {
    agentId: "omp",
    rawSessionId: "raw-session-1",
    sessionTitle: "private title",
    toolName: options.toolName || null,
    toolUseId: options.toolUseId || null,
  });
}

describe("recap accepted ingress", () => {
  it("records tools and one accepted completion without content fields", () => {
    const { api, sink } = makeRuntime();
    try {
      send(api, "SessionStart", "idle");
      send(api, "UserPromptSubmit", "thinking");
      send(api, "PreToolUse", "working", { toolName: "bash", toolUseId: "tool-secret" });
      send(api, "PostToolUse", "working", { toolName: "bash", toolUseId: "tool-secret" });
      send(api, "Stop", "attention");
      send(api, "Stop", "attention");
      assert.deepStrictEqual(sink.snapshot().map((event) => event.metrics), [
        ["activity"],
        ["activity"],
        ["activity", "tool-call"],
        ["activity"],
        ["activity", "turn-complete"],
      ]);
      const serialized = JSON.stringify(sink.snapshot());
      for (const forbidden of ["raw-session-1", "tool-secret", "private title", "bash", "cwd"]) {
        assert.strictEqual(serialized.includes(forbidden), false, forbidden);
      }
    } finally {
      api.cleanup();
    }
  });

  it("does not record events for a disabled agent", () => {
    const { api, sink } = makeRuntime({ isAgentEnabled: () => false });
    try {
      send(api, "PreToolUse", "working", { toolUseId: "tool-1" });
      send(api, "Stop", "attention");
      assert.deepStrictEqual(sink.snapshot(), []);
    } finally {
      api.cleanup();
    }
  });
});
