"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { createConnectionTestDeduper, evaluateConnectionTest, runConnectionTest } = require("../src/doctor-hook-activity");

describe("doctor hook activity connection test", () => {
  it("passes when any HTTP event was accepted", () => {
    const result = evaluateConnectionTest({
      events: [{ agentId: "codex", route: "state", outcome: "accepted" }],
    });

    assert.strictEqual(result.status, "http-verified");
    assert.strictEqual(result.level, null);
    assert.match(result.detail, /codex/);
  });

  it("uses the resolved custom application name in summaries", () => {
    const result = evaluateConnectionTest({
      events: [{
        agentId: "custom-nova-0123456789ab",
        route: "state",
        outcome: "accepted",
      }],
      resolveAgentDisplayName: () => "Nova AI",
    });

    assert.strictEqual(result.status, "http-verified");
    assert.match(result.detail, /Nova AI/);
    assert.doesNotMatch(result.detail, /custom-nova/);
  });

  it("warns when HTTP works but events are dropped by gates", () => {
    const result = evaluateConnectionTest({
      events: [
        { agentId: "claude-code", route: "state", outcome: "dropped-by-dnd" },
        { agentId: "codex", route: "permission", outcome: "dropped-by-disabled" },
      ],
    });

    assert.strictEqual(result.status, "http-dropped");
    assert.strictEqual(result.level, "warning");
    assert.match(result.detail, /dropped-by-disabled/);
    assert.match(result.detail, /dropped-by-dnd/);
  });

  it("treats invalid and unsupported custom activity as dropped, never verified", () => {
    const result = evaluateConnectionTest({
      events: [
        { agentId: "rejected-custom", route: "state", outcome: "dropped-invalid-agent" },
        { agentId: "custom-nova-0123456789ab", route: "permission", outcome: "dropped-unsupported" },
      ],
    });

    assert.strictEqual(result.status, "http-dropped");
    assert.strictEqual(result.level, "warning");
  });

  it("keeps observed HTTP outcomes ahead of Codex hook review state", () => {
    const shared = {
      fileActivity: [{ agentId: "codex", source: "file-mtime", count: 1 }],
      codexHookHealth: { signature: "needs-review", status: "needs-review" },
    };
    const accepted = evaluateConnectionTest({
      ...shared,
      events: [{ agentId: "claude-code", route: "state", outcome: "accepted" }],
    });
    const dropped = evaluateConnectionTest({
      ...shared,
      events: [{ agentId: "codex", route: "state", outcome: "dropped-by-disabled" }],
    });

    assert.strictEqual(accepted.status, "http-verified");
    assert.strictEqual(dropped.status, "http-dropped");
  });

  it("warns when nothing changed during the window", () => {
    const result = evaluateConnectionTest({});

    assert.strictEqual(result.status, "no-activity");
    assert.strictEqual(result.level, "warning");
  });

  it("waits for the requested window and then evaluates server events", async () => {
    let waited = 0;
    const result = await runConnectionTest({
      durationMs: 1000,
      startedAt: Date.now() - 1,
      setTimeout: (fn, ms) => {
        waited = ms;
        fn();
      },
      server: {
        getRecentHookEvents: () => [{ agentId: "codex", route: "state", outcome: "accepted" }],
      },
      fileActivity: [],
    });

    assert.strictEqual(waited, 1000);
    assert.strictEqual(result.status, "http-verified");
    assert.strictEqual(result.events.length, 1);
  });

  it("deduplicates concurrent connection tests and resets after completion", async () => {
    let calls = 0;
    const resolvers = [];
    const completed = [];
    const runGuarded = createConnectionTestDeduper((input) => {
      calls++;
      return new Promise((resolve) => {
        resolvers.push(() => resolve({ status: "ok", marker: input.marker }));
      });
    }, {
      onResult: (result) => completed.push(result.marker),
    });

    const first = runGuarded({ marker: "first" });
    const second = runGuarded({ marker: "second" });
    assert.strictEqual(first, second);
    assert.strictEqual(calls, 1);

    resolvers.shift()();
    assert.deepStrictEqual(await second, { status: "ok", marker: "first" });
    assert.deepStrictEqual(completed, ["first"]);

    const third = runGuarded({ marker: "third" });
    assert.notStrictEqual(third, first);
    assert.strictEqual(calls, 2);
    resolvers.shift()();
    assert.deepStrictEqual(await third, { status: "ok", marker: "third" });
    assert.deepStrictEqual(completed, ["first", "third"]);
  });
});
