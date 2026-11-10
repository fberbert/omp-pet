"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { isSessionInProgress, buildDisplaySessionTag, buildSessionSnapshotEntry, buildSessionSnapshot, sessionSnapshotSignature, shouldAutoClearDetachedSession, sessionDisplayTitle, normalizeTitle } = require("../src/state-session-snapshot");
const { makeSessionKey } = require("../src/session-key");

describe("normalizeTitle", () => {
  it("strips Unicode bidi formatting marks before UI snapshots", () => {
    assert.strictEqual(
      normalizeTitle("safe\u061c\u200efile\u202etxt.exe\u2066done\u2069"),
      "safe file txt.exe done"
    );
  });

  it("does not split astral characters or preserve unpaired surrogates", () => {
    const truncated = normalizeTitle(`${"A".repeat(78)}😀BC`);
    assert.strictEqual(truncated, `${"A".repeat(78)}😀…`);
    assert.strictEqual(truncated.isWellFormed(), true);
    assert.strictEqual(Array.from(truncated).length, 80);
    assert.strictEqual(normalizeTitle("before\uD83Dmiddle\uDC00after"), "before�middle�after");
  });
});

const STATE_PRIORITY = {
  error: 8,
  notification: 7,
  sweeping: 6,
  attention: 5,
  carrying: 4,
  juggling: 4,
  working: 3,
  thinking: 2,
  idle: 1,
  sleeping: 0,
};

function session(state, overrides = {}) {
  return {
    state,
    updatedAt: 1000,
    cwd: "",
    agentId: "claude-code",
    recentEvents: [],
    ...overrides,
  };
}

describe("startup-recovered session snapshots", () => {
  it("does not expose the internal prompt-derived title flag (#1125)", () => {
    const snapshot = buildSessionSnapshot(new Map([
      ["real-session", session("working", {
        sessionTitle: "Prompt line",
        sessionTitleFromPrompt: true,
      })],
    ]), { statePriority: STATE_PRIORITY });

    assert.strictEqual(snapshot.sessions[0].sessionTitle, "Prompt line");
    assert.ok(!("sessionTitleFromPrompt" in snapshot.sessions[0]));
  });
});

describe("display session tags", () => {
  it("hashes legal canonical ids into stable 10-hex display tags", () => {
    const canonical = makeSessionKey({
      profileId: "local",
      rawSessionId: "token-1234567890-abcdef",
    });

    assert.strictEqual(canonical, "s1.bG9jYWw.dG9rZW4tMTIzNDU2Nzg5MC1hYmNkZWY");
    assert.strictEqual(buildDisplaySessionTag(canonical), "83aacb6af9");
    assert.match(buildDisplaySessionTag(canonical), /^[0-9a-f]{10}$/);
  });

  it("returns an empty tag for missing, non-string, or blank ids", () => {
    for (const value of [null, undefined, "", "   ", 42, true, {}, []]) {
      assert.strictEqual(buildDisplaySessionTag(value), "", String(value));
    }
  });

  it("distinguishes real Codex UUIDv7-shaped raw ids after canonicalization", () => {
    const first = makeSessionKey({
      profileId: "local",
      rawSessionId: "codex:019e115a-4df2-7ed0-b90e-8e6345aca777",
    });
    const second = makeSessionKey({
      profileId: "local",
      rawSessionId: "codex:019e115b-4df2-7ed0-b90e-8e6345aca777",
    });

    assert.strictEqual(buildDisplaySessionTag(first), "732d7659d7");
    assert.strictEqual(buildDisplaySessionTag(second), "b8a6f6f6ac");
    assert.notStrictEqual(buildDisplaySessionTag(first), buildDisplaySessionTag(second));
  });

  it("distinguishes the same raw id in different remote profiles", () => {
    const rawSessionId = "same-visible-id";
    const a = makeSessionKey({ profileId: "profile-a", rawSessionId });
    const b = makeSessionKey({ profileId: "profile-b", rawSessionId });

    assert.notStrictEqual(buildDisplaySessionTag(a), buildDisplaySessionTag(b));
  });

  it("snapshot entries expose a tag derived only from the canonical id", () => {
    const id = makeSessionKey({ profileId: "local", rawSessionId: "codex:019e115a-4df2-7ed0-b90e-8e6345aca777" });
    const withRaw = buildSessionSnapshotEntry(id, session("working", {
      rawSessionId: "codex:019e115a-4df2-7ed0-b90e-8e6345aca777",
    }));
    const withoutRaw = buildSessionSnapshotEntry(id, session("working"));

    assert.strictEqual(withRaw.displaySessionTag, "732d7659d7");
    assert.strictEqual(withoutRaw.displaySessionTag, withRaw.displaySessionTag);
    for (const forbidden of ["s1.", "bG9", "codex:", "019e11"]) {
      assert.strictEqual(withRaw.displaySessionTag.includes(forbidden), false, forbidden);
    }
  });
});

describe("isSessionInProgress state mapping", () => {
  it("treats persisted running states as in-progress and idle/sleeping/headless as not", () => {
    assert.strictEqual(isSessionInProgress(session("working")), true);
    assert.strictEqual(isSessionInProgress(session("thinking")), true);
    assert.strictEqual(isSessionInProgress(session("juggling")), true);
    assert.strictEqual(isSessionInProgress(session("idle")), false);
    assert.strictEqual(isSessionInProgress(session("sleeping")), false);
  });

  it("keeps a local OpenCode working session in the blocker-facing in-progress set", () => {
    const active = session("working", { agentId: "opencode" });
    assert.strictEqual(isSessionInProgress(active), true);
    assert.strictEqual(isSessionInProgress({ ...active, state: "idle" }), false);
  });

  it("never counts headless sessions, even when active", () => {
    assert.strictEqual(isSessionInProgress(session("working", { headless: true })), false);
    assert.strictEqual(isSessionInProgress(session("thinking", { headless: true })), false);
  });

  it("returns false for nullish sessions", () => {
    assert.strictEqual(isSessionInProgress(null), false);
    assert.strictEqual(isSessionInProgress(undefined), false);
  });
});

describe("sessionDisplayTitle cwd fallback", () => {
  it("preserves backslashes that are part of a POSIX path component", () => {
    assert.strictEqual(
      sessionDisplayTitle("claude:abc123", session("working", { cwd: "/tmp/project\\name" })),
      "project\\name"
    );
    assert.strictEqual(
      sessionDisplayTitle("claude:abc123", session("working", { cwd: "/\\mount/project\\name" })),
      "project\\name"
    );
  });

  it("keeps the cwd basename for non-QoderWork agents even inside a QoderWork workspace dir", () => {
    assert.strictEqual(
      sessionDisplayTitle("claude:xyz789", session("working", { agentId: "claude-code", cwd: "/Users/me/.qoderwork/workspace/mqgw60jiigjsjcid" })),
      "mqgw60jiigjsjcid"
    );
  });

  // ── #843: QwenWork's internal workspace ──────────────────────────────────
  // qwenwork-hook.js correctly refuses to send cwd as session_title, but the
  // server-side basename fallback below is what actually reaches the HUD /
  // Dashboard / session menu — and it only knew about ~/.qoderwork/workspace,
  // so ~/.QwenWorkCN/workspace/<id> still surfaced as "mqgw60jiigjsjcid".
  describe("QwenWork internal workspace (#843)", () => {
    const qwen = (overrides) => session("working", { agentId: "qwenwork", ...overrides });

    it("lets an explicit agentId beat a contradictory session-id prefix", () => {
      // Tightening vs the previous QoderWork-only check, which OR'd the two
      // signals: a session that says it belongs to another agent is not
      // silently reclassified by its id string.
      assert.strictEqual(
        sessionDisplayTitle(
          "qwenwork:abc123",
          session("working", { agentId: "claude-code", cwd: "/Users/me/.QwenWorkCN/workspace/mqgw60jiigjsjcid" })
        ),
        "mqgw60jiigjsjcid"
      );
      assert.strictEqual(
        sessionDisplayTitle(
          "qwenwork:abc123",
          session("working", { agentId: "claude-code", cwd: "" })
        ),
        "qwenwo..",
        "the namespace is only stripped when it agrees with the explicit agent"
      );
    });

    it("keeps the basename for other agents inside the same directory", () => {
      // The suppression is an agent↔path pairing: for any other agent that
      // directory is just a cwd the user chose, so its name is real information.
      assert.strictEqual(
        sessionDisplayTitle(
          "claude:xyz789",
          session("working", { agentId: "claude-code", cwd: "/Users/me/.QwenWorkCN/workspace/mqgw60jiigjsjcid" })
        ),
        "mqgw60jiigjsjcid"
      );
      assert.strictEqual(
        sessionDisplayTitle(
          "qoderwork:xyz789",
          session("working", { agentId: "qoderwork", cwd: "/Users/me/.QwenWorkCN/workspace/mqgw60jiigjsjcid" })
        ),
        "mqgw60jiigjsjcid",
        "QoderWork must not inherit QwenWork's path rule"
      );
    });

    it("still prefers a real session title over the id shortening", () => {
      assert.strictEqual(
        sessionDisplayTitle("qwenwork:abc123", qwen({
          cwd: "/Users/me/.QwenWorkCN/workspace/mqgw60jiigjsjcid",
          sessionTitle: "Refactor auth module",
        })),
        "Refactor auth module"
      );
    });
  });
});

describe("state-session-snapshot builder", () => {
  it("offers the terminal jump for a herdr-hosted session with a Desktop originator (#1139)", () => {
    const snapshot = buildSessionSnapshot(new Map([
      ["codex:019e115a-4df2-7ed0-b90e-8e6345aca777", session("working", {
        agentId: "codex",
        codexOriginator: "codex_work_desktop",
        sourcePid: 900,
        herdrPaneId: "w1:p1",
        herdrSocket: "/tmp/herdr.sock",
      })],
    ]), { focusHostPlatform: "darwin" });

    const [entry] = snapshot.sessions;
    assert.strictEqual(entry.canFocus, true);
    // The Dashboard button label follows this type: "terminal" renders the
    // terminal jump, "codex-thread" the "open Codex session" deep link.
    assert.deepStrictEqual(entry.focusTarget, { type: "terminal", url: null });
  });

  it("ignores internal context authority when computing the renderer snapshot signature", () => {
    const opts = { statePriority: STATE_PRIORITY };
    const transcript = buildSessionSnapshot(new Map([
      ["s1", session("working", {
        contextUsage: { used: 1000, limit: 200000, percent: 1, source: "claude" },
        contextUsageOrigin: "claude-transcript",
      })],
    ]), opts);
    const statusline = buildSessionSnapshot(new Map([
      ["s1", session("working", {
        contextUsage: { used: 1000, limit: 200000, percent: 1, source: "claude" },
        contextUsageOrigin: "claude-statusline",
      })],
    ]), opts);

    assert.strictEqual(sessionSnapshotSignature(transcript), sessionSnapshotSignature(statusline));
  });

  // Account quota is session-independent (src/state-account-quota.js): it
  // enters the snapshot as a top-level list injected by the caller, never
  // as a per-session field.

  it("marks detached ended idle sessions hidden from HUD only when cleanup is enabled and pid is dead", () => {
    const sessions = new Map([
      ["done-local", session("idle", {
        updatedAt: 3000,
        sourcePid: 9999,
        pidReachable: true,
        recentEvents: [{ event: "Stop", state: "attention", at: 2900 }],
      })],
      ["idle-local", session("idle", {
        updatedAt: 2000,
        sourcePid: 9998,
        pidReachable: true,
        recentEvents: [{ event: "AfterAgent", state: "idle", at: 1900 }],
      })],
    ]);

    const snapshot = buildSessionSnapshot(sessions, {
      statePriority: STATE_PRIORITY,
      sessionHudCleanupDetached: true,
      isProcessAlive: () => false,
    });

    assert.strictEqual(snapshot.sessions.find((entry) => entry.id === "done-local").hiddenFromHud, true);
    assert.strictEqual(snapshot.sessions.find((entry) => entry.id === "idle-local").hiddenFromHud, false);
    assert.strictEqual(snapshot.hudTotalNonIdle, 1);
    assert.strictEqual(snapshot.hudLastSessionId, "idle-local");
  });

  it("keeps Codex Desktop sessions that share one agent process visible in HUD", () => {
    const snapshot = buildSessionSnapshot(new Map([
      ["codex:desktop-a", session("working", {
        agentId: "codex",
        agentPid: 4242,
        codexOriginator: "codex_work_desktop",
        updatedAt: 1000,
        cwd: "/repo/a",
      })],
      ["codex:desktop-b", session("thinking", {
        agentId: "codex",
        agentPid: 4242,
        codexOriginator: "codex_work_desktop",
        updatedAt: 2000,
        cwd: "/repo/b",
      })],
      ["codex:guardian", session("working", {
        agentId: "codex",
        agentPid: 4242,
        codexOriginator: "codex_work_desktop",
        headless: true,
        updatedAt: 3000,
        cwd: "/repo/b",
      })],
    ]), {
      statePriority: STATE_PRIORITY,
      getAgentIconUrl: () => null,
    });

    assert.strictEqual(snapshot.sessions.find((entry) => entry.id === "codex:desktop-a").hiddenFromHud, false);
    assert.strictEqual(snapshot.sessions.find((entry) => entry.id === "codex:desktop-b").hiddenFromHud, false);
    assert.strictEqual(snapshot.sessions.find((entry) => entry.id === "codex:guardian").headless, true);
    assert.strictEqual(snapshot.sessions.find((entry) => entry.id === "codex:guardian").hiddenFromHud, false);
    assert.strictEqual(snapshot.hudTotalNonIdle, 2);
    assert.strictEqual(snapshot.hudLastSessionId, "codex:desktop-b");
  });

  it("snapshot signatures include visible fields but ignore icon URL churn", () => {
    const base = buildSessionSnapshot(new Map([
      ["s1", session("working", {
        updatedAt: 1000,
        sessionTitle: "Title",
        recentEvents: [{ event: "PreToolUse", state: "working", at: 900 }],
      })],
    ]), {
      statePriority: STATE_PRIORITY,
      getAgentIconUrl: () => "icon:a",
    });
    const sameExceptIcon = buildSessionSnapshot(new Map([
      ["s1", session("working", {
        updatedAt: 1000,
        sessionTitle: "Title",
        recentEvents: [{ event: "PreToolUse", state: "working", at: 900 }],
      })],
    ]), {
      statePriority: STATE_PRIORITY,
      getAgentIconUrl: () => "icon:b",
    });
    const differentTitle = buildSessionSnapshot(new Map([
      ["s1", session("working", {
        updatedAt: 1000,
        sessionTitle: "Other title",
        recentEvents: [{ event: "PreToolUse", state: "working", at: 900 }],
      })],
    ]), {
      statePriority: STATE_PRIORITY,
      getAgentIconUrl: () => "icon:a",
    });

    assert.strictEqual(sessionSnapshotSignature(base), sessionSnapshotSignature(sameExceptIcon));
    assert.notStrictEqual(sessionSnapshotSignature(base), sessionSnapshotSignature(differentTitle));
  });

  // #590 B2 — metadataUpdatedAt is a display-arbitration freshness stamp: it
  // must reach renderers via the snapshot but stay out of the signature (like
  // updatedAt), so stamping it can never re-trigger a broadcast by itself.

  // ── PR2: requiresCompletionAck exposure ──

  it("ackedAt stays internal — does NOT appear in the snapshot entry", () => {
    const snapshot = buildSessionSnapshot(new Map([
      ["a", session("idle", { ackedAt: 12345, requiresCompletionAck: false })],
    ]), { statePriority: STATE_PRIORITY, getAgentIconUrl: () => null });
    const entry = snapshot.sessions.find((s) => s.id === "a");
    assert.strictEqual(Object.prototype.hasOwnProperty.call(entry, "ackedAt"), false);
  });

  it("exposes a resolved custom agent name and includes it in the snapshot signature", () => {
    const sessions = new Map([
      ["custom-session", session("working", { agentId: "custom-nova-0123456789ab" })],
    ]);
    const nova = buildSessionSnapshot(sessions, {
      statePriority: STATE_PRIORITY,
      getAgentIconUrl: () => null,
      resolveAgentDisplayName: () => "Nova AI",
    });
    const renamed = buildSessionSnapshot(sessions, {
      statePriority: STATE_PRIORITY,
      getAgentIconUrl: () => null,
      resolveAgentDisplayName: () => "Nova Desktop",
    });

    assert.strictEqual(nova.sessions[0].agentName, "Nova AI");
    assert.notStrictEqual(sessionSnapshotSignature(nova), sessionSnapshotSignature(renamed));
  });
});

describe("shouldAutoClearDetachedSession WSL guard", () => {
  it("still clears a local detached-ended session whose source is gone", () => {
    let probes = 0;
    const hidden = shouldAutoClearDetachedSession(
      {
        state: "idle",
        headless: false,
        pidReachable: true,
        sourcePid: 20,
      },
      "done",
      {
        sessionHudCleanupDetached: true,
        isProcessAlive: () => { probes += 1; return false; },
      }
    );
    assert.strictEqual(hidden, true);
    assert.strictEqual(probes, 1);
  });
});

