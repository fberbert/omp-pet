"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { isAgentEnabled, isAgentIntegrationInstalled, shouldSyncAgentIntegration } = require("../src/agent-gate");
const { commandRegistry } = require("../src/settings-actions");
const prefs = require("../src/prefs");

describe("isAgentEnabled", () => {
  it("returns true when snapshot is missing", () => {
    assert.strictEqual(isAgentEnabled(null, "codex"), true);
    assert.strictEqual(isAgentEnabled(undefined, "codex"), true);
    assert.strictEqual(isAgentEnabled({}, "codex"), true);
  });

  it("returns true when agentId is missing", () => {
    const snap = prefs.getDefaults();
    assert.strictEqual(isAgentEnabled(snap, null), true);
    assert.strictEqual(isAgentEnabled(snap, ""), true);
  });

  it("returns true when agents field is absent (legacy upgrade)", () => {
    assert.strictEqual(isAgentEnabled({ lang: "en" }, "codex"), true);
  });

  it("returns true when the agent id is not in the map", () => {
    // Unknown agent ids default-true so a freshly-added registry agent isn't
    // accidentally off for every existing install.
    const snap = prefs.getDefaults();
    assert.strictEqual(isAgentEnabled(snap, "future-agent-id"), true);
  });

  it("returns true when enabled is not false", () => {
    const snap = { agents: { codex: { enabled: true } } };
    assert.strictEqual(isAgentEnabled(snap, "codex"), true);
  });

  it("returns false only when enabled === false", () => {
    assert.strictEqual(
      isAgentEnabled({ agents: { codex: { enabled: false } } }, "codex"),
      false
    );
  });

  it("treats malformed agent entries as enabled", () => {
    assert.strictEqual(isAgentEnabled({ agents: { codex: "nope" } }, "codex"), true);
    assert.strictEqual(isAgentEnabled({ agents: { codex: null } }, "codex"), true);
  });
});

describe("isAgentIntegrationInstalled", () => {
  it("defaults true for missing legacy snapshots", () => {
    assert.strictEqual(isAgentIntegrationInstalled(null, "copilot-cli"), true);
    assert.strictEqual(isAgentIntegrationInstalled({ lang: "en" }, "copilot-cli"), true);
    assert.strictEqual(isAgentIntegrationInstalled({ agents: { "copilot-cli": {} } }, "copilot-cli"), true);
  });

  it("combines installed intent and enabled for startup sync", () => {
    assert.strictEqual(
      shouldSyncAgentIntegration({ agents: { codex: { integrationInstalled: true, enabled: true } } }, "codex"),
      true
    );
    assert.strictEqual(
      shouldSyncAgentIntegration({ agents: { codex: { integrationInstalled: false, enabled: true } } }, "codex"),
      false
    );
    assert.strictEqual(
      shouldSyncAgentIntegration({ agents: { codex: { integrationInstalled: true, enabled: false } } }, "codex"),
      false
    );
  });
});

describe("setAgentFlag command", () => {
  function makeDeps(overrides = {}) {
    const calls = {
      startMonitorForAgent: [],
      stopMonitorForAgent: [],
      clearSessionsByAgent: [],
      dismissPermissionsByAgent: [],
      syncIntegrationForAgent: [],
      stopIntegrationForAgent: [],
      writeCodexAutoStartGate: [],
    };
    return {
      calls,
      deps: {
        snapshot: prefs.getDefaults(),
        startMonitorForAgent: (id) => calls.startMonitorForAgent.push(id),
        stopMonitorForAgent: (id) => calls.stopMonitorForAgent.push(id),
        clearSessionsByAgent: (id) => calls.clearSessionsByAgent.push(id),
        dismissPermissionsByAgent: (id) => calls.dismissPermissionsByAgent.push(id),
        syncIntegrationForAgent: (id) => calls.syncIntegrationForAgent.push(id),
        stopIntegrationForAgent: (id) => calls.stopIntegrationForAgent.push(id),
        writeCodexAutoStartGate: (enabled) => {
          calls.writeCodexAutoStartGate.push(enabled);
          return true;
        },
        ...overrides,
      },
    };
  }

  it("rejects missing agentId", () => {
    const { deps } = makeDeps();
    const r = commandRegistry.setAgentFlag({ flag: "enabled", value: false }, deps);
    assert.strictEqual(r.status, "error");
  });

  it("rejects unknown flag name", () => {
    const { deps } = makeDeps();
    const r = commandRegistry.setAgentFlag(
      { agentId: "codex", flag: "wombat", value: false },
      deps
    );
    assert.strictEqual(r.status, "error");
    assert.ok(r.message.includes("flag"));
  });

  it("does not let the generic flag command fake installed state", () => {
    const { deps } = makeDeps();
    const r = commandRegistry.setAgentFlag(
      { agentId: "copilot-cli", flag: "integrationInstalled", value: true },
      deps
    );
    assert.strictEqual(r.status, "error");
    assert.ok(r.message.includes("flag"));
  });

  it("rejects non-boolean value", () => {
    const { deps } = makeDeps();
    const r = commandRegistry.setAgentFlag(
      { agentId: "codex", flag: "enabled", value: "off" },
      deps
    );
    assert.strictEqual(r.status, "error");
  });

  it("is noop when value already matches current state", () => {
    const { deps, calls } = makeDeps();
    const r = commandRegistry.setAgentFlag(
      { agentId: "codex", flag: "enabled", value: true },
      deps
    );
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(r.noop, true);
    assert.strictEqual(calls.stopMonitorForAgent.length, 0);
    assert.strictEqual(calls.startMonitorForAgent.length, 0);
  });

  it("toggling master flag preserves permissionsEnabled (no silent wipe)", () => {
    // Regression guard. Pre-refactor setAgentEnabled wrote
    // `{ [agentId]: { enabled } }`, erasing sibling flags on every main-
    // switch flip. setAgentFlag must spread the existing entry.
    const seeded = prefs.getDefaults();
    seeded.agents["claude-code"] = { enabled: true, permissionsEnabled: false };
    const { deps } = makeDeps({ snapshot: seeded });
    const r = commandRegistry.setAgentFlag(
      { agentId: "claude-code", flag: "enabled", value: false },
      deps
    );
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(r.commit.agents["claude-code"].enabled, false);
    assert.strictEqual(
      r.commit.agents["claude-code"].permissionsEnabled,
      false,
      "permissionsEnabled flag must survive a master-switch flip"
    );
  });

  it("missing side-effect deps are tolerated (simulates hook-only agent)", () => {
    // Hook-based agents like Copilot / Cursor have no monitor — the command
    // should still succeed; the route layer enforces the gate.
    const seeded = prefs.getDefaults();
    seeded.agents["copilot-cli"] = {
      ...seeded.agents["copilot-cli"],
      integrationInstalled: true,
      enabled: true,
    };
    const { deps } = makeDeps({ snapshot: seeded });
    delete deps.startMonitorForAgent;
    delete deps.stopMonitorForAgent;
    const r = commandRegistry.setAgentFlag(
      { agentId: "copilot-cli", flag: "enabled", value: false },
      deps
    );
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(r.commit.agents["copilot-cli"].enabled, false);
  });
});

