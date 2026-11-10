"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { SESSION_STALE_MS, WORKING_STALE_MS, DETACHED_IDLE_STALE_MS, CODEX_LOCAL_WORKING_STALE_FLOOR_MS, getStaleSessionDecision } = require("../src/state-stale-cleanup");

function session(overrides = {}) {
  return {
    state: "idle",
    updatedAt: 1000000,
    pidReachable: true,
    sourcePid: null,
    agentPid: null,
    ...overrides,
  };
}

function desktopSession(overrides = {}) {
  return session({
    agentId: "codex",
    codexOriginator: "codex_work_desktop",
    agentPid: 10,
    sourcePid: 10,
    ...overrides,
  });
}

function queueableCliSession(overrides = {}) {
  return session({
    agentId: "codex",
    codexOriginator: "codex-tui",
    pidReachable: false,
    transcriptPath: process.platform === "win32"
      ? "C:\\Users\\tester\\.codex\\sessions\\2026\\09\\15\\rollout-test.jsonl"
      : "/home/tester/.codex/sessions/2026/09/15/rollout-test.jsonl",
    ...overrides,
  });
}

function zcodeDesktopSession(overrides = {}) {
  return session({
    agentId: "zcode",
    agentPid: 30,
    sourcePid: 31,
    ...overrides,
  });
}

function traeDesktopSession(overrides = {}) {
  return session({
    agentId: "traecode",
    agentPid: 40,
    sourcePid: 41,
    ...overrides,
  });
}

function workbuddyDesktopSession(overrides = {}) {
  return session({
    agentId: "workbuddy",
    agentPid: 50,
    sourcePid: 51,
    ...overrides,
  });
}

function decision(target, overrides = {}) {
  const calls = [];
  const alivePids = overrides.alivePids || new Set();
  const result = getStaleSessionDecision(target, {
    now: overrides.now || 1000000,
    isProcessAlive(pid) {
      calls.push(pid);
      return alivePids.has(pid);
    },
    deriveSessionBadge: overrides.deriveSessionBadge || (() => "idle"),
    shouldAutoClearDetachedSession: overrides.shouldAutoClearDetachedSession || (() => false),
    staleConfig: overrides.staleConfig,
    hasReplyableCompletionMapping: overrides.hasReplyableCompletionMapping,
  });
  return { result, calls };
}

describe("state stale cleanup decisions", () => {
  it("deletes immediately when a reachable agent pid is dead before badge checks", () => {
    let badgeCalls = 0;
    const { result, calls } = decision(session({ agentPid: 10, sourcePid: 20 }), {
      alivePids: new Set([20]),
      deriveSessionBadge: () => { badgeCalls += 1; return "done"; },
      shouldAutoClearDetachedSession: () => true,
    });

    assert.deepStrictEqual(result, { action: "delete", reason: "agent-exit" });
    assert.deepStrictEqual(calls, [10]);
    assert.strictEqual(badgeCalls, 0);
  });

  it("marks a detached ended session for HUD refresh before fast deletion threshold", () => {
    const { result, calls } = decision(session({
      updatedAt: 1000000 - DETACHED_IDLE_STALE_MS + 1,
      sourcePid: 20,
    }), {
      shouldAutoClearDetachedSession: (target, badge) => {
        assert.strictEqual(badge, "done");
        return true;
      },
      deriveSessionBadge: () => "done",
    });

    assert.deepStrictEqual(result, { action: null, snapshotRefreshNeeded: true });
    assert.deepStrictEqual(calls, []);
  });

  it("deletes a detached ended session after the fast deletion threshold", () => {
    const { result } = decision(session({
      updatedAt: 1000000 - DETACHED_IDLE_STALE_MS - 1,
      sourcePid: 20,
    }), {
      deriveSessionBadge: () => "interrupted",
      shouldAutoClearDetachedSession: () => true,
    });

    assert.deepStrictEqual(result, { action: "delete", reason: "detached-ended", badge: "interrupted" });
  });

  it("handles full stale timeout source and reachability branches", () => {
    assert.deepStrictEqual(decision(session({
      updatedAt: 1000000 - SESSION_STALE_MS - 1,
      sourcePid: 20,
    })).result, { action: "delete", reason: "source-exit" });

    assert.deepStrictEqual(decision(session({
      state: "working",
      updatedAt: 1000000 - SESSION_STALE_MS - 1,
      sourcePid: 20,
    }), {
      alivePids: new Set([20]),
    }).result, { action: "idle", reason: "working-timeout", updateTimestamp: true });

    assert.deepStrictEqual(decision(session({
      updatedAt: 1000000 - SESSION_STALE_MS - 1,
      pidReachable: false,
    })).result, { action: "delete", reason: "unreachable" });

    assert.deepStrictEqual(decision(session({
      updatedAt: 1000000 - SESSION_STALE_MS - 1,
      pidReachable: true,
      sourcePid: null,
    })).result, { action: "delete", reason: "no-source" });
  });

  it("does not change DSH idle cleanup when the desktop carrier is present", () => {
    const base = {
      agentId: "deepseek-harness",
      agentPid: 50,
      sourcePid: null,
      updatedAt: 1000000 - SESSION_STALE_MS - 1,
    };
    const alivePids = new Set([50]);
    const carrier = decision(session({ ...base, dshCarrier: "desktop" }), { alivePids });
    const plain = decision(session(base), { alivePids });

    // The carrier is a focus hint only: it adds no source pid and must not
    // change liveness or idle retention for the session.
    assert.deepStrictEqual(carrier.result, plain.result);
    assert.deepStrictEqual(carrier.result, { action: "delete", reason: "no-source" });
  });

  it("handles working stale timeout source exit and idle downgrade", () => {
    assert.deepStrictEqual(decision(session({ agentId: "claude-code",
      state: "executing", updatedAt: 1000000 - WORKING_STALE_MS - 1,
    })).result, { action: "idle", reason: "working-timeout", updateTimestamp: true });
    assert.deepStrictEqual(decision(session({
      state: "working",
      updatedAt: 1000000 - WORKING_STALE_MS - 1,
      sourcePid: 20,
    })).result, { action: "delete", reason: "working-source-exit" });

    assert.deepStrictEqual(decision(session({
      state: "thinking",
      updatedAt: 1000000 - WORKING_STALE_MS - 1,
      sourcePid: null,
    })).result, { action: "idle", reason: "working-timeout", updateTimestamp: true });

    assert.deepStrictEqual(decision(session({
      state: "idle",
      updatedAt: 1000000 - WORKING_STALE_MS - 1,
      sourcePid: null,
    })).result, { action: null });
  });

  it("idles an expired working session when its agent is alive even if the wrapper source is dead", () => {
    const now = 2_000_000;
    const { result, calls } = decision(session({
      state: "working",
      agentId: "claude-code",
      agentPid: 10,
      sourcePid: 20,
      updatedAt: now - WORKING_STALE_MS - 1,
    }), {
      now,
      alivePids: new Set([10]),
    });

    assert.deepStrictEqual(result, { action: "idle", reason: "working-timeout", updateTimestamp: true });
    assert.deepStrictEqual(calls, [10], "dead per-event wrapper must not be probed once the agent is live");
  });

  it("keeps an expired idle session when its agent is alive even if the wrapper source is dead", () => {
    const now = 2_000_000;
    const { result, calls } = decision(session({
      state: "idle",
      agentId: "claude-code",
      agentPid: 10,
      sourcePid: 20,
      updatedAt: now - SESSION_STALE_MS - 1,
    }), {
      now,
      alivePids: new Set([10]),
    });

    assert.deepStrictEqual(result, { action: null });
    assert.deepStrictEqual(calls, [10], "dead per-event wrapper must not be probed once the agent is live");
  });

  it("preserves source-death fallback when no reliable agent pid exists", () => {
    const now = 2_000_000;
    const { result, calls } = decision(session({
      state: "working",
      agentPid: null,
      sourcePid: 20,
      updatedAt: now - WORKING_STALE_MS - 1,
    }), { now });

    assert.deepStrictEqual(result, { action: "delete", reason: "working-source-exit" });
    assert.deepStrictEqual(calls, [20]);
  });

  it("caches process liveness within one stale decision", () => {
    const now = 2_000_000;
    const { result, calls } = decision(session({
      state: "idle",
      agentPid: 10,
      sourcePid: 10,
      updatedAt: now - SESSION_STALE_MS - 1,
    }), {
      now,
      alivePids: new Set([10]),
    });

    assert.deepStrictEqual(result, { action: null });
    assert.deepStrictEqual(calls, [10]);
  });

  it("keeps an actively reporting working session whose source process already exited", () => {
    // Several agents launch each hook through a throwaway shell (on Windows
    // Claude Code uses a per-event pwsh wrapper), so the source_pid that ships
    // with an event is dead again within the second. Source liveness only means
    // something once the turn has actually gone quiet for the working window.
    const now = 2_000_000;
    assert.deepStrictEqual(decision(session({
      state: "working",
      agentId: "claude-code",
      agentPid: 10,
      sourcePid: 20,
      updatedAt: now - 1_000,
    }), {
      now,
      alivePids: new Set([10]),
    }).result, { action: null });
  });

  it("does not probe the source before or at a positive working-window boundary", () => {
    const now = 2_000_000;
    for (const state of ["working", "thinking", "juggling"]) {
      for (const age of [1_000, WORKING_STALE_MS]) {
        for (const agentPid of [null, 10]) {
          const { result, calls } = decision(session({
            state, agentId: "claude-code", agentPid, sourcePid: 20,
            updatedAt: now - age,
          }), { now, alivePids: new Set([10]) });
          assert.deepStrictEqual(result, { action: null });
          assert.deepStrictEqual(calls, agentPid ? [10] : []);
        }
      }
    }
  });

  it("falls back to module defaults when no staleConfig provided", () => {
    // Regression: passing no staleConfig must behave identically to before.
    const { result } = decision(session({
      updatedAt: 1000000 - SESSION_STALE_MS - 1,
      pidReachable: false,
    }));
    assert.deepStrictEqual(result, { action: "delete", reason: "unreachable" });
  });

  it("honors a configured sessionStaleMs cutoff", () => {
    const { result } = decision(session({
      updatedAt: 1000000 - 65_000,
      pidReachable: false,
    }), {
      staleConfig: { sessionStaleMs: 60_000 },
    });
    assert.deepStrictEqual(result, { action: "delete", reason: "unreachable" });
  });

  it("keeps an idle Codex Desktop thread before its configured timeout", () => {
    const { result } = decision(desktopSession({
      updatedAt: 1000000 - 59_999,
    }), {
      alivePids: new Set([10]),
      staleConfig: { sessionStaleMs: 60_000 },
    });

    assert.deepStrictEqual(result, { action: null });
  });

  it("retires a PID-less Codex CLI session when its mapping or store provenance is absent", () => {
    const options = {
      staleConfig: { sessionStaleMs: 60_000 },
      hasReplyableCompletionMapping: () => false,
    };
    assert.deepStrictEqual(
      decision(queueableCliSession({ updatedAt: 1000000 - 60_001 }), options).result,
      { action: "delete", reason: "unreachable" },
    );
    assert.deepStrictEqual(
      decision(queueableCliSession({
        updatedAt: 1000000 - 60_001,
        transcriptPath: null,
      }), {
        ...options,
        hasReplyableCompletionMapping: () => true,
      }).result,
      { action: "delete", reason: "unreachable" },
    );
  });

  it("keeps idle Codex Desktop threads forever when sessionStaleMs=0", () => {
    const { result } = decision(desktopSession({
      updatedAt: 1000000 - 24 * 60 * 60 * 1000,
    }), {
      alivePids: new Set([10]),
      staleConfig: { sessionStaleMs: 0 },
    });

    assert.deepStrictEqual(result, { action: null });
  });

  it("restarts the Codex Desktop idle timeout from ackedAt", () => {
    const { result } = decision(desktopSession({
      updatedAt: 1000000 - 120_000,
      ackedAt: 1000000 - 30_000,
    }), {
      alivePids: new Set([10]),
      staleConfig: { sessionStaleMs: 60_000 },
    });

    assert.deepStrictEqual(result, { action: null });
  });

  it("does not apply the Desktop idle timeout to guardian, remote, or unknown Codex sessions", () => {
    const staleConfig = { sessionStaleMs: 60_000 };
    const alivePids = new Set([10]);
    const updatedAt = 1000000 - 60_001;
    const cases = [
      desktopSession({ headless: true, updatedAt }),
      desktopSession({ host: "remote-box", updatedAt }),
      desktopSession({ codexOriginator: "codex_exec", updatedAt }),
      desktopSession({ codexOriginator: null, updatedAt }),
    ];

    for (const target of cases) {
      assert.deepStrictEqual(decision(target, { alivePids, staleConfig }).result, { action: null });
    }
  });

  it("keeps ZCode conversations before the cutoff or when the cutoff is disabled", () => {
    const alivePids = new Set([30, 31]);
    assert.deepStrictEqual(decision(zcodeDesktopSession({
      updatedAt: 1000000 - 59_999,
    }), {
      alivePids,
      staleConfig: { sessionStaleMs: 60_000 },
    }).result, { action: null });
    assert.deepStrictEqual(decision(zcodeDesktopSession({
      updatedAt: 1000000 - 24 * 60 * 60 * 1000,
    }), {
      alivePids,
      staleConfig: { sessionStaleMs: 0 },
    }).result, { action: null });
  });

  it("does not apply the ZCode idle timeout to remote, headless, or working sessions", () => {
    const updatedAt = 1000000 - 60_001;
    const alivePids = new Set([30, 31]);
    const staleConfig = { sessionStaleMs: 60_000 };
    const cases = [
      zcodeDesktopSession({ host: "remote-box", updatedAt }),
      zcodeDesktopSession({ headless: true, updatedAt }),
      zcodeDesktopSession({ state: "working", updatedAt }),
    ];
    for (const target of cases) {
      const result = decision(target, { alivePids, staleConfig }).result;
      assert.notStrictEqual(result.reason, "zcode-desktop-idle-timeout");
    }
  });

  it("keeps TraeCode conversations before the cutoff or when the cutoff is disabled", () => {
    const alivePids = new Set([40, 41]);
    assert.deepStrictEqual(decision(traeDesktopSession({
      updatedAt: 1000000 - 59_999,
    }), {
      alivePids,
      staleConfig: { sessionStaleMs: 60_000 },
    }).result, { action: null });
    assert.deepStrictEqual(decision(traeDesktopSession({
      updatedAt: 1000000 - 24 * 60 * 60 * 1000,
    }), {
      alivePids,
      staleConfig: { sessionStaleMs: 0 },
    }).result, { action: null });
  });

  it("does not apply the TraeCode idle timeout to remote, headless, or working sessions", () => {
    const updatedAt = 1000000 - 60_001;
    const alivePids = new Set([40, 41]);
    const staleConfig = { sessionStaleMs: 60_000 };
    const cases = [
      traeDesktopSession({ host: "remote-box", updatedAt }),
      traeDesktopSession({ headless: true, updatedAt }),
      traeDesktopSession({ state: "working", updatedAt }),
      // Not traecode — e.g. claude-code idling in the same directory.
      session({ agentId: "claude-code", agentPid: 40, sourcePid: 41, updatedAt }),
    ];
    for (const target of cases) {
      const result = decision(target, { alivePids, staleConfig }).result;
      assert.notStrictEqual(result.reason, "traecode-desktop-idle-timeout");
    }
  });

  it("issue #655: keeps WorkBuddy conversations before the cutoff or when the cutoff is disabled", () => {
    const alivePids = new Set([50, 51]);
    assert.deepStrictEqual(decision(workbuddyDesktopSession({
      updatedAt: 1000000 - 59_999,
    }), {
      alivePids,
      staleConfig: { sessionStaleMs: 60_000 },
    }).result, { action: null });
    assert.deepStrictEqual(decision(workbuddyDesktopSession({
      updatedAt: 1000000 - 24 * 60 * 60 * 1000,
    }), {
      alivePids,
      staleConfig: { sessionStaleMs: 0 },
    }).result, { action: null });
  });

  it("issue #655: does not apply the WorkBuddy idle timeout to remote, headless, or working sessions", () => {
    const updatedAt = 1000000 - 60_001;
    const alivePids = new Set([50, 51]);
    const staleConfig = { sessionStaleMs: 60_000 };
    const cases = [
      workbuddyDesktopSession({ host: "remote-box", updatedAt }),
      workbuddyDesktopSession({ headless: true, updatedAt }),
      workbuddyDesktopSession({ state: "working", updatedAt }),
    ];
    for (const target of cases) {
      const result = decision(target, { alivePids, staleConfig }).result;
      assert.notStrictEqual(result.reason, "workbuddy-desktop-idle-timeout");
    }

    // A different agent idling in the same directory keeps its generic live-
    // agent idle retention.
    assert.deepStrictEqual(
      decision(session({ agentId: "claude-code", agentPid: 50, sourcePid: 51, updatedAt }), {
        alivePids,
        staleConfig,
      }).result,
      { action: null },
    );
  });

  it("issue #655: still deletes a WorkBuddy session by agent-exit before any idle timeout", () => {
    const { result } = decision(workbuddyDesktopSession({
      updatedAt: 1000000 - 60_001,
    }), {
      alivePids: new Set([51]),
      staleConfig: { sessionStaleMs: 60_000 },
    });

    assert.deepStrictEqual(result, { action: "delete", reason: "agent-exit" });
  });

  it("treats sessionStaleMs=0 as disabled — does not delete by age", () => {
    // 10h-old idle remote session, sessionStaleMs disabled -> stays alive.
    const { result } = decision(session({
      state: "idle",
      updatedAt: 1000000 - 10 * 60 * 60 * 1000,
      pidReachable: false,
    }), {
      staleConfig: { sessionStaleMs: 0 },
    });
    assert.deepStrictEqual(result, { action: null });
  });

  it("honors a configured workingStaleMs floor", () => {
    // Bump the working timeout up so a 5-min-old working session stays
    // working instead of getting downgraded to idle.
    const { result } = decision(session({
      state: "working",
      updatedAt: 1000000 - 5 * 60 * 1000,
      sourcePid: null,
    }), {
      staleConfig: { workingStaleMs: 600_000 },
    });
    assert.deepStrictEqual(result, { action: null });
  });

  it("lets a live Codex agent override a dead wrapper while preserving agent death", () => {
    const target = session({
      state: "working", agentId: "codex", agentPid: 10, sourcePid: 20,
    });
    const staleConfig = { codexWorkingStaleMs: 0 };
    const sourceDead = decision(target, { staleConfig, alivePids: new Set([10]) });
    assert.deepStrictEqual(sourceDead.result, { action: null });
    assert.deepStrictEqual(sourceDead.calls, [10]);
    const agentDead = decision(target, { staleConfig, alivePids: new Set([20]) });
    assert.deepStrictEqual(agentDead.result, { action: "delete", reason: "agent-exit" });
    assert.deepStrictEqual(agentDead.calls, [10]);
  });

  it("preserves a longer configured stale timeout for local OpenCode work", () => {
    const now = 2_000_000;
    const configuredStaleMs = 30 * 60 * 1000;
    const { result } = decision(session({
      state: "working",
      agentId: "opencode",
      agentPid: 10,
      sourcePid: 20,
      pidReachable: true,
      updatedAt: now - 20 * 60 * 1000 - 1,
    }), {
      now,
      alivePids: new Set([10, 20]),
      staleConfig: {
        sessionStaleMs: configuredStaleMs,
        workingStaleMs: configuredStaleMs,
      },
    });

    assert.deepStrictEqual(result, { action: null });
  });

  it("retires local OpenCode work after the default 20-minute stale floor", () => {
    const now = 2_000_000;
    const { result } = decision(session({
      state: "working",
      agentId: "opencode",
      agentPid: 10,
      sourcePid: 20,
      pidReachable: true,
      updatedAt: now - 20 * 60 * 1000 - 1,
    }), {
      now,
      alivePids: new Set([10, 20]),
    });

    assert.deepStrictEqual(result, { action: "idle", reason: "working-timeout", updateTimestamp: true });
  });

  it("deletes local OpenCode work immediately when the agent process dies", () => {
    const now = 2_000_000;
    assert.deepStrictEqual(
      decision(session({
        state: "working",
        agentId: "opencode",
        agentPid: 10,
        sourcePid: 20,
        pidReachable: true,
        updatedAt: now - 305_656,
      }), {
        now,
        alivePids: new Set([20]),
      }).result,
      { action: "delete", reason: "agent-exit" },
    );
  });

  it("idles local OpenCode work after the stale floor when its agent remains alive", () => {
    const now = 2_000_000;
    assert.deepStrictEqual(
      decision(session({
        state: "working",
        agentId: "opencode",
        agentPid: 10,
        sourcePid: 20,
        pidReachable: true,
        updatedAt: now - 20 * 60 * 1000 - 1,
      }), {
        now,
        alivePids: new Set([10]),
      }).result,
      { action: "idle", reason: "working-timeout", updateTimestamp: true },
    );
  });

  it("does not extend remote OpenCode or Claude working sessions", () => {
    const now = 2_000_000;
    for (const agentId of ["opencode", "claude-code"]) {
      const { result } = decision(session({
        state: "working",
        agentId,
        host: agentId === "opencode" ? "ssh:example.com" : null,
        updatedAt: now - WORKING_STALE_MS - 1,
      }), { now });
      assert.deepStrictEqual(result, { action: "idle", reason: "working-timeout", updateTimestamp: true });
    }

    const { result: headlessResult } = decision(session({
      state: "working",
      agentId: "opencode",
      headless: true,
      updatedAt: now - WORKING_STALE_MS - 1,
    }), { now });
    assert.deepStrictEqual(headlessResult, { action: "idle", reason: "working-timeout", updateTimestamp: true });
  });

  it("does not extend local MiMo Code working sessions", () => {
    const now = 2_000_000;
    const { result } = decision(session({
      state: "working",
      agentId: "mimocode",
      updatedAt: now - WORKING_STALE_MS - 1,
    }), { now });

    assert.deepStrictEqual(result, { action: "idle", reason: "working-timeout", updateTimestamp: true });
  });

  it("still downgrades local Codex working after the Codex floor expires", () => {
    const { result } = decision(session({
      state: "thinking",
      agentId: "codex",
      updatedAt: 2000000 - CODEX_LOCAL_WORKING_STALE_FLOOR_MS - 1,
      agentPid: 10,
      sourcePid: 20,
    }), {
      now: 2000000,
      alivePids: new Set([10, 20]),
    });
    assert.deepStrictEqual(result, { action: "idle", reason: "working-timeout", updateTimestamp: true });
  });

  it("ignores fresh metadataUpdatedAt when lifecycle updatedAt crossed the Codex floor", () => {
    const now = 2000000;
    const lifecycleAt = now - CODEX_LOCAL_WORKING_STALE_FLOOR_MS - 1;
    const { result } = decision(session({
      state: "working",
      agentId: "codex",
      updatedAt: lifecycleAt,
      metadataUpdatedAt: now,
      agentPid: 10,
      sourcePid: 20,
    }), {
      now,
      alivePids: new Set([10, 20]),
    });

    assert.deepStrictEqual(result, { action: "idle", reason: "working-timeout", updateTimestamp: true });
  });

  it("does not extend remote Codex working sessions", () => {
    const { result } = decision(session({
      state: "working",
      agentId: "codex",
      host: "ssh:example.com",
      updatedAt: 1000000 - WORKING_STALE_MS - 1,
      sourcePid: null,
    }));
    assert.deepStrictEqual(result, { action: "idle", reason: "working-timeout", updateTimestamp: true });
  });

  it("honors a configured detachedIdleStaleMs cutoff", () => {
    const { result } = decision(session({
      updatedAt: 1000000 - 6_000,
      sourcePid: 20,
    }), {
      staleConfig: { detachedIdleStaleMs: 5_000 },
      deriveSessionBadge: () => "done",
      shouldAutoClearDetachedSession: () => true,
    });
    assert.deepStrictEqual(result, { action: "delete", reason: "detached-ended", badge: "done" });
  });

  it("ignores non-finite staleConfig fields and falls back to defaults", () => {
    // Garbage values in any field must not break the decision.
    const { result } = decision(session({
      updatedAt: 1000000 - SESSION_STALE_MS - 1,
      pidReachable: false,
    }), {
      staleConfig: {
        sessionStaleMs: "not a number",
        workingStaleMs: null,
        detachedIdleStaleMs: NaN,
      },
    });
    assert.deepStrictEqual(result, { action: "delete", reason: "unreachable" });
  });

  // ── PR2 — requiresCompletionAck + ackedAt + global referenceTs ──

  it("un-acked remote session with old updatedAt still deletes (regression: referenceTs falls back to updatedAt)", () => {
    const { result } = decision(session({
      updatedAt: 1000000 - 11 * 60 * 1000,
      pidReachable: false,
    }), {
      staleConfig: { sessionStaleMs: 10 * 60 * 1000 },
    });
    assert.deepStrictEqual(result, { action: "delete", reason: "unreachable" });
  });

  it("requiresCompletionAck within the session timeout is kept (done badge stays visible)", () => {
    // Completion already pushed a notification; the session lingers only long
    // enough for the user to spot the `done` badge — bounded by sessionStaleMs.
    const { result } = decision(session({
      updatedAt: 1000000 - 3 * 60 * 1000,
      pidReachable: false,
      requiresCompletionAck: true,
    }), {
      staleConfig: { sessionStaleMs: 10 * 60 * 1000 },
    });
    assert.deepStrictEqual(result, { action: null });
  });

  it("requiresCompletionAck no longer holds a remote session past the session timeout", () => {
    // The completion notification already fired once, so an unacknowledged
    // remote session deletes at the user-configured timeout like any other
    // idle one — it does not get the old 24h hold.
    const { result } = decision(session({
      updatedAt: 1000000 - 11 * 60 * 1000,
      pidReachable: false,
      requiresCompletionAck: true,
    }), {
      staleConfig: { sessionStaleMs: 10 * 60 * 1000 },
    });
    assert.deepStrictEqual(result, { action: "delete", reason: "unreachable" });
  });

  it("requiresCompletionAck with sessionStaleMs=0 is kept forever, like a normal idle session", () => {
    const now = 2_000_000_000_000;
    const { result } = decision(session({
      state: "idle",
      updatedAt: now - 86_400_000 - 1,
      pidReachable: false,
      requiresCompletionAck: true,
    }), {
      now,
      staleConfig: { sessionStaleMs: 0 },
    });
    assert.deepStrictEqual(result, { action: null });
  });

  it("agent-exit wins over requiresCompletionAck", () => {
    const { result } = decision(session({
      agentPid: 99,
      pidReachable: true,
      requiresCompletionAck: true,
    }), {
      alivePids: new Set(),
    });
    assert.deepStrictEqual(result, { action: "delete", reason: "agent-exit" });
  });

  // ── WSL sessions never probe the Windows host with Linux PIDs ──
});
