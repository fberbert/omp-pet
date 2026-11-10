// test/focus-linux.test.js — window raise for local sessions (wmctrl, then xdotool)

const { describe, it } = require("node:test");
const assert = require("node:assert");
const { loadFocusWithMock } = require("./helpers/load-focus-with-mock");

function makeMock(handlers) {
  const calls = [];
  function mock(cmd, args, opts, cb) {
    if (typeof opts === "function") { cb = opts; opts = {}; }
    calls.push({ cmd, args: [...args] });
    const handler = handlers[cmd];
    if (handler) handler(args, cb);
    else if (cb) cb(null, "", "");
  }
  return { calls, mock };
}

function focusWith(handlers, request) {
  const { calls, mock } = makeMock(handlers);
  const { initFocus, cleanup } = loadFocusWithMock(mock);
  try {
    const focus = initFocus({});
    focus.__test.setTmuxBin("");
    const result = focus.focusTerminalWindow(request);
    return { calls, result };
  } finally {
    cleanup();
  }
}

describe("focusTerminalWindow on Linux", () => {
  it("activates the wmctrl window that belongs to the source pid", () => {
    const { calls, result } = focusWith({
      wmctrl: (args, cb) => {
        if (args[0] === "-lp") cb(null, "0x01 0 111 host other\n0x02 0 4242 host term\n", "");
        else cb(null, "", "");
      },
    }, { sourcePid: 4242, cwd: "/work" });

    assert.strictEqual(result.reason, "linux-command-submitted");
    assert.deepStrictEqual(
      calls.filter((c) => c.cmd === "wmctrl").map((c) => c.args),
      [["-lp"], ["-i", "-a", "0x02"]],
    );
    assert.strictEqual(calls.some((c) => c.cmd === "xdotool"), false);
  });

  it("falls back to xdotool when wmctrl has no window for the pid", () => {
    const { calls } = focusWith({
      wmctrl: (args, cb) => cb(null, "0x01 0 111 host other\n", ""),
    }, { sourcePid: 4242 });

    const xdotool = calls.find((c) => c.cmd === "xdotool");
    assert.deepStrictEqual(xdotool && xdotool.args, ["search", "--pid", "4242", "windowactivate", "--sync"]);
  });

  it("does nothing without a source pid", () => {
    const { calls, result } = focusWith({}, { cwd: "/work" });
    assert.strictEqual(result.reason, "no-source-pid");
    assert.deepStrictEqual(calls, []);
  });
});
