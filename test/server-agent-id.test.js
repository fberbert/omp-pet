"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { DEFAULT_HOOK_AGENT_ID, resolveHookAgentId } = require("../src/server-agent-id");

describe("resolveHookAgentId", () => {
  it("truncates overlong rejected custom ids for diagnostics", () => {
    const resolved = resolveHookAgentId({ agent_id: `custom-${"x".repeat(200)}` });
    assert.strictEqual(resolved.rejected, true);
    assert.strictEqual(resolved.rawAgentId.length, 80);
    assert.ok(resolved.rawAgentId.startsWith("custom-"));
  });

  it("defaults to claude-code when nothing identifies the agent", () => {
    for (const data of [{}, { agent_id: "" }, { agent_id: 42 }, { hook_source: "unknown-source" }]) {
      assert.deepStrictEqual(resolveHookAgentId(data), {
        agentId: DEFAULT_HOOK_AGENT_ID,
        source: "default",
        defaulted: true,
      });
    }
  });
});
