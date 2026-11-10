"use strict";

const test = require("node:test");
const assert = require("node:assert");

const systemActions = require("../src/settings-actions-system");

test("settings system actions normalize local server repair failures", async () => {
  const result = await systemActions.repairLocalServer(null, {
    repairLocalServer: async () => false,
  });

  assert.strictEqual(result.status, "error");
  assert.match(result.message, /Local server repair failed/);
});

test("settings system actions require restart confirmation", () => {
  const calls = [];
  const result = systemActions.restartClawd({}, {
    restartClawd: () => calls.push("restart"),
  });

  assert.strictEqual(result.status, "error");
  assert.match(result.message, /confirmation/);
  assert.deepStrictEqual(calls, []);
});
