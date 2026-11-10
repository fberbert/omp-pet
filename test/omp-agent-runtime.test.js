"use strict";

// OMP-only integration surface: registry, hook agent id resolution, the
// agent gate, installation detection, integration sync, the Settings agent
// commands, the Doctor agent check and the /state route.

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const registry = require("../agents/registry");
const { resolveHookAgentId } = require("../src/server-agent-id");
const {
  isAgentEnabled,
  isAgentIntegrationInstalled,
  shouldSyncAgentIntegration,
} = require("../src/agent-gate");
const { detectAgentInstallations } = require("../src/agent-installation-detector");
const { createIntegrationSyncRuntime } = require("../src/integration-sync");
const agentActions = require("../src/settings-actions-agents");
const { checkAgent } = require("../src/doctor-detectors/agent-integrations");
const { handleStatePost } = require("../src/server-route-state");
const prefs = require("../src/prefs");

describe("agent registry", () => {
  it("registers only OMP", () => {
    assert.deepStrictEqual(registry.getAllAgents().map((agent) => agent.id), ["omp"]);
    assert.ok(registry.getAgent("omp"));
    assert.strictEqual(registry.getAgent("claude-code"), undefined);
  });
});

describe("hook agent id resolution", () => {
  it("accepts omp explicitly and by hook source", () => {
    assert.strictEqual(resolveHookAgentId({ agent_id: "omp" }).agentId, "omp");
    assert.strictEqual(resolveHookAgentId({ hook_source: "omp-extension" }).agentId, "omp");
  });

  it("defaults a missing agent id to omp", () => {
    const identity = resolveHookAgentId({});
    assert.strictEqual(identity.agentId, "omp");
    assert.strictEqual(identity.defaulted, true);
  });

  it("rejects any other explicit agent id", () => {
    const identity = resolveHookAgentId({ agent_id: "claude-code" });
    assert.strictEqual(identity.agentId, null);
    assert.strictEqual(identity.rejected, true);
    assert.strictEqual(identity.rawAgentId, "claude-code");
  });
});

describe("prefs defaults", () => {
  it("installs and enables only OMP", () => {
    const defaults = prefs.getDefaults();
    assert.deepStrictEqual(Object.keys(defaults.agents), ["omp"]);
    assert.strictEqual(defaults.agents.omp.integrationInstalled, true);
    assert.strictEqual(defaults.agents.omp.enabled, true);
  });
});

describe("agent gate", () => {
  it("syncs only when installed and enabled", () => {
    assert.strictEqual(shouldSyncAgentIntegration({ agents: { omp: { integrationInstalled: true, enabled: true } } }, "omp"), true);
    assert.strictEqual(shouldSyncAgentIntegration({ agents: { omp: { integrationInstalled: true, enabled: false } } }, "omp"), false);
    assert.strictEqual(shouldSyncAgentIntegration({ agents: { omp: { integrationInstalled: false, enabled: true } } }, "omp"), false);
  });

  it("reads the enabled and installed flags", () => {
    const snapshot = { agents: { omp: { integrationInstalled: false, enabled: false } } };
    assert.strictEqual(isAgentEnabled(snapshot, "omp"), false);
    assert.strictEqual(isAgentIntegrationInstalled(snapshot, "omp"), false);
  });
});

describe("installation detector", () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "omp-pet-detect-")); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  function descriptor() {
    return {
      agentId: "omp",
      agentName: "OMP",
      parentDir: path.join(tmp, ".omp", "agent"),
      configPath: path.join(tmp, ".omp", "agent", "extensions", "omp-pet"),
      markerFile: ".omp-pet-managed.json",
    };
  }

  it("reports a missing OMP install", () => {
    const report = detectAgentInstallations({ descriptors: [descriptor()] });
    assert.strictEqual(report.agents.length, 1);
    assert.strictEqual(report.agents[0].detectedInstalled, false);
    assert.strictEqual(report.agents[0].clawdIntegration.detected, false);
  });

  it("detects OMP and the managed extension marker", () => {
    const d = descriptor();
    fs.mkdirSync(d.configPath, { recursive: true });
    fs.writeFileSync(path.join(d.configPath, d.markerFile), "{}");
    const report = detectAgentInstallations({ descriptors: [d] });
    assert.strictEqual(report.agents[0].detectedInstalled, true);
    assert.strictEqual(report.agents[0].clawdIntegration.detected, true);
  });
});

describe("integration sync", () => {
  it("syncs, repairs and uninstalls only OMP", () => {
    const calls = [];
    const runtime = createIntegrationSyncRuntime({
      ctx: {
        syncOmpExtensionImpl: () => { calls.push("sync"); return { status: "ok" }; },
        uninstallOmpExtensionImpl: () => { calls.push("uninstall"); return { status: "ok" }; },
      },
    });
    assert.deepStrictEqual(runtime.syncIntegrationForAgent("omp"), { status: "ok" });
    assert.deepStrictEqual(runtime.repairIntegrationForAgent("omp"), { status: "ok" });
    assert.deepStrictEqual(runtime.uninstallIntegrationForAgent("omp"), { status: "ok" });
    assert.strictEqual(runtime.syncIntegrationForAgent("codex"), false);
    assert.strictEqual(runtime.uninstallIntegrationForAgent("codex"), false);
    assert.deepStrictEqual(calls, ["sync", "sync", "uninstall"]);
  });

  it("respects the startup gate", () => {
    let synced = 0;
    const runtime = createIntegrationSyncRuntime({
      ctx: { syncOmpExtensionImpl: () => { synced += 1; return { status: "ok" }; } },
      shouldSyncAgentIntegration: () => false,
    });
    runtime.syncEnabledStartupIntegrations();
    assert.strictEqual(synced, 0);
  });
});

describe("settings agent commands", () => {
  const installedSnapshot = () => ({ agents: { omp: { integrationInstalled: true, enabled: true } } });

  it("lists OMP as the only installable agent", () => {
    assert.deepStrictEqual([...agentActions.INSTALLABLE_AGENT_IDS], ["omp"]);
  });

  it("installs OMP and marks it installed and enabled", async () => {
    const result = await agentActions.installAgentIntegration({ agentId: "omp" }, {
      snapshot: { agents: { omp: { integrationInstalled: false, enabled: false } } },
      syncIntegrationForAgent: () => ({ status: "ok" }),
    });
    assert.strictEqual(result.status, "ok");
    assert.deepStrictEqual(result.commit.agents.omp, { integrationInstalled: true, enabled: true });
  });

  it("rejects other agents", async () => {
    const result = await agentActions.installAgentIntegration({ agentId: "codex" }, {
      snapshot: {},
      syncIntegrationForAgent: () => ({ status: "ok" }),
    });
    assert.strictEqual(result.status, "error");
  });

  it("uninstalls OMP, clears its sessions and dismisses the install hint", async () => {
    const cleared = [];
    const result = await agentActions.uninstallAgentIntegration({ agentId: "omp" }, {
      snapshot: installedSnapshot(),
      uninstallIntegrationForAgent: () => ({ status: "ok" }),
      clearSessionsByAgent: (agentId) => cleared.push(agentId),
    });
    assert.strictEqual(result.status, "ok");
    assert.deepStrictEqual(result.commit.agents.omp, { integrationInstalled: false, enabled: false });
    assert.deepStrictEqual(result.commit.dismissedAgentInstallHints, { omp: true });
    assert.deepStrictEqual(cleared, ["omp"]);
  });

  it("disabling OMP clears its sessions without uninstalling", () => {
    const cleared = [];
    const result = agentActions.setAgentFlag({ agentId: "omp", flag: "enabled", value: false }, {
      snapshot: installedSnapshot(),
      clearSessionsByAgent: (agentId) => cleared.push(agentId),
    });
    assert.strictEqual(result.status, "ok");
    assert.deepStrictEqual(result.commit.agents.omp, { integrationInstalled: true, enabled: false });
    assert.deepStrictEqual(cleared, ["omp"]);
  });

  it("re-enabling an installed OMP re-syncs the extension", () => {
    let synced = 0;
    const result = agentActions.setAgentFlag({ agentId: "omp", flag: "enabled", value: true }, {
      snapshot: { agents: { omp: { integrationInstalled: true, enabled: false } } },
      syncIntegrationForAgent: () => { synced += 1; },
    });
    assert.strictEqual(result.status, "ok");
    assert.strictEqual(synced, 1);
  });

  it("repair requires an installed and enabled integration", async () => {
    const disabled = await agentActions.repairAgentIntegration({ agentId: "omp" }, {
      snapshot: { agents: { omp: { integrationInstalled: true, enabled: false } } },
      repairIntegrationForAgent: () => ({ status: "ok" }),
    });
    assert.strictEqual(disabled.status, "error");
    const ok = await agentActions.repairAgentIntegration({ agentId: "omp" }, {
      snapshot: installedSnapshot(),
      repairIntegrationForAgent: () => ({ status: "ok" }),
    });
    assert.strictEqual(ok.status, "ok");
  });
});

describe("doctor agent check", () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "omp-pet-doctor-")); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  function descriptor() {
    return {
      agentId: "omp",
      agentName: "OMP",
      eventSource: "extension",
      parentDir: path.join(tmp, ".omp", "agent"),
      configPath: path.join(tmp, ".omp", "agent", "extensions", "omp-pet"),
      configMode: "omp-extension",
      autoInstall: true,
      marker: "index.ts",
      coreFile: "omp-extension-core.js",
      markerFile: ".omp-pet-managed.json",
    };
  }

  it("reports a disabled agent without probing the disk", () => {
    const detail = checkAgent(descriptor(), {
      prefs: { agents: { omp: { integrationInstalled: true, enabled: false } } },
    });
    assert.ok(detail);
    assert.notStrictEqual(detail.status, "ok");
  });

  it("passes when the managed extension is installed", () => {
    const d = descriptor();
    fs.mkdirSync(d.configPath, { recursive: true });
    fs.writeFileSync(path.join(d.configPath, d.marker), "// ext\n");
    fs.writeFileSync(path.join(d.configPath, d.coreFile), "// core\n");
    fs.writeFileSync(path.join(d.configPath, d.markerFile), JSON.stringify({
      app: "omp-pet", integration: "omp", managed: true, version: 1,
    }));
    const detail = checkAgent(d, {
      fs,
      env: {},
      homeDir: tmp,
      prefs: { agents: { omp: { integrationInstalled: true, enabled: true } } },
    });
    assert.strictEqual(detail.status, "ok", JSON.stringify(detail));
  });
});

describe("/state route", () => {
  function postState(body, ctxOverrides = {}) {
    const calls = { updateSession: [], setState: [], recorded: [] };
    const ctx = {
      STATE_SVGS: { idle: ["idle.svg"], thinking: ["t.svg"], working: ["w.svg"], notification: ["n.svg"] },
      isAgentEnabled: () => true,
      updateSession: (...args) => calls.updateSession.push(args),
      setState: (...args) => calls.setState.push(args),
      ...ctxOverrides,
    };
    const req = new EventEmitter();
    const res = { status: null, writeHead(status) { this.status = status; }, end() {} };
    const recorder = () => ({
      droppedInvalidAgent: () => calls.recorded.push("invalid"),
      droppedByDisabled: () => calls.recorded.push("disabled"),
      acceptedUnlessDnd: () => calls.recorded.push("accepted"),
    });
    handleStatePost(req, res, { ctx, createRequestHookRecorder: recorder, shouldDropForDnd: () => false });
    req.emit("data", Buffer.from(JSON.stringify(body)));
    req.emit("end");
    return { res, calls };
  }

  it("routes an OMP event into updateSession with its title", () => {
    const { res, calls } = postState({
      agent_id: "omp",
      session_id: "omp:abc",
      state: "thinking",
      event: "UserPromptSubmit",
      cwd: "/tmp/project",
      session_title: "fix tests",
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(calls.updateSession.length, 1);
    const [sid, state, event, opts] = calls.updateSession[0];
    assert.ok(typeof sid === "string" && sid);
    assert.strictEqual(opts.rawSessionId, "omp:abc");
    assert.strictEqual(state, "thinking");
    assert.strictEqual(event, "UserPromptSubmit");
    assert.strictEqual(opts.agentId, "omp");
    assert.strictEqual(opts.sessionTitle, "fix tests");
    assert.strictEqual(opts.cwd, "/tmp/project");
  });

  it("drops foreign agents with 204", () => {
    const { res, calls } = postState({ agent_id: "claude-code", session_id: "x", state: "working" });
    assert.strictEqual(res.status, 204);
    assert.strictEqual(calls.updateSession.length, 0);
    assert.deepStrictEqual(calls.recorded, ["invalid"]);
  });

  it("drops events while OMP is disabled", () => {
    const { res, calls } = postState(
      { agent_id: "omp", session_id: "omp:abc", state: "working" },
      { isAgentEnabled: () => false }
    );
    assert.strictEqual(res.status, 204);
    assert.strictEqual(calls.updateSession.length, 0);
  });

  it("rejects unknown states", () => {
    const { res } = postState({ agent_id: "omp", session_id: "omp:abc", state: "dancing" });
    assert.strictEqual(res.status, 400);
  });
});
