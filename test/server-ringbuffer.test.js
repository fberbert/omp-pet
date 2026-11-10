"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { HOOK_EVENT_RING_SIZE_PER_AGENT, recordHookEventInBuffer, getRecentHookEventsFromBuffer } = require("../src/server-hook-events");

function hookIdentity(agentId) {
  return { agentId, source: "explicit", defaulted: false };
}

describe("server hook event ringbuffer", () => {
  it("caps each agent ring at 50 events", () => {
    const buffer = new Map();
    for (let i = 0; i < HOOK_EVENT_RING_SIZE_PER_AGENT + 7; i++) {
      recordHookEventInBuffer(buffer, hookIdentity("codex"), {
        agent_id: "codex",
        event: `E${i}`,
      }, "state", "accepted", { now: () => i });
    }

    const events = getRecentHookEventsFromBuffer(buffer);
    assert.strictEqual(events.length, HOOK_EVENT_RING_SIZE_PER_AGENT);
    assert.strictEqual(events[0].eventType, "E7");
    assert.strictEqual(events.at(-1).eventType, `E${HOOK_EVENT_RING_SIZE_PER_AGENT + 6}`);
  });

  it("attributes hook events by hook_source when agent_id is missing", () => {
    const buffer = new Map();
    recordHookEventInBuffer(buffer, hookIdentity("opencode"), {
      hook_source: "opencode-plugin",
      event: "PreToolUse",
    }, "state", "accepted", { now: () => 10 });

    const events = getRecentHookEventsFromBuffer(buffer);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].agentId, "opencode");
    assert.strictEqual(events[0].eventType, "PreToolUse");
  });

  it("filters recent hook events by agent and timestamp and returns copies", () => {
    const buffer = new Map();
    recordHookEventInBuffer(buffer, hookIdentity("codex"), { agent_id: "codex", event: "Old" }, "state", "accepted", { now: () => 10 });
    recordHookEventInBuffer(buffer, hookIdentity("codex"), { agent_id: "codex", event: "New" }, "state", "accepted", { now: () => 20 });
    recordHookEventInBuffer(buffer, hookIdentity("gemini-cli"), { agent_id: "gemini-cli", event: "Other" }, "state", "accepted", { now: () => 30 });

    const events = getRecentHookEventsFromBuffer(buffer, { agentId: "codex", since: 20 });

    assert.deepStrictEqual(events.map(({ agentId, eventType, timestamp }) => ({ agentId, eventType, timestamp })), [{
      agentId: "codex",
      eventType: "New",
      timestamp: 20,
    }]);
    events[0].eventType = "mutated";
    assert.strictEqual(buffer.get("codex")[1].eventType, "New");
  });
});
