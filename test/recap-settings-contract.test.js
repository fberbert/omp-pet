"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const prefs = require("../src/prefs");
const { updateRegistry } = require("../src/settings-actions");
const createSettingsEffectRouter = require("../src/settings-effect-router");

function controller(snapshot) {
  const listeners = new Set();
  return {
    getSnapshot: () => snapshot,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    subscribeKey() { return () => {}; },
    emit(payload) { for (const listener of listeners) listener(payload); },
  };
}

test("recap is enabled by default and only accepts a boolean toggle", () => {
  assert.equal(prefs.getDefaults().recapEnabled, true);
  assert.deepEqual(updateRegistry.recapEnabled(false), { status: "ok" });
  assert.equal(updateRegistry.recapEnabled("false").status, "error");
});

test("settings effect router applies recap toggle after the preference commit", () => {
  const settingsController = controller(prefs.getDefaults());
  const values = [];
  const router = createSettingsEffectRouter({
    settingsController,
    setRecapEnabled: (value) => values.push(value),
  });
  router.start();
  settingsController.emit({ changes: { recapEnabled: false } });
  settingsController.emit({ changes: { recapEnabled: true } });
  assert.deepEqual(values, [false, true]);
  router.dispose();
});
