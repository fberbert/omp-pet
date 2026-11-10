"use strict";

const { describe, it, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const themeLoader = require("../src/theme-loader");
const { createTranslator } = require("../src/i18n");

themeLoader.init(path.join(__dirname, "..", "src"));
const defaultTheme = themeLoader.loadTheme("clawd");

function makeCtx({ notificationHookEnabled = true } = {}) {
  const rendererEvents = [];
  const soundsPlayed = [];
  const ctx = {
    lang: "en",
    theme: defaultTheme,
    doNotDisturb: false,
    miniTransitioning: false,
    miniMode: false,
    mouseOverPet: false,
    idlePaused: false,
    forceEyeResend: false,
    eyePauseUntil: 0,
    mouseStillSince: Date.now(),
    miniSleepPeeked: false,
    playSound: (name) => { soundsPlayed.push(name); },
    sendToRenderer: (channel, ...args) => { rendererEvents.push([channel, ...args]); },
    syncHitWin: () => {},
    sendToHitWin: () => {},
    miniPeekIn: () => {},
    miniPeekOut: () => {},
    buildContextMenu: () => {},
    buildTrayMenu: () => {},
    pendingPermissions: [],
    resolvePermissionEntry: () => {},
    focusTerminalWindow: () => {},
    showKimiNotifyBubble: () => {},
    clearKimiNotifyBubbles: () => {},
    processKill: () => { const e = new Error("ESRCH"); e.code = "ESRCH"; throw e; },
    getCursorScreenPoint: () => ({ x: 100, y: 100 }),
    isAgentNotificationHookEnabled: () => notificationHookEnabled,
  };
  ctx._rendererEvents = rendererEvents;
  ctx._soundsPlayed = soundsPlayed;
  ctx.t = createTranslator(() => ctx.lang);
  return ctx;
}

describe("updateSession: Notification hook gate", () => {
  let api;
  let ctx;
  let savedDebounceEnv;

  beforeEach(() => {
    // These tests exercise the Notification gate, not the #406 completion
    // debounce — disable the debounce so a Claude Stop settles immediately.
    savedDebounceEnv = process.env.CLAWD_COMPLETION_DEBOUNCE_MS;
    process.env.CLAWD_COMPLETION_DEBOUNCE_MS = "0";
  });

  afterEach(() => {
    if (api) api.cleanup();
    mock.timers.reset();
    if (savedDebounceEnv === undefined) delete process.env.CLAWD_COMPLETION_DEBOUNCE_MS;
    else process.env.CLAWD_COMPLETION_DEBOUNCE_MS = savedDebounceEnv;
  });

  it("lets Notification events through when the per-agent flag is on", () => {
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
    ctx = makeCtx({ notificationHookEnabled: true });
    api = require("../src/state")(ctx);

    api.updateSession("cc-1", "notification", "Notification", { agentId: "claude-code" });

    const stateChanges = ctx._rendererEvents.filter(([ch]) => ch === "state-change");
    assert.ok(stateChanges.length >= 1, "notification state must be broadcast");
    assert.strictEqual(stateChanges[0][1], "notification");
    assert.deepStrictEqual(ctx._soundsPlayed, ["confirm"], "confirm sound must play");
  });

  it("keeps standalone mini Notification alerts enabled", () => {
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
    ctx = makeCtx({ notificationHookEnabled: true });
    ctx.miniMode = true;
    api = require("../src/state")(ctx);

    api.updateSession("cc-1", "notification", "Notification", { agentId: "claude-code" });

    const stateChanges = ctx._rendererEvents.filter(([ch]) => ch === "state-change");
    assert.ok(stateChanges.length >= 1, "standalone mini notification should still broadcast");
    assert.strictEqual(stateChanges[0][1], "mini-alert");
    assert.deepStrictEqual(ctx._soundsPlayed, ["confirm"], "standalone mini notification should still chime");
  });

  it("restores mini Notification alerts after user activity follows completion", () => {
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
    ctx = makeCtx({ notificationHookEnabled: true });
    ctx.miniMode = true;
    api = require("../src/state")(ctx);

    api.updateSession("cc-1", "attention", "Stop", { agentId: "claude-code" });
    mock.timers.tick(defaultTheme.timings.autoReturn["mini-happy"] + 1);
    ctx._rendererEvents.length = 0;
    ctx._soundsPlayed.length = 0;

    api.updateSession("cc-1", "thinking", "UserPromptSubmit", { agentId: "claude-code" });
    assert.strictEqual(
      api.sessions.get("cc-1").awaitingInputSinceStop,
      false,
      "new user activity should clear the post-completion idle tail"
    );
    ctx._rendererEvents.length = 0;
    ctx._soundsPlayed.length = 0;

    api.updateSession("cc-1", "notification", "Notification", { agentId: "claude-code" });

    const stateChanges = ctx._rendererEvents.filter(([ch]) => ch === "state-change");
    assert.ok(stateChanges.length >= 1, "notification after user activity should broadcast");
    assert.strictEqual(stateChanges[0][1], "mini-alert");
    assert.deepStrictEqual(ctx._soundsPlayed, ["confirm"], "notification after user activity should chime");
  });

  it("keeps post-completion Notification alerts enabled outside mini mode", () => {
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
    ctx = makeCtx({ notificationHookEnabled: true });
    api = require("../src/state")(ctx);

    api.updateSession("cc-1", "attention", "Stop", { agentId: "claude-code" });
    mock.timers.tick(defaultTheme.timings.autoReturn.attention + 1);
    ctx._rendererEvents.length = 0;
    ctx._soundsPlayed.length = 0;

    api.updateSession("cc-1", "notification", "Notification", { agentId: "claude-code" });

    const stateChanges = ctx._rendererEvents.filter(([ch]) => ch === "state-change");
    assert.ok(stateChanges.length >= 1, "normal-mode wait-for-input alert should still broadcast");
    assert.strictEqual(stateChanges[0][1], "notification");
    assert.deepStrictEqual(ctx._soundsPlayed, ["confirm"], "normal-mode wait-for-input alert should still chime");
  });

  it("lets Gemini Notification through when the per-agent flag is on", () => {
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
    ctx = makeCtx({ notificationHookEnabled: true });
    api = require("../src/state")(ctx);

    api.updateSession("gemini-1", "notification", "Notification", { agentId: "gemini-cli" });

    const stateChanges = ctx._rendererEvents.filter(([ch]) => ch === "state-change");
    assert.ok(stateChanges.length >= 1, "Gemini notification state must be broadcast");
    assert.strictEqual(stateChanges[0][1], "notification");
    assert.deepStrictEqual(ctx._soundsPlayed, ["confirm"], "Gemini notification must play confirm sound");
  });

  it("lets Copilot Notification alert while storing idle and recording the event when the flag is on", () => {
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
    ctx = makeCtx({ notificationHookEnabled: true });
    api = require("../src/state")(ctx);

    api.updateSession("copilot-1", "notification", "Notification", { agentId: "copilot-cli" });

    const session = api.sessions.get("copilot-1");
    assert.strictEqual(session.agentId, "copilot-cli");
    assert.strictEqual(session.state, "idle");
    assert.deepStrictEqual(session.recentEvents.map((entry) => entry.event), ["Notification"]);
    const stateChanges = ctx._rendererEvents.filter(([ch]) => ch === "state-change");
    assert.ok(stateChanges.some(([, state]) => state === "notification"));
    assert.deepStrictEqual(ctx._soundsPlayed, ["confirm"]);

    mock.timers.tick(defaultTheme.timings.autoReturn.notification + 1);
    assert.strictEqual(api.getCurrentState(), "idle");
    assert.deepStrictEqual(ctx._soundsPlayed, ["confirm"], "auto-return must not repeat the bell");
  });

  it("returns the Copilot session to working on postToolUse after Notification", () => {
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
    ctx = makeCtx({ notificationHookEnabled: true });
    api = require("../src/state")(ctx);

    api.updateSession("copilot-1", "notification", "Notification", { agentId: "copilot-cli" });
    assert.strictEqual(api.sessions.get("copilot-1").state, "idle");

    api.updateSession("copilot-1", "working", "postToolUse", { agentId: "copilot-cli" });
    assert.strictEqual(api.sessions.get("copilot-1").state, "working");
    assert.deepStrictEqual(
      api.sessions.get("copilot-1").recentEvents.map((entry) => entry.event),
      ["Notification", "postToolUse"]
    );
  });

  it("lets Qoder state-only notifications through when the per-agent flag is on", () => {
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
    ctx = makeCtx({ notificationHookEnabled: true });
    api = require("../src/state")(ctx);

    api.updateSession("qoder-1", "notification", "Notification", { agentId: "qoder" });

    const stateChanges = ctx._rendererEvents.filter(([ch]) => ch === "state-change");
    assert.ok(stateChanges.length >= 1, "Qoder notification must broadcast");
    assert.strictEqual(stateChanges[0][1], "notification");
    assert.deepStrictEqual(ctx._soundsPlayed, ["confirm"], "Qoder notification must play confirm");
  });

  it("lets CodeWhale passive attention notifications through when the per-agent flag is on", () => {
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
    ctx = makeCtx({ notificationHookEnabled: true });
    api = require("../src/state")(ctx);

    api.updateSession("codewhale-1", "attention", "Notification", { agentId: "codewhale" });

    const stateChanges = ctx._rendererEvents.filter(([ch]) => ch === "state-change");
    assert.ok(stateChanges.length >= 1, "CodeWhale attention notification must broadcast");
    assert.strictEqual(stateChanges[0][1], "attention");
  });

  it("never drops PermissionRequest events even when the flag is off", () => {
    // Permission bubbles must keep their bell regardless of idle-alert prefs.
    // PermissionRequest is handled by the branch before the gate and never
    // reaches the Notification-hook check.
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
    ctx = makeCtx({ notificationHookEnabled: false });
    api = require("../src/state")(ctx);

    api.updateSession("cc-1", "notification", "PermissionRequest", { agentId: "claude-code" });

    const stateChanges = ctx._rendererEvents.filter(([ch]) => ch === "state-change");
    assert.ok(stateChanges.length >= 1, "permission request must still broadcast notification");
    assert.strictEqual(stateChanges[0][1], "notification");
  });

  it("lets Codex PermissionRequest play confirm when no mute flag is set", () => {
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
    ctx = makeCtx({ notificationHookEnabled: true });
    api = require("../src/state")(ctx);

    api.updateSession("codex-1", "notification", "PermissionRequest", {
      agentId: "codex",
    });

    assert.deepStrictEqual(ctx._soundsPlayed, ["confirm"], "baseline prompt sound must still play");
  });

  it("keeps Codex completion sound even when native prompt sound is muted", () => {
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
    ctx = makeCtx({ notificationHookEnabled: true });
    api = require("../src/state")(ctx);

    api.updateSession("codex-1", "attention", "Stop", {
      agentId: "codex",
      muteNotificationSound: true,
    });

    assert.deepStrictEqual(ctx._soundsPlayed, ["complete"], "completion sound must still play");
  });

  it("never drops Elicitation events even when the flag is off", () => {
    // Elicitation fires notification state via a separate path (server.js
    // updateSession call with event="Elicitation"). The Notification gate
    // must be event-name-specific, not state-specific.
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
    ctx = makeCtx({ notificationHookEnabled: false });
    api = require("../src/state")(ctx);

    api.updateSession("cc-1", "notification", "Elicitation", { agentId: "claude-code" });

    const stateChanges = ctx._rendererEvents.filter(([ch]) => ch === "state-change");
    assert.ok(stateChanges.length >= 1, "elicitation must still broadcast notification");
  });

  it("lets non-Notification events through regardless of the flag", () => {
    // Non-notification events must not be touched by the gate. Use "working"
    // (a sticky state) as the probe since oneshots like attention auto-return
    // to idle and wouldn't prove the event landed.
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
    ctx = makeCtx({ notificationHookEnabled: false });
    api = require("../src/state")(ctx);

    api.updateSession("cc-1", "thinking", "UserPromptSubmit", { agentId: "claude-code" });
    api.updateSession("cc-1", "working", "PreToolUse", { agentId: "claude-code" });

    assert.ok(api.sessions.has("cc-1"), "session must be registered");
    assert.strictEqual(api.sessions.get("cc-1").state, "working", "working state must stick");
  });

  it("fails open when the ctx reader is missing", () => {
    // Mirror the existing agent-gate fail-open contract: a partial ctx
    // must not accidentally silence the pet.
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
    ctx = makeCtx({ notificationHookEnabled: true });
    delete ctx.isAgentNotificationHookEnabled;
    api = require("../src/state")(ctx);

    api.updateSession("cc-1", "notification", "Notification", { agentId: "claude-code" });

    const stateChanges = ctx._rendererEvents.filter(([ch]) => ch === "state-change");
    assert.ok(stateChanges.length >= 1, "no reader → fail open → event must pass through");
  });

  it("uses the session's remembered agentId when the event omits it", () => {
    // An agent emits Notification without re-sending agent_id; the gate must
    // resolve the agent from the prior session entry (same pattern used by
    // PermissionRequest gating above).
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
    const perAgent = { "claude-code": false, "kimi-cli": true };
    ctx = makeCtx({ notificationHookEnabled: true });
    ctx.isAgentNotificationHookEnabled = (id) => perAgent[id] !== false;
    api = require("../src/state")(ctx);

    // Prime the session with its agentId via a normal event.
    api.updateSession("cc-1", "thinking", "UserPromptSubmit", { agentId: "claude-code" });
    ctx._rendererEvents.length = 0;
    ctx._soundsPlayed.length = 0;

    // Now send Notification without agentId — gate must still mute for CC.
    api.updateSession("cc-1", "notification", "Notification", {});

    const stateChanges = ctx._rendererEvents.filter(([ch]) => ch === "state-change");
    // Pet still gets a broadcast (fall-through to resolveDisplayState), but
    // never enters notification state and never plays the bell.
    assert.ok(stateChanges.every(([, s]) => s !== "notification"), "must not enter notification state");
    assert.deepStrictEqual(ctx._soundsPlayed, [], "no bell when gate resolves agentId from session");
  });
});
