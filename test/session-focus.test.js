"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { getFocusableLocalHudSessionIds, isFocusableLocalHudSession } = require("../src/session-focus");

describe("session focus helpers", () => {
  it("rejects malformed entries defensively", () => {
    assert.strictEqual(isFocusableLocalHudSession(null), false);
    assert.strictEqual(isFocusableLocalHudSession({ sourcePid: 1 }), false);
    assert.deepStrictEqual(getFocusableLocalHudSessionIds({ sessions: "bad" }), []);
    assert.deepStrictEqual(getFocusableLocalHudSessionIds(null), []);
  });
});
