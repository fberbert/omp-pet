// test/agents.test.js - every agent event maps to a state the pet can render
const { describe, it } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const registry = require("../agents/registry");
const themeLoader = require("../src/theme-loader");

themeLoader.init(path.join(__dirname, "..", "src"));
const noop = () => {};
const state = require("../src/state.js")({
  theme: themeLoader.loadTheme("clawd"),
  doNotDisturb: false, miniMode: false,
  playSound: noop, sendToRenderer: noop, syncHitWin: noop, sendToHitWin: noop,
  miniPeekIn: noop, miniPeekOut: noop, buildContextMenu: noop, buildTrayMenu: noop,
});
const VALID_STATES = new Set(Object.keys(state.STATE_PRIORITY));

describe("agent config modules", () => {
  for (const agent of registry.getAllAgents()) {
    it(`${agent.id} maps every event to a valid state`, () => {
      assert.ok(agent.eventMap && Object.keys(agent.eventMap).length > 0, "missing eventMap");
      for (const [event, target] of Object.entries(agent.eventMap)) {
        assert.ok(VALID_STATES.has(target), `${agent.id}.eventMap["${event}"] = "${target}" is not a valid state`);
      }
    });
  }
});
