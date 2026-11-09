"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const createFloatingWindowRuntime = require("../src/floating-window-runtime");

function makeWindow(label, calls, destroyed = false) {
  return {
    isDestroyed: () => destroyed,
    showInactive: () => calls.push(["show", label]),
    hide: () => calls.push(["hide", label]),
  };
}

describe("floating-window-runtime", () => {
  it("repositions permission bubbles only when pending entries exist", () => {
    const calls = [];
    const pending = [];
    const runtime = createFloatingWindowRuntime({
      getPendingPermissions: () => pending,
      repositionPermissionBubbles: () => calls.push("permission"),
      repositionQuotaRing: () => calls.push("ring"),
    });

    runtime.repositionFloatingBubbles();
    pending.push({ bubble: {} });
    runtime.repositionFloatingBubbles();

    assert.deepStrictEqual(calls, ["ring", "permission", "ring"]);
  });

  it("keeps anchored surface ordering as HUD first, then dependent bubbles", () => {
    const calls = [];
    const runtime = createFloatingWindowRuntime({
      getPendingPermissions: () => [{ bubble: {} }],
      repositionSessionHud: () => calls.push("hud"),
      repositionPermissionBubbles: () => calls.push("permission"),
      repositionQuotaRing: () => calls.push("ring"),
    });

    runtime.repositionAnchoredSurfaces();

    assert.deepStrictEqual(calls, ["hud", "permission", "ring"]);
  });

  it("syncs Session HUD visibility before repositioning dependent bubbles", () => {
    const calls = [];
    const runtime = createFloatingWindowRuntime({
      getPendingPermissions: () => [{ bubble: {} }],
      syncSessionHudVisibility: () => calls.push("syncHud"),
      repositionPermissionBubbles: () => calls.push("permission"),
      repositionQuotaRing: () => calls.push("ring"),
    });

    runtime.syncSessionHudVisibilityAndBubbles();

    assert.deepStrictEqual(calls, ["syncHud", "permission", "ring"]);
  });

  it("shows and hides only live permission bubbles with the pet", () => {
    const calls = [];
    const live = makeWindow("live", calls);
    const destroyed = makeWindow("destroyed", calls, true);
    const runtime = createFloatingWindowRuntime({
      getPendingPermissions: () => [{ bubble: live }, { bubble: destroyed }, { bubble: null }],
      keepOutOfTaskbar: (win) => calls.push(["taskbar", win === live ? "live" : "other"]),
    });

    runtime.showFloatingSurfacesForPet();
    runtime.hideFloatingSurfacesForPet();

    assert.deepStrictEqual(calls, [
      ["show", "live"],
      ["taskbar", "live"],
      ["hide", "live"],
    ]);
  });

  it("exit clears fullscreen suppression even when the new scope excludes approvals", () => {
    const calls = [];
    const runtime = createFloatingWindowRuntime({
      setPermissionSurfacesFullscreenSuppressed: (value) => calls.push(["permission", value]),
    });
    runtime.setFullscreenSuppressedForPet(true, { includePermissionSurfaces: false });
    assert.deepStrictEqual(calls, []);
    runtime.setFullscreenSuppressedForPet(false, { includePermissionSurfaces: false });
    assert.deepStrictEqual(calls, [["permission", false]]);
  });
});
