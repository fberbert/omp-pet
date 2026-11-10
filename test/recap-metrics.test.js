const { describe, it } = require("node:test");
const assert = require("node:assert");
const { getAllAgents } = require("../agents/registry");
const {
  AGENT_METRIC_POLICIES,
  assertRegistryCoverage,
  getMetricSupport,
  mapRecapMetrics,
} = require("../src/recap-metrics");

describe("recap metric policies", () => {
  it("explicitly covers every registry agent", () => {
    assert.strictEqual(assertRegistryCoverage(), true);
    assert.deepStrictEqual(
      Object.keys(AGENT_METRIC_POLICIES).sort(),
      getAllAgents().map((agent) => agent.id).sort(),
    );
  });

  it("reports OMP session starts as unsupported, not zero", () => {
    assert.deepStrictEqual(getMetricSupport("omp"), {
      sessionsStarted: false,
      turnsCompleted: true,
      toolCalls: true,
    });
    assert.deepStrictEqual(mapRecapMetrics({
      agentId: "omp",
      event: "SessionStart",
      sessionStartSource: "startup",
      rawSessionId: "omp:abc",
    }), ["activity"]);
  });

  it("counts OMP PreToolUse as a tool call and nothing else", () => {
    assert.deepStrictEqual(mapRecapMetrics({ agentId: "omp", event: "PreToolUse" }), ["activity", "tool-call"]);
    assert.deepStrictEqual(mapRecapMetrics({ agentId: "omp", event: "PostToolUse" }), ["activity"]);
  });

  it("counts an OMP Stop only when the completion was accepted", () => {
    assert.deepStrictEqual(mapRecapMetrics({ agentId: "omp", event: "Stop", completionAccepted: false }), ["activity"]);
    assert.deepStrictEqual(mapRecapMetrics({ agentId: "omp", event: "Stop", completionAccepted: true }), ["activity", "turn-complete"]);
  });

  it("ignores unknown agents and malformed input", () => {
    assert.strictEqual(getMetricSupport("claude-code"), null);
    assert.strictEqual(mapRecapMetrics({ agentId: "claude-code", event: "PreToolUse" }), null);
    assert.strictEqual(mapRecapMetrics({ agentId: "omp", event: "" }), null);
    assert.strictEqual(mapRecapMetrics(null), null);
  });
});
