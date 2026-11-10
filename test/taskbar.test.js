const assert = require("assert");
const { describe, it } = require("node:test");

const { keepOutOfTaskbar } = require("../src/taskbar");

describe("keepOutOfTaskbar", () => {
  it("reasserts skipTaskbar on a live window", () => {
    const calls = [];
    keepOutOfTaskbar({ isDestroyed: () => false, setSkipTaskbar: (value) => calls.push(value) });
    assert.deepStrictEqual(calls, [true]);
  });

  it("leaves missing or destroyed windows alone", () => {
    const calls = [];
    keepOutOfTaskbar(null);
    keepOutOfTaskbar({ isDestroyed: () => true, setSkipTaskbar: (value) => calls.push(value) });
    assert.deepStrictEqual(calls, []);
  });
});
