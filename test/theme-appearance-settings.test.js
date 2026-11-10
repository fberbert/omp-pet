"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const prefs = require("../src/prefs");
const {
  updateRegistry,
  buildThemeScopedPrefsCommit,
} = require("../src/settings-actions");

describe("issue #1323: theme appearance preferences", () => {
  it("issue #1323: normalization drops unsafe ids and unknown appearances", () => {
    const snapshot = prefs.validate({
      themeAppearance: {
        night: "dark",
        clawd: "light",
        "../escape": "dark",
        auto: "auto",
        missing: 1,
      },
    });
    assert.deepStrictEqual(snapshot.themeAppearance, { night: "dark", clawd: "light" });
    assert.deepStrictEqual(prefs.validate({}).themeAppearance, {});
  });

  it("issue #1323: the settings validator accepts only safe ids mapped to light or dark", () => {
    const deps = { snapshot: prefs.getDefaults() };
    assert.strictEqual(updateRegistry.themeAppearance({}, deps).status, "ok");
    assert.strictEqual(
      updateRegistry.themeAppearance({ night: "dark", clawd: "light" }, deps).status,
      "ok"
    );
    assert.strictEqual(updateRegistry.themeAppearance("dark", deps).status, "error");
    assert.strictEqual(updateRegistry.themeAppearance({ night: "auto" }, deps).status, "error");
    assert.strictEqual(updateRegistry.themeAppearance({ "../escape": "dark" }, deps).status, "error");
  });

  it("issue #1323: removing a theme drops its appearance preference", () => {
    const commit = buildThemeScopedPrefsCommit("night", {
      themeAppearance: { night: "dark", clawd: "light" },
    });
    assert.deepStrictEqual(commit.themeAppearance, { clawd: "light" });
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(commit.themeAppearance, "night"),
      false
    );
  });
});
