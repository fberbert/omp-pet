"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { updateRegistry, commandRegistry, requireBoolean, requireFiniteNumber, requireEnum, applyThemeSelection } = require("../src/settings-actions");
const prefs = require("../src/prefs");

describe("validator helpers", () => {
  it("requireBoolean accepts only booleans", () => {
    const v = requireBoolean("foo");
    assert.strictEqual(v(true).status, "ok");
    assert.strictEqual(v(false).status, "ok");
    assert.strictEqual(v("true").status, "error");
    assert.strictEqual(v(1).status, "error");
    assert.strictEqual(v(null).status, "error");
  });

  it("requireFiniteNumber rejects NaN/Infinity", () => {
    const v = requireFiniteNumber("x");
    assert.strictEqual(v(0).status, "ok");
    assert.strictEqual(v(-1).status, "ok");
    assert.strictEqual(v(NaN).status, "error");
    assert.strictEqual(v(Infinity).status, "error");
    assert.strictEqual(v("0").status, "error");
  });

  it("requireEnum rejects values outside the allowlist", () => {
    const v = requireEnum("k", ["a", "b"]);
    assert.strictEqual(v("a").status, "ok");
    assert.strictEqual(v("c").status, "error");
  });
});

describe("updateRegistry pure-data validators", () => {
  const baseSnapshot = prefs.getDefaults();

  it("lang validates against the enum", () => {
    assert.strictEqual(updateRegistry.lang("en", { snapshot: baseSnapshot }).status, "ok");
    assert.strictEqual(updateRegistry.lang("zh", { snapshot: baseSnapshot }).status, "ok");
    assert.strictEqual(updateRegistry.lang("ko", { snapshot: baseSnapshot }).status, "ok");
    assert.strictEqual(updateRegistry.lang("es", { snapshot: baseSnapshot }).status, "ok");
    assert.strictEqual(updateRegistry.lang("klingon", { snapshot: baseSnapshot }).status, "error");
  });

  it("size accepts S/M/L and P:<num>", () => {
    const deps = { snapshot: baseSnapshot };
    assert.strictEqual(updateRegistry.size("S", deps).status, "ok");
    assert.strictEqual(updateRegistry.size("M", deps).status, "ok");
    assert.strictEqual(updateRegistry.size("L", deps).status, "ok");
    assert.strictEqual(updateRegistry.size("P:10", deps).status, "ok");
    assert.strictEqual(updateRegistry.size("P:12.5", deps).status, "ok");
    assert.strictEqual(updateRegistry.size("XL", deps).status, "error");
    assert.strictEqual(updateRegistry.size("P:abc", deps).status, "error");
  });

  it("miniEdge accepts only left/right", () => {
    const deps = { snapshot: baseSnapshot };
    assert.strictEqual(updateRegistry.miniEdge("left", deps).status, "ok");
    assert.strictEqual(updateRegistry.miniEdge("right", deps).status, "ok");
    assert.strictEqual(updateRegistry.miniEdge("top", deps).status, "error");
  });

  it("petTint accepts only safe per-theme catalog selections", () => {
    const deps = { snapshot: baseSnapshot };
    assert.strictEqual(updateRegistry.petTint({}, deps).status, "ok");
    assert.strictEqual(
      updateRegistry.petTint({ clawd: "gold", cloudling: "matcha" }, deps).status,
      "ok"
    );
    assert.strictEqual(updateRegistry.petTint({ clawd: "none" }, deps).status, "error");
    assert.strictEqual(updateRegistry.petTint({ clawd: "custom" }, deps).status, "error");
    assert.strictEqual(
      updateRegistry.petTint({ "../unsafe": "gold" }, deps).status,
      "error"
    );
    assert.strictEqual(
      updateRegistry.petTint({ clawd: "url(file:///secret)" }, deps).status,
      "error"
    );
    assert.strictEqual(updateRegistry.petTint("gold", deps).status, "error");
    assert.strictEqual(updateRegistry.petTint([], deps).status, "error");
    assert.strictEqual(updateRegistry.petTint(null, deps).status, "error");
  });

  it("petAccessory accepts only safe per-theme catalog selections", () => {
    const deps = { snapshot: baseSnapshot };
    assert.strictEqual(updateRegistry.petAccessory({}, deps).status, "ok");
    assert.strictEqual(
      updateRegistry.petAccessory({ clawd: "wizard-hat", cloudling: "halo" }, deps).status,
      "ok"
    );
    assert.strictEqual(updateRegistry.petAccessory({ clawd: "none" }, deps).status, "error");
    assert.strictEqual(updateRegistry.petAccessory({ clawd: "seasonal" }, deps).status, "error");
    assert.strictEqual(
      updateRegistry.petAccessory({ "../unsafe": "halo" }, deps).status,
      "error"
    );
    assert.strictEqual(
      updateRegistry.petAccessory({ clawd: "file:///secret.svg" }, deps).status,
      "error"
    );
    assert.strictEqual(updateRegistry.petAccessory("wizard-hat", deps).status, "error");
    assert.strictEqual(updateRegistry.petAccessory([], deps).status, "error");
    assert.strictEqual(updateRegistry.petAccessory(null, deps).status, "error");
  });

  it("petMouthAccessory accepts only safe per-theme catalog selections", () => {
    const deps = { snapshot: baseSnapshot };
    assert.strictEqual(updateRegistry.petMouthAccessory({}, deps).status, "ok");
    assert.strictEqual(
      updateRegistry.petMouthAccessory({ clawd: "cigarette" }, deps).status,
      "ok"
    );
    assert.strictEqual(updateRegistry.petMouthAccessory({ clawd: "none" }, deps).status, "error");
    assert.strictEqual(updateRegistry.petMouthAccessory({ clawd: "pipe" }, deps).status, "error");
    assert.strictEqual(
      updateRegistry.petMouthAccessory({ "../unsafe": "cigarette" }, deps).status,
      "error"
    );
    assert.strictEqual(
      updateRegistry.petMouthAccessory({ clawd: "file:///secret.svg" }, deps).status,
      "error"
    );
    assert.strictEqual(updateRegistry.petMouthAccessory("cigarette", deps).status, "error");
    assert.strictEqual(updateRegistry.petMouthAccessory([], deps).status, "error");
    assert.strictEqual(updateRegistry.petMouthAccessory(null, deps).status, "error");
  });

  it("holidayAccessoryEnabled accepts only canonical per-theme true entries", () => {
    const deps = { snapshot: baseSnapshot };
    assert.strictEqual(updateRegistry.holidayAccessoryEnabled({}, deps).status, "ok");
    assert.strictEqual(
      updateRegistry.holidayAccessoryEnabled({ clawd: true, cloudling: true }, deps).status,
      "ok"
    );
    assert.strictEqual(
      updateRegistry.holidayAccessoryEnabled({ clawd: false }, deps).status,
      "error"
    );
    assert.strictEqual(
      updateRegistry.holidayAccessoryEnabled({ "../unsafe": true }, deps).status,
      "error"
    );
    assert.strictEqual(updateRegistry.holidayAccessoryEnabled(true, deps).status, "error");
    assert.strictEqual(updateRegistry.holidayAccessoryEnabled([], deps).status, "error");
    assert.strictEqual(updateRegistry.holidayAccessoryEnabled(null, deps).status, "error");
  });

  it("x/y/preMiniX/preMiniY require finite numbers", () => {
    const deps = { snapshot: baseSnapshot };
    assert.strictEqual(updateRegistry.x(0, deps).status, "ok");
    assert.strictEqual(updateRegistry.y(-100, deps).status, "ok");
    assert.strictEqual(updateRegistry.preMiniX(NaN, deps).status, "error");
    assert.strictEqual(updateRegistry.preMiniY(Infinity, deps).status, "error");
  });

  it("keepSizeAcrossDisplays validates booleans through its object-form entry", () => {
    const entry = updateRegistry.keepSizeAcrossDisplays;
    assert.strictEqual(typeof entry, "object");
    assert.strictEqual(entry.validate(true).status, "ok");
    assert.strictEqual(entry.validate(false).status, "ok");
    assert.strictEqual(entry.validate("yes").status, "error");
  });

  it("keepSizeAcrossDisplays rebases once only when turning off", () => {
    const entry = updateRegistry.keepSizeAcrossDisplays;
    let calls = 0;
    const deps = { rebaseSizeToRealizedPixels: () => { calls += 1; } };
    assert.deepStrictEqual(entry.effect(false, deps), { status: "ok" });
    assert.strictEqual(calls, 1);
    assert.deepStrictEqual(entry.effect(true, deps), { status: "ok" });
    assert.strictEqual(calls, 1);
    assert.deepStrictEqual(entry.effect(false, {}), { status: "ok" });
    assert.deepStrictEqual(entry.effect(false), { status: "ok" });
  });

  it("accepts only supported idle activity frequencies", () => {
    for (const value of ["low", "medium", "high"]) {
      assert.strictEqual(updateRegistry.idleActivityFrequency(value).status, "ok");
    }
    assert.strictEqual(updateRegistry.idleActivityFrequency("often").status, "error");
    assert.strictEqual(updateRegistry.idleActivityFrequency(true).status, "error");
  });

  it("saved pixel sizes require non-negative finite numbers", () => {
    const deps = { snapshot: baseSnapshot };
    for (const key of ["savedPixelWidth", "savedPixelHeight"]) {
      assert.strictEqual(updateRegistry[key](0, deps).status, "ok", `${key}(0)`);
      assert.strictEqual(updateRegistry[key](286, deps).status, "ok", `${key}(286)`);
      assert.strictEqual(updateRegistry[key](-1, deps).status, "error", `${key}(-1)`);
      assert.strictEqual(updateRegistry[key](Infinity, deps).status, "error", `${key}(Infinity)`);
    }
  });

  it("Settings window bounds accept normal integer geometry or null", () => {
    const validate = updateRegistry.settingsWindowBounds;
    assert.strictEqual(validate(null).status, "ok");
    assert.strictEqual(
      validate({ x: -1200, y: 80, width: 900, height: 640 }).status,
      "ok",
    );
    for (const value of [
      { x: 0.5, y: 0, width: 800, height: 560 },
      { x: 0, y: 0, width: 0, height: 560 },
      { x: 0, y: 0, width: 800 },
      [],
      "800x560",
    ]) {
      assert.strictEqual(validate(value).status, "error");
    }
  });

  it("Dashboard window bounds accept normal integer geometry or null", () => {
    const validate = updateRegistry.dashboardWindowBounds;
    assert.strictEqual(validate(null).status, "ok");
    assert.strictEqual(
      validate({ x: -1200, y: 80, width: 900, height: 640 }).status,
      "ok",
    );
    for (const value of [
      { x: 0.5, y: 0, width: 800, height: 560 },
      { x: 0, y: 0, width: 0, height: 560 },
      { x: 0, y: 0, width: 800 },
      [],
      "800x560",
    ]) {
      assert.strictEqual(validate(value).status, "error");
    }
  });

  it("theme validator requires a non-empty string", () => {
    // theme is now an object-form entry ({ validate, effect }); access
    // the validator directly — the effect needs an activateTheme dep
    // and is covered separately.
    const entry = updateRegistry.theme;
    assert.strictEqual(typeof entry, "object");
    assert.strictEqual(typeof entry.validate, "function");
    assert.strictEqual(typeof entry.effect, "function");
    const deps = { snapshot: baseSnapshot };
    assert.strictEqual(entry.validate("clawd", deps).status, "ok");
    assert.strictEqual(entry.validate("", deps).status, "error");
    assert.strictEqual(entry.validate(null, deps).status, "error");
  });

  it("theme effect proxies to deps.activateTheme and maps throws to error", () => {
    const entry = updateRegistry.theme;
    const calls = [];
    const overrideMap = {
      tiers: {
        workingTiers: {
          "clawd-working-typing.svg": { file: "clawd-working-typing-old.svg" },
        },
      },
    };
    const deps = {
      snapshot: { ...baseSnapshot, themeOverrides: { clawd: overrideMap } },
      activateTheme: (id, variantId, targetOverrideMap) => {
        calls.push({ id, variantId, targetOverrideMap });
        if (id === "bad") throw new Error("boom");
      },
    };
    assert.deepStrictEqual(entry.effect("clawd", deps), { status: "ok" });
    assert.deepStrictEqual(calls, [{
      id: "clawd",
      variantId: null,
      targetOverrideMap: overrideMap,
    }]);

    const err = entry.effect("bad", deps);
    assert.strictEqual(err.status, "error");
    assert.match(err.message, /boom/);
  });

  it("theme effect errors when activateTheme dep missing", () => {
    const entry = updateRegistry.theme;
    const result = entry.effect("clawd", { snapshot: baseSnapshot });
    assert.strictEqual(result.status, "error");
    assert.match(result.message, /activateTheme/);
  });

  it("themeVariant requires a plain object (no effect runs)", () => {
    // Plan §6.2: themeVariant must have validator but NO effect — to avoid
    // double-activating theme alongside `theme` field effect.
    const deps = { snapshot: prefs.getDefaults() };
    assert.strictEqual(updateRegistry.themeVariant({}, deps).status, "ok");
    assert.strictEqual(updateRegistry.themeVariant({ clawd: "chill" }, deps).status, "ok");
    assert.strictEqual(updateRegistry.themeVariant("nope", deps).status, "error");
    assert.strictEqual(updateRegistry.themeVariant(null, deps).status, "error");
    assert.strictEqual(updateRegistry.themeVariant([1, 2], deps).status, "error");
    // Object-form entries have `.validate` + `.effect`; pure-data entries are
    // bare functions. themeVariant MUST be the bare-function form.
    assert.strictEqual(typeof updateRegistry.themeVariant, "function");
  });

  it("sessionAliases requires a plain object of valid alias entries", () => {
    const deps = { snapshot: baseSnapshot };
    assert.strictEqual(
      updateRegistry.sessionAliases({ "local|codex|s1": { title: "Codex", updatedAt: 100 } }, deps).status,
      "ok"
    );
    assert.strictEqual(updateRegistry.sessionAliases({}, deps).status, "ok");
    assert.strictEqual(updateRegistry.sessionAliases([], deps).status, "error");
    assert.strictEqual(
      updateRegistry.sessionAliases({ "local|codex|s1": { title: "", updatedAt: 100 } }, deps).status,
      "error"
    );
  });
});

describe("object-form effects (agent auto-start / manageClaudeHooksAutomatically / openAtLogin)", () => {
  it("openAtLogin effect calls setOpenAtLogin with the value", () => {
    let lastValue = null;
    const deps = { setOpenAtLogin: (v) => { lastValue = v; } };
    const r1 = updateRegistry.openAtLogin.effect(true, deps);
    assert.strictEqual(r1.status, "ok");
    assert.strictEqual(lastValue, true);
    const r2 = updateRegistry.openAtLogin.effect(false, deps);
    assert.strictEqual(r2.status, "ok");
    assert.strictEqual(lastValue, false);
  });

  it("openAtLogin effect returns error when deps missing", () => {
    const r = updateRegistry.openAtLogin.effect(true, {});
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /requires setOpenAtLogin/);
  });

  it("openAtLogin effect catches setter throws", () => {
    const deps = { setOpenAtLogin: () => { throw new Error("permission denied"); } };
    const r = updateRegistry.openAtLogin.effect(true, deps);
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /permission denied/);
  });
});

describe("session cleanup interval validators", () => {
  const snapshot = prefs.getDefaults();

  it("sessionStaleMs accepts 0 (disabled) regardless of workingStaleMs", () => {
    const result = updateRegistry.sessionStaleMs(0, { snapshot });
    assert.strictEqual(result.status, "ok");
  });

  it("sessionStaleMs accepts non-zero values >= current workingStaleMs", () => {
    const result = updateRegistry.sessionStaleMs(600_000, { snapshot });
    assert.strictEqual(result.status, "ok");
  });

  it("sessionStaleMs rejects values below the workingStaleMs floor", () => {
    const result = updateRegistry.sessionStaleMs(60_000, {
      snapshot: { ...snapshot, workingStaleMs: 300_000 },
    });
    assert.strictEqual(result.status, "error");
    assert.match(result.message, /workingStaleMs/);
  });

  it("sessionStaleMs rejects non-integers / out-of-range", () => {
    assert.strictEqual(updateRegistry.sessionStaleMs("nope", { snapshot }).status, "error");
    assert.strictEqual(updateRegistry.sessionStaleMs(1.5, { snapshot }).status, "error");
    assert.strictEqual(updateRegistry.sessionStaleMs(30_000, { snapshot }).status, "error");
    assert.strictEqual(updateRegistry.sessionStaleMs(90_000_000, { snapshot }).status, "error");
  });

  it("workingStaleMs rejects values above sessionStaleMs when the latter is non-zero", () => {
    const result = updateRegistry.workingStaleMs(700_000, {
      snapshot: { ...snapshot, sessionStaleMs: 600_000 },
    });
    assert.strictEqual(result.status, "error");
    assert.match(result.message, /sessionStaleMs/);
  });

  it("workingStaleMs accepts any in-range value when sessionStaleMs is 0", () => {
    const result = updateRegistry.workingStaleMs(700_000, {
      snapshot: { ...snapshot, sessionStaleMs: 0 },
    });
    assert.strictEqual(result.status, "ok");
  });

  it("workingStaleMs accepts equal to sessionStaleMs", () => {
    const result = updateRegistry.workingStaleMs(600_000, {
      snapshot: { ...snapshot, sessionStaleMs: 600_000 },
    });
    assert.strictEqual(result.status, "ok");
  });

  it("workingStaleMs rejects below floor / above ceiling", () => {
    assert.strictEqual(updateRegistry.workingStaleMs(0, { snapshot }).status, "error");
    assert.strictEqual(updateRegistry.workingStaleMs(20_000, { snapshot }).status, "error");
    assert.strictEqual(updateRegistry.workingStaleMs(90_000_000, { snapshot }).status, "error");
  });

  it("detachedIdleStaleMs enforces 5s-300s integer range", () => {
    assert.strictEqual(updateRegistry.detachedIdleStaleMs(5_000, { snapshot }).status, "ok");
    assert.strictEqual(updateRegistry.detachedIdleStaleMs(300_000, { snapshot }).status, "ok");
    assert.strictEqual(updateRegistry.detachedIdleStaleMs(0, { snapshot }).status, "error");
    assert.strictEqual(updateRegistry.detachedIdleStaleMs(1_000, { snapshot }).status, "error");
    assert.strictEqual(updateRegistry.detachedIdleStaleMs(400_000, { snapshot }).status, "error");
  });
});

describe("sessionCleanup.setTriple command", () => {
  const cmd = commandRegistry["sessionCleanup.setTriple"];
  const baseSnapshot = prefs.getDefaults();

  it("rejects an inverted triple (workingStaleMs > sessionStaleMs)", async () => {
    const result = await cmd(
      {
        sessionStaleMs: 120_000,
        workingStaleMs: 300_000,
        detachedIdleStaleMs: 30_000,
      },
      { snapshot: baseSnapshot }
    );
    assert.strictEqual(result.status, "error");
    assert.match(result.message, /workingStaleMs.*must be <= sessionStaleMs/);
  });

  it("rejects payload with non-integer present value (no silent snapshot fallback)", async () => {
    const result = await cmd(
      { sessionStaleMs: "600000" },
      { snapshot: baseSnapshot }
    );
    assert.strictEqual(result.status, "error");
    assert.match(result.message, /sessionStaleMs.*must be an integer/);
  });

  it("rejects non-object payload", async () => {
    const r = await cmd(null, { snapshot: baseSnapshot });
    assert.strictEqual(r.status, "error");
  });
});

describe("doctor repair commands", () => {
  it("routes Doctor restart-clawd repair through deps.restartClawd", async () => {
    const calls = [];
    const r = await commandRegistry.repairDoctorIssue(
      { type: "restart-clawd", confirmed: true },
      { restartClawd: () => calls.push("restart") }
    );

    assert.strictEqual(r.status, "ok");
    assert.deepStrictEqual(calls, ["restart"]);
  });

  it("does not run Doctor restart-clawd repair without confirmation", async () => {
    const calls = [];
    const r = await commandRegistry.repairDoctorIssue(
      { type: "restart-clawd" },
      { restartClawd: () => calls.push("restart") }
    );

    assert.strictEqual(r.status, "error");
    assert.match(r.message, /confirmation/i);
    assert.deepStrictEqual(calls, []);
  });

  it("returns an error when restart-clawd is dispatched without deps.restartClawd", async () => {
    const r = await commandRegistry.repairDoctorIssue({ type: "restart-clawd", confirmed: true }, {});

    assert.strictEqual(r.status, "error");
    assert.match(r.message, /restartClawd/);
  });

  it("exposes restartClawd as a confirmed command for the GPU switch (#1183)", async () => {
    const calls = [];
    const deps = { restartClawd: () => calls.push("restart") };

    const refused = await commandRegistry.restartClawd({}, deps);
    assert.strictEqual(refused.status, "error");
    assert.deepStrictEqual(calls, []);

    const r = await commandRegistry.restartClawd({ confirmed: true }, deps);
    assert.strictEqual(r.status, "ok");
    assert.deepStrictEqual(calls, ["restart"]);
  });

  it("rejects Doctor theme repair so Doctor does not reset user themes", async () => {
    const calls = [];
    const r = await commandRegistry.repairDoctorIssue({ type: "theme-health" }, {
      snapshot: { ...prefs.getDefaults(), theme: "broken", themeVariant: {}, themeOverrides: {} },
      activateTheme: (themeId, variantId, overrideMap) => {
        calls.push({ themeId, variantId, overrideMap });
        return { themeId, variantId: "default" };
      },
    });

    assert.strictEqual(r.status, "error");
    assert.match(r.message, /manually/i);
    assert.deepStrictEqual(calls, []);
    assert.strictEqual(r.commit, undefined);
  });
});

describe("setSessionAlias command", () => {
  it("stores a sanitized alias under the normalized session key", () => {
    const snapshot = { ...prefs.getDefaults(), sessionAliases: {} };
    const r = commandRegistry.setSessionAlias(
      { host: null, agentId: "codex", sessionId: "s1", alias: "  Codex\nmain  " },
      { snapshot, now: 1000, getActiveSessionAliasKeys: () => new Set(["local|codex|s1"]) }
    );

    assert.strictEqual(r.status, "ok");
    assert.deepStrictEqual(r.commit.sessionAliases, {
      "local|codex|s1": { title: "Codex main", updatedAt: 1000 },
    });
  });

  it("stores Kiro default-session aliases under a cwd-scoped key", () => {
    const snapshot = { ...prefs.getDefaults(), sessionAliases: {} };
    const r = commandRegistry.setSessionAlias(
      { host: null, agentId: "kiro-cli", sessionId: "default", cwd: "/repo/a", alias: "Kiro A" },
      { snapshot, now: 1000, getActiveSessionAliasKeys: () => new Set(["local|kiro-cli|default|cwd:%2Frepo%2Fa"]) }
    );

    assert.strictEqual(r.status, "ok");
    assert.deepStrictEqual(r.commit.sessionAliases, {
      "local|kiro-cli|default|cwd:%2Frepo%2Fa": { title: "Kiro A", updatedAt: 1000 },
    });
  });

  it("clears an existing alias when alias is empty", () => {
    const snapshot = {
      ...prefs.getDefaults(),
      sessionAliases: { "local|codex|s1": { title: "Codex main", updatedAt: 1000 } },
    };
    const r = commandRegistry.setSessionAlias(
      { host: "local", agentId: "codex", sessionId: "s1", alias: "   " },
      { snapshot, now: 2000, getActiveSessionAliasKeys: () => new Set(["local|codex|s1"]) }
    );

    assert.strictEqual(r.status, "ok");
    assert.deepStrictEqual(r.commit.sessionAliases, {});
  });

  it("returns noop when the alias value is unchanged", () => {
    const snapshot = {
      ...prefs.getDefaults(),
      sessionAliases: { "local|codex|s1": { title: "Codex main", updatedAt: 1000 } },
    };
    const r = commandRegistry.setSessionAlias(
      { host: null, agentId: "codex", sessionId: "s1", alias: "Codex main" },
      { snapshot, now: 2000, getActiveSessionAliasKeys: () => new Set(["local|codex|s1"]) }
    );

    assert.strictEqual(r.status, "ok");
    assert.strictEqual(r.noop, true);
  });

  it("prunes expired inactive aliases even when the requested alias is unchanged", () => {
    const old = 1000;
    const now = old + 8 * 24 * 60 * 60 * 1000;
    const snapshot = {
      ...prefs.getDefaults(),
      sessionAliases: {
        "local|codex|s1": { title: "Codex main", updatedAt: old },
        "local|codex|stale": { title: "Stale", updatedAt: old },
      },
    };
    const r = commandRegistry.setSessionAlias(
      { host: null, agentId: "codex", sessionId: "s1", alias: "Codex main" },
      { snapshot, now, getActiveSessionAliasKeys: () => new Set(["local|codex|s1"]) }
    );

    assert.strictEqual(r.status, "ok");
    assert.deepStrictEqual(r.commit.sessionAliases, {
      "local|codex|s1": { title: "Codex main", updatedAt: old },
    });
  });

  it("rejects missing sessionId or non-string alias", () => {
    const deps = { snapshot: prefs.getDefaults() };
    assert.strictEqual(
      commandRegistry.setSessionAlias({ host: null, agentId: "codex", sessionId: "", alias: "x" }, deps).status,
      "error"
    );
    assert.strictEqual(
      commandRegistry.setSessionAlias({ host: null, agentId: "codex", sessionId: "s1", alias: 42 }, deps).status,
      "error"
    );
  });
});

describe("shortcut commands", () => {
  function makeShortcutDeps(overrides = {}) {
    const snapshot = overrides.snapshot || prefs.getDefaults();
    const registered = new Set(overrides.registered || []);
    const failures = new Map(Object.entries(overrides.failures || {}));
    const calls = { register: [], unregister: [] };
    const globalShortcut = {
      register(accelerator, handler) {
        calls.register.push({ accelerator, handler });
        if (overrides.failRegister && overrides.failRegister.has(accelerator)) {
          return false;
        }
        registered.add(accelerator);
        return true;
      },
      unregister(accelerator) {
        calls.unregister.push(accelerator);
        if (overrides.throwOnUnregister === accelerator) {
          throw new Error("unregister boom");
        }
        if (overrides.stubbornUnregister === accelerator) return;
        registered.delete(accelerator);
      },
      isRegistered(accelerator) {
        return registered.has(accelerator);
      },
    };
    return {
      deps: {
        snapshot,
        globalShortcut,
        shortcutHandlers: {
          togglePet: () => {},
          quickSelectSession: () => {},
          permissionAllow: () => {},
          permissionDeny: () => {},
        },
        getShortcutFailure: (actionId) => failures.get(actionId) || null,
        clearShortcutFailure: (actionId) => failures.delete(actionId),
      },
      calls,
      registered,
      failures,
    };
  }

  it("registerShortcut commits persistent shortcuts after register-new/unregister-old", () => {
    const snapshot = prefs.validate({
      shortcuts: {
        togglePet: "Ctrl+J",
      },
    });
    const { deps, calls, registered } = makeShortcutDeps({
      snapshot,
      registered: [snapshot.shortcuts.togglePet],
    });
    const r = commandRegistry.registerShortcut({
      actionId: "togglePet",
      accelerator: "Ctrl+K",
    }, deps);
    assert.strictEqual(r.status, "ok");
    assert.deepStrictEqual(r.commit.shortcuts, {
      ...snapshot.shortcuts,
      togglePet: "CommandOrControl+K",
    });
    assert.deepStrictEqual(calls.register.map((c) => c.accelerator), ["CommandOrControl+K"]);
    assert.deepStrictEqual(calls.unregister, ["CommandOrControl+J"]);
    assert.deepStrictEqual([...registered].sort(), ["CommandOrControl+K"]);
  });

  it("registerShortcut rejects invalid and dangerous accelerators", () => {
    const { deps } = makeShortcutDeps();
    const invalid = commandRegistry.registerShortcut({
      actionId: "togglePet",
      accelerator: "bad-value",
    }, deps);
    assert.strictEqual(invalid.status, "error");
    assert.match(invalid.message, /invalid accelerator format/);

    const dangerous = commandRegistry.registerShortcut({
      actionId: "togglePet",
      accelerator: "Ctrl+C",
    }, deps);
    assert.strictEqual(dangerous.status, "error");
    assert.match(dangerous.message, /reserved accelerator/);
  });

  it("registerShortcut short-circuits idempotent writes", () => {
    const snapshot = prefs.getDefaults();
    const { deps, calls } = makeShortcutDeps({ snapshot });
    const r = commandRegistry.registerShortcut({
      actionId: "togglePet",
      accelerator: snapshot.shortcuts.togglePet,
    }, deps);
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(r.noop, true);
    assert.deepStrictEqual(calls.register, []);
    assert.deepStrictEqual(calls.unregister, []);
  });

  it("registerShortcut retries same persistent value when a runtime failure exists", () => {
    const snapshot = prefs.getDefaults();
    const { deps, calls, failures, registered } = makeShortcutDeps({
      snapshot,
      failures: { togglePet: "system conflict" },
    });
    const r = commandRegistry.registerShortcut({
      actionId: "togglePet",
      accelerator: snapshot.shortcuts.togglePet,
    }, deps);
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(r.noop, true);
    assert.deepStrictEqual(calls.register.map((c) => c.accelerator), [
      snapshot.shortcuts.togglePet,
    ]);
    assert.strictEqual(failures.has("togglePet"), false);
    assert.ok(registered.has(snapshot.shortcuts.togglePet));
  });

  it("registerShortcut keeps the old persistent binding when the new register fails", () => {
    const snapshot = prefs.validate({
      shortcuts: {
        togglePet: "Ctrl+J",
      },
    });
    const { deps, calls, registered } = makeShortcutDeps({
      snapshot,
      registered: [snapshot.shortcuts.togglePet],
      failRegister: new Set(["CommandOrControl+K"]),
    });
    const r = commandRegistry.registerShortcut({
      actionId: "togglePet",
      accelerator: "Ctrl+K",
    }, deps);
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /system conflict/);
    assert.deepStrictEqual(calls.unregister, []);
    assert.ok(registered.has(snapshot.shortcuts.togglePet));
    assert.strictEqual(registered.has("CommandOrControl+K"), false);
  });

  it("registerShortcut rolls back the new persistent binding if old unregister verification fails", () => {
    const snapshot = prefs.validate({
      shortcuts: {
        togglePet: "Ctrl+J",
      },
    });
    const { deps, calls, registered } = makeShortcutDeps({
      snapshot,
      registered: [snapshot.shortcuts.togglePet],
      stubbornUnregister: snapshot.shortcuts.togglePet,
    });
    const r = commandRegistry.registerShortcut({
      actionId: "togglePet",
      accelerator: "Ctrl+K",
    }, deps);
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /unregister of old accelerator failed/);
    assert.deepStrictEqual(calls.unregister, ["CommandOrControl+J", "CommandOrControl+K"]);
    assert.ok(registered.has(snapshot.shortcuts.togglePet));
    assert.strictEqual(registered.has("CommandOrControl+K"), false);
  });

  it("resetShortcut routes through registerShortcut with the default value", () => {
    const snapshot = prefs.validate({
      shortcuts: {
        togglePet: "Ctrl+J",
      },
    });
    const { deps } = makeShortcutDeps({
      snapshot,
      registered: [snapshot.shortcuts.togglePet],
    });
    const r = commandRegistry.resetShortcut({ actionId: "togglePet" }, deps);
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(r.commit.shortcuts.togglePet, "CommandOrControl+Shift+Alt+C");
  });

  it("resetAllShortcuts commits the full default shortcut map atomically", () => {
    const snapshot = prefs.validate({
      shortcuts: {
        togglePet: "Ctrl+J",
        permissionAllow: "Ctrl+K",
        permissionDeny: null,
      },
    });
    const { deps, calls } = makeShortcutDeps({
      snapshot,
      registered: [snapshot.shortcuts.togglePet],
    });
    const r = commandRegistry.resetAllShortcuts(null, deps);
    assert.strictEqual(r.status, "ok");
    assert.deepStrictEqual(r.commit.shortcuts, prefs.getDefaults().shortcuts);
    assert.deepStrictEqual(calls.register.map((c) => c.accelerator), [
      "CommandOrControl+Shift+Alt+C",
    ]);
    assert.deepStrictEqual(calls.unregister, ["CommandOrControl+J"]);
  });

  it("resetAllShortcuts leaves prefs untouched when the persistent default is unavailable", () => {
    const snapshot = prefs.validate({
      shortcuts: {
        togglePet: "Ctrl+J",
      },
    });
    const { deps, calls, registered } = makeShortcutDeps({
      snapshot,
      registered: [snapshot.shortcuts.togglePet],
      failRegister: new Set(["CommandOrControl+Shift+Alt+C"]),
    });
    const r = commandRegistry.resetAllShortcuts(null, deps);
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /system conflict on togglePet/);
    assert.strictEqual(r.commit, undefined);
    assert.deepStrictEqual(calls.unregister, []);
    assert.ok(registered.has(snapshot.shortcuts.togglePet));
  });
});

describe("updateRegistry cross-field validators (showTray/showDock)", () => {
  it("rejects disabling tray when dock is already off", () => {
    const snap = { ...prefs.getDefaults(), showTray: true, showDock: false };
    const r = updateRegistry.showTray(false, { snapshot: snap });
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /unquittable/);
  });

  it("rejects disabling dock when tray is already off", () => {
    const snap = { ...prefs.getDefaults(), showTray: false, showDock: true };
    const r = updateRegistry.showDock(false, { snapshot: snap });
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /unquittable/);
  });

  it("allows disabling tray when dock is on", () => {
    const snap = { ...prefs.getDefaults(), showTray: true, showDock: true };
    assert.strictEqual(updateRegistry.showTray(false, { snapshot: snap }).status, "ok");
  });

  it("allows enabling either at any time", () => {
    const snap = { ...prefs.getDefaults(), showTray: false, showDock: false };
    assert.strictEqual(updateRegistry.showTray(true, { snapshot: snap }).status, "ok");
    assert.strictEqual(updateRegistry.showDock(true, { snapshot: snap }).status, "ok");
  });
});

describe("removeTheme command", () => {
  const baseSnapshot = { ...prefs.getDefaults(), themeOverrides: {} };

  function makeDeps(overrides = {}) {
    const calls = { removeThemeDir: [], getThemeInfo: [] };
    const deps = {
      snapshot: baseSnapshot,
      getThemeInfo: (id) => {
        calls.getThemeInfo.push(id);
        if (id === "cat") return { builtin: false, active: false };
        if (id === "clawd") return { builtin: true, active: true };
        if (id === "activeUser") return { builtin: false, active: true };
        if (id === "missing") return null;
        return { builtin: false, active: false };
      },
      removeThemeDir: async (id) => {
        calls.removeThemeDir.push(id);
      },
      ...overrides,
    };
    return { deps, calls };
  }

  it("rejects non-string payloads", async () => {
    const { deps } = makeDeps();
    const r = await commandRegistry.removeTheme(null, deps);
    assert.strictEqual(r.status, "error");
  });

  it("rejects built-in themes", async () => {
    const { deps, calls } = makeDeps();
    const r = await commandRegistry.removeTheme("clawd", deps);
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /built-in/);
    assert.deepStrictEqual(calls.removeThemeDir, []);
  });

  it("rejects the active theme", async () => {
    const { deps, calls } = makeDeps();
    const r = await commandRegistry.removeTheme("activeUser", deps);
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /active/);
    assert.deepStrictEqual(calls.removeThemeDir, []);
  });

  it("rejects unknown themes", async () => {
    const { deps, calls } = makeDeps();
    const r = await commandRegistry.removeTheme("missing", deps);
    assert.strictEqual(r.status, "error");
    assert.deepStrictEqual(calls.removeThemeDir, []);
  });

  it("deletes the dir for a valid user theme", async () => {
    const { deps, calls } = makeDeps();
    const r = await commandRegistry.removeTheme("cat", deps);
    assert.strictEqual(r.status, "ok");
    assert.deepStrictEqual(calls.removeThemeDir, ["cat"]);
    // No overrides to clean up → no commit field
    assert.strictEqual(r.commit, undefined);
  });

  it("strips themeOverrides entry on success when one exists", async () => {
    const snapshotWithOverride = {
      ...baseSnapshot,
      themeOverrides: { cat: { attention: { sourceThemeId: "cat", file: "x.svg" } } },
    };
    const { deps } = makeDeps({ snapshot: snapshotWithOverride });
    const r = await commandRegistry.removeTheme("cat", deps);
    assert.strictEqual(r.status, "ok");
    assert.ok(r.commit, "commit field expected");
    assert.deepStrictEqual(r.commit.themeOverrides, {});
  });

  // Phase 3b-swap: removeTheme also strips themeVariant entry
  it("strips themeVariant entry on success when one exists", async () => {
    const snapshotWithVariant = {
      ...baseSnapshot,
      themeVariant: { cat: "chill", clawd: "default" },
    };
    const { deps } = makeDeps({ snapshot: snapshotWithVariant });
    const r = await commandRegistry.removeTheme("cat", deps);
    assert.strictEqual(r.status, "ok");
    assert.ok(r.commit, "commit field expected");
    assert.deepStrictEqual(r.commit.themeVariant, { clawd: "default" });
    assert.strictEqual(r.commit.themeOverrides, undefined);  // wasn't set
  });

  it("strips both themeOverrides and themeVariant when both present", async () => {
    const snapshotWithBoth = {
      ...baseSnapshot,
      themeOverrides: { cat: { attention: { sourceThemeId: "cat", file: "x.svg" } } },
      themeVariant: { cat: "chill" },
    };
    const { deps } = makeDeps({ snapshot: snapshotWithBoth });
    const r = await commandRegistry.removeTheme("cat", deps);
    assert.strictEqual(r.status, "ok");
    assert.deepStrictEqual(r.commit.themeOverrides, {});
    assert.deepStrictEqual(r.commit.themeVariant, {});
  });

  // #509: removeTheme also strips the idleVisual entry
  it("strips idleVisual entry on success when one exists", async () => {
    const snapshotWithIdleVisual = {
      ...baseSnapshot,
      idleVisual: { cat: "cat-idle-nap.svg", clawd: "clawd-idle-reading.svg" },
    };
    const { deps } = makeDeps({ snapshot: snapshotWithIdleVisual });
    const r = await commandRegistry.removeTheme("cat", deps);
    assert.strictEqual(r.status, "ok");
    assert.ok(r.commit, "commit field expected");
    assert.deepStrictEqual(r.commit.idleVisual, { clawd: "clawd-idle-reading.svg" });
  });

  it("strips pet tint, both accessory slots, and holiday opt-in entries on success when they exist", async () => {
    const snapshotWithCustomization = {
      ...baseSnapshot,
      petTint: { cat: "matcha", clawd: "gold" },
      petAccessory: { cat: "halo", clawd: "wizard-hat" },
      petMouthAccessory: { cat: "cigarette", clawd: "cigarette" },
      holidayAccessoryEnabled: { cat: true, clawd: true },
    };
    const { deps } = makeDeps({ snapshot: snapshotWithCustomization });
    const r = await commandRegistry.removeTheme("cat", deps);
    assert.strictEqual(r.status, "ok");
    assert.ok(r.commit, "commit field expected");
    assert.deepStrictEqual(r.commit.petTint, { clawd: "gold" });
    assert.deepStrictEqual(r.commit.petAccessory, { clawd: "wizard-hat" });
    assert.deepStrictEqual(r.commit.petMouthAccessory, { clawd: "cigarette" });
    assert.deepStrictEqual(r.commit.holidayAccessoryEnabled, { clawd: true });
  });

  it("surfaces removeThemeDir throws as error status", async () => {
    const { deps } = makeDeps({
      removeThemeDir: async () => { throw new Error("EBUSY"); },
    });
    const r = await commandRegistry.removeTheme("cat", deps);
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /EBUSY/);
  });

  it("errors when required deps missing", async () => {
    const r = await commandRegistry.removeTheme("cat", { snapshot: baseSnapshot });
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /getThemeInfo/);
  });
});

// Phase 3b-swap: atomic theme+variant switch via a single command.
describe("setThemeSelection command", () => {
  const baseSnapshot = { ...prefs.getDefaults(), themeVariant: {} };

  function makeDeps(overrides = {}) {
    const calls = { activateTheme: [] };
    const deps = {
      snapshot: baseSnapshot,
      activateTheme: (themeId, variantId, overrideMap) => {
        calls.activateTheme.push({ themeId, variantId, overrideMap });
        // Simulate lenient variant fallback: "dead" variant → resolves to default
        const resolved = variantId === "dead" ? "default" : variantId;
        return { themeId, variantId: resolved };
      },
      getActiveTheme: () => ({
        _id: calls.activateTheme.at(-1)?.themeId || "clawd",
        _capabilities: { petTint: true, accessories: true },
      }),
      ...overrides,
    };
    return { deps, calls };
  }

  it("rejects missing themeId", () => {
    const { deps } = makeDeps();
    const r = commandRegistry.setThemeSelection({}, deps);
    assert.strictEqual(r.status, "error");
  });

  it("rejects non-string variantId when provided", () => {
    const { deps } = makeDeps();
    const r = commandRegistry.setThemeSelection({ themeId: "clawd", variantId: 42 }, deps);
    assert.strictEqual(r.status, "error");
  });

  it("accepts string payload as themeId shorthand", () => {
    const { deps, calls } = makeDeps();
    const r = commandRegistry.setThemeSelection("clawd", deps);
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(calls.activateTheme.length, 1);
    assert.strictEqual(calls.activateTheme[0].themeId, "clawd");
    assert.strictEqual(calls.activateTheme[0].variantId, "default");
    assert.strictEqual(calls.activateTheme[0].overrideMap, null);
  });

  it("uses snapshot.themeVariant when variantId not provided", () => {
    const snapshotWithVariant = { ...baseSnapshot, themeVariant: { clawd: "chill" } };
    const { deps, calls } = makeDeps({ snapshot: snapshotWithVariant });
    const r = commandRegistry.setThemeSelection({ themeId: "clawd" }, deps);
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(calls.activateTheme[0].variantId, "chill");
  });

  it("passes the target theme override map into activateTheme", () => {
    const overrideMap = {
      tiers: {
        workingTiers: {
          "clawd-working-typing.svg": { file: "clawd-working-typing-old.svg" },
        },
      },
    };
    const snapshotWithOverride = {
      ...baseSnapshot,
      themeOverrides: { clawd: overrideMap },
    };
    const { deps, calls } = makeDeps({ snapshot: snapshotWithOverride });
    const r = commandRegistry.setThemeSelection({ themeId: "clawd" }, deps);
    assert.strictEqual(r.status, "ok");
    assert.deepStrictEqual(calls.activateTheme[0].overrideMap, overrideMap);
  });

  it("explicit variantId overrides snapshot map", () => {
    const snapshotWithVariant = { ...baseSnapshot, themeVariant: { clawd: "chill" } };
    const { deps, calls } = makeDeps({ snapshot: snapshotWithVariant });
    const r = commandRegistry.setThemeSelection({ themeId: "clawd", variantId: "hyper" }, deps);
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(calls.activateTheme[0].variantId, "hyper");
  });

  it("commits theme + themeVariant atomically", () => {
    const { deps } = makeDeps();
    const r = commandRegistry.setThemeSelection({ themeId: "clawd", variantId: "chill" }, deps);
    assert.strictEqual(r.status, "ok");
    assert.ok(r.commit, "commit field expected");
    assert.strictEqual(r.commit.theme, "clawd");
    assert.deepStrictEqual(r.commit.themeVariant, { clawd: "chill" });
    assert.deepStrictEqual(r.customizationCapabilities, {
      petTint: true,
      accessories: true,
      mouthAccessories: false,
      darkAppearance: false,
    });
  });

  it("returns the activated theme's fail-closed customization capabilities", () => {
    const { deps } = makeDeps({
      getActiveTheme: () => ({
        _id: "clawd",
        _capabilities: { petTint: true, accessories: false },
      }),
    });
    const r = commandRegistry.setThemeSelection({ themeId: "clawd" }, deps);
    assert.deepStrictEqual(r.customizationCapabilities, {
      petTint: true,
      accessories: false,
      mouthAccessories: false,
      darkAppearance: false,
    });
  });

  it("preserves other themes' variantIds when committing", () => {
    const snapshotWithVariant = { ...baseSnapshot, themeVariant: { calico: "hyper" } };
    const { deps } = makeDeps({ snapshot: snapshotWithVariant });
    const r = commandRegistry.setThemeSelection({ themeId: "clawd", variantId: "chill" }, deps);
    assert.strictEqual(r.status, "ok");
    assert.deepStrictEqual(r.commit.themeVariant, { calico: "hyper", clawd: "chill" });
  });

  it("self-heals by committing the RESOLVED variantId on dead-variant fallback", () => {
    // Scenario: author deleted `chill` variant. User's stored themeVariant
    // still points to `chill`. setThemeSelection calls activateTheme which
    // lenient-falls back to `default` and returns resolved id. The committed
    // themeVariant records `default`, not the dead `chill` the user asked for.
    const snapshotWithDead = { ...baseSnapshot, themeVariant: { clawd: "dead" } };
    const { deps } = makeDeps({ snapshot: snapshotWithDead });
    const r = commandRegistry.setThemeSelection({ themeId: "clawd" }, deps);
    assert.strictEqual(r.status, "ok");
    assert.deepStrictEqual(r.commit.themeVariant, { clawd: "default" });
  });

  it("surfaces activateTheme throws as error status (no commit)", () => {
    const { deps } = makeDeps({
      activateTheme: () => { throw new Error("theme missing"); },
    });
    const r = commandRegistry.setThemeSelection({ themeId: "broken" }, deps);
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /theme missing/);
    assert.strictEqual(r.commit, undefined);
  });

  it("errors when activateTheme dep is missing", () => {
    const r = commandRegistry.setThemeSelection({ themeId: "clawd" }, { snapshot: baseSnapshot });
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /activateTheme/);
  });
});

// Shared non-recursive runtime selection helper used by BOTH setThemeSelection
// and officialTheme.uninstall (the latter while already holding the theme lock).
describe("applyThemeSelection shared helper", () => {
  it("activates with the given variant/overrides and returns the resolved variant", () => {
    const calls = [];
    const deps = {
      activateTheme: (themeId, variantId, overrideMap) => {
        calls.push({ themeId, variantId, overrideMap });
        return { themeId, variantId: variantId === "dead" ? "default" : variantId };
      },
      getActiveTheme: () => ({ _id: "clawd", _capabilities: { petTint: true, accessories: true } }),
    };
    const r = applyThemeSelection("clawd", "dead", { sounds: { complete: { file: "x.mp3" } } }, deps);
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(r.themeId, "clawd");
    assert.strictEqual(r.variantId, "default", "dead variant resolves to default");
    assert.deepStrictEqual(r.customizationCapabilities, {
      petTint: true,
      accessories: true,
      mouthAccessories: false,
      darkAppearance: false,
    });
    assert.deepStrictEqual(calls, [{
      themeId: "clawd",
      variantId: "dead",
      overrideMap: { sounds: { complete: { file: "x.mp3" } } },
    }]);
    // The helper performs the runtime switch only; the caller owns the commit.
    assert.strictEqual(r.commit, undefined);
  });

  it("errors when activateTheme is missing", () => {
    const r = applyThemeSelection("clawd", "default", null, {});
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /activateTheme/);
  });
});

// #509: default idle visual picker command.
describe("setIdleVisual command", () => {
  const activeTheme = {
    _id: "clawd",
    states: { idle: ["clawd-idle-follow.svg"] },
    idleAnimations: [
      { file: "clawd-idle-look.svg", duration: 6500 },
      { file: "clawd-idle-reading.svg", duration: 14000 },
    ],
  };

  function makeDeps(overrides = {}) {
    return {
      snapshot: { ...prefs.getDefaults(), idleVisual: {} },
      getActiveTheme: () => activeTheme,
      ...overrides,
    };
  }

  it("rejects missing themeId and malformed file", () => {
    assert.strictEqual(commandRegistry.setIdleVisual({}, makeDeps()).status, "error");
    assert.strictEqual(
      commandRegistry.setIdleVisual({ themeId: "clawd", file: 42 }, makeDeps()).status,
      "error"
    );
    assert.strictEqual(
      commandRegistry.setIdleVisual({ themeId: "clawd", file: "" }, makeDeps()).status,
      "error"
    );
  });

  it("errors when getActiveTheme dep is missing", () => {
    const r = commandRegistry.setIdleVisual(
      { themeId: "clawd", file: "clawd-idle-look.svg" },
      { snapshot: prefs.getDefaults() }
    );
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /getActiveTheme/);
  });

  it("rejects a themeId that is not the active theme", () => {
    const r = commandRegistry.setIdleVisual({ themeId: "calico", file: "x.svg" }, makeDeps());
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /not the active theme/);
  });

  it("rejects files that are not idle visuals of the theme", () => {
    const r = commandRegistry.setIdleVisual(
      { themeId: "clawd", file: "clawd-working-typing.svg" },
      makeDeps()
    );
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /not an idle visual/);
  });

  it("accepts a selectable-only idle visual through the existing setting command", () => {
    const theme = {
      ...activeTheme,
      idleVisualOptions: [{ file: "pool.apng" }],
    };
    const result = commandRegistry.setIdleVisual(
      { themeId: "clawd", file: "pool.apng" },
      makeDeps({ getActiveTheme: () => theme })
    );
    assert.deepStrictEqual(result, { status: "ok", commit: { idleVisual: { clawd: "pool.apng" } } });
  });

  it("commits the merged map for a valid pool file, preserving other themes", () => {
    const deps = makeDeps({
      snapshot: { ...prefs.getDefaults(), idleVisual: { calico: "calico-idle-stretch.svg" } },
    });
    const r = commandRegistry.setIdleVisual({ themeId: "clawd", file: "clawd-idle-reading.svg" }, deps);
    assert.strictEqual(r.status, "ok");
    assert.deepStrictEqual(r.commit.idleVisual, {
      calico: "calico-idle-stretch.svg",
      clawd: "clawd-idle-reading.svg",
    });
  });

  it("null file deletes the entry; noop when already unset", () => {
    const deps = makeDeps({
      snapshot: { ...prefs.getDefaults(), idleVisual: { clawd: "clawd-idle-look.svg" } },
    });
    const r = commandRegistry.setIdleVisual({ themeId: "clawd", file: null }, deps);
    assert.strictEqual(r.status, "ok");
    assert.deepStrictEqual(r.commit.idleVisual, {});

    const r2 = commandRegistry.setIdleVisual({ themeId: "clawd", file: null }, makeDeps());
    assert.strictEqual(r2.status, "ok");
    assert.strictEqual(r2.noop, true);
    assert.strictEqual(r2.commit, undefined);
  });

  it("selecting the theme default stores nothing (absence = default)", () => {
    const deps = makeDeps({
      snapshot: { ...prefs.getDefaults(), idleVisual: { clawd: "clawd-idle-look.svg" } },
    });
    const r = commandRegistry.setIdleVisual({ themeId: "clawd", file: "clawd-idle-follow.svg" }, deps);
    assert.strictEqual(r.status, "ok");
    assert.deepStrictEqual(r.commit.idleVisual, {});

    const r2 = commandRegistry.setIdleVisual(
      { themeId: "clawd", file: "clawd-idle-follow.svg" },
      makeDeps()
    );
    assert.strictEqual(r2.status, "ok");
    assert.strictEqual(r2.noop, true);
  });

  it("noop when re-selecting the current choice", () => {
    const deps = makeDeps({
      snapshot: { ...prefs.getDefaults(), idleVisual: { clawd: "clawd-idle-look.svg" } },
    });
    const r = commandRegistry.setIdleVisual({ themeId: "clawd", file: "clawd-idle-look.svg" }, deps);
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(r.noop, true);
  });

  it("updateRegistry accepts idleVisual plain objects only", () => {
    assert.strictEqual(updateRegistry.idleVisual({ clawd: "x.svg" }).status, "ok");
    assert.strictEqual(updateRegistry.idleVisual("nope").status, "error");
  });
});

describe("setAnimationOverride reaction slot", () => {
  const baseSnapshot = { theme: "clawd", themeOverrides: {} };
  const noopDeps = { snapshot: baseSnapshot, activateTheme: () => {} };

  it("rejects unknown reactionKey", () => {
    const r = commandRegistry.setAnimationOverride({
      themeId: "clawd",
      slotType: "reaction",
      reactionKey: "explode",
      file: "x.svg",
    }, noopDeps);
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /reactionKey/);
  });

  it("accepts valid reactionKey and writes reactions.<key>.file", () => {
    const r = commandRegistry.setAnimationOverride({
      themeId: "clawd",
      slotType: "reaction",
      reactionKey: "clickLeft",
      file: "my-poke.svg",
    }, noopDeps);
    assert.strictEqual(r.status, "ok");
    assert.deepStrictEqual(
      r.commit.themeOverrides.clawd.reactions.clickLeft,
      { file: "my-poke.svg" }
    );
  });

  it("rejects durationMs for drag reaction (drag plays until pointer-up)", () => {
    const r = commandRegistry.setAnimationOverride({
      themeId: "clawd",
      slotType: "reaction",
      reactionKey: "drag",
      durationMs: 2000,
    }, noopDeps);
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /drag/);
  });

  it("accepts durationMs for clickLeft reaction", () => {
    const r = commandRegistry.setAnimationOverride({
      themeId: "clawd",
      slotType: "reaction",
      reactionKey: "clickLeft",
      durationMs: 3000,
    }, noopDeps);
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(r.commit.themeOverrides.clawd.reactions.clickLeft.durationMs, 3000);
  });

  it("rejects autoReturnMs for reaction slots", () => {
    const r = commandRegistry.setAnimationOverride({
      themeId: "clawd",
      slotType: "reaction",
      reactionKey: "clickLeft",
      autoReturnMs: 3000,
    }, noopDeps);
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /autoReturnMs/);
  });

  it("clears reaction override when file is set to null with no other fields", () => {
    const snapshot = {
      theme: "clawd",
      themeOverrides: {
        clawd: { reactions: { clickLeft: { file: "old.svg" } } },
      },
    };
    const r = commandRegistry.setAnimationOverride({
      themeId: "clawd",
      slotType: "reaction",
      reactionKey: "clickLeft",
      file: null,
    }, { snapshot, activateTheme: () => {} });
    assert.strictEqual(r.status, "ok");
    // With reactions.clickLeft emptied to {}, buildThemeOverrideMap should drop
    // both `reactions` and the themeId if nothing else remains.
    assert.strictEqual(r.commit.themeOverrides.clawd, undefined);
  });

  it("preserves existing hitbox overrides when editing a reaction slot", () => {
    const snapshot = {
      theme: "clawd",
      themeOverrides: {
        clawd: {
          reactions: { clickLeft: { file: "old.svg" } },
          hitbox: { wide: { "clawd-error.svg": true } },
        },
      },
    };
    const r = commandRegistry.setAnimationOverride({
      themeId: "clawd",
      slotType: "reaction",
      reactionKey: "clickLeft",
      file: "new.svg",
    }, { snapshot, activateTheme: () => {} });
    assert.strictEqual(r.status, "ok");
    assert.deepStrictEqual(r.commit.themeOverrides.clawd.hitbox, {
      wide: { "clawd-error.svg": true },
    });
  });
});

describe("setSoundOverride command", () => {
  const baseSnapshot = { theme: "clawd", themeOverrides: {} };
  const noopDeps = { snapshot: baseSnapshot, activateTheme: () => {} };

  it("rejects missing themeId / soundName", () => {
    let r = commandRegistry.setSoundOverride({ soundName: "complete", file: "a.mp3" }, noopDeps);
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /themeId/);
    r = commandRegistry.setSoundOverride({ themeId: "clawd", file: "a.mp3" }, noopDeps);
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /soundName/);
  });

  it("rejects file when it is not null and not a non-empty string", () => {
    const r = commandRegistry.setSoundOverride(
      { themeId: "clawd", soundName: "complete", file: "" },
      noopDeps
    );
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /file/);
  });

  it("writes { sounds: { complete: { file } } } on first override", () => {
    const r = commandRegistry.setSoundOverride(
      { themeId: "clawd", soundName: "complete", file: "my-complete.mp3" },
      noopDeps
    );
    assert.strictEqual(r.status, "ok");
    assert.deepStrictEqual(r.commit.themeOverrides.clawd.sounds, {
      complete: { file: "my-complete.mp3" },
    });
  });

  it("preserves originalName in the committed entry when provided", () => {
    const r = commandRegistry.setSoundOverride(
      { themeId: "clawd", soundName: "complete", file: "complete.mp3", originalName: "cat-demo.mp3" },
      noopDeps
    );
    assert.strictEqual(r.status, "ok");
    assert.deepStrictEqual(r.commit.themeOverrides.clawd.sounds, {
      complete: { file: "complete.mp3", originalName: "cat-demo.mp3" },
    });
  });

  it("null file clears the entry and removes the theme row when nothing else is overridden", () => {
    const snapshot = {
      theme: "clawd",
      themeOverrides: {
        clawd: { sounds: { complete: { file: "old.mp3" } } },
      },
    };
    const r = commandRegistry.setSoundOverride(
      { themeId: "clawd", soundName: "complete", file: null },
      { snapshot, activateTheme: () => {} }
    );
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(r.commit.themeOverrides.clawd, undefined);
  });

  it("preserves unrelated soundName entries when editing one", () => {
    const snapshot = {
      theme: "clawd",
      themeOverrides: {
        clawd: {
          sounds: {
            complete: { file: "c.mp3" },
            confirm: { file: "x.wav" },
          },
        },
      },
    };
    const r = commandRegistry.setSoundOverride(
      { themeId: "clawd", soundName: "complete", file: "new-c.mp3" },
      { snapshot, activateTheme: () => {} }
    );
    assert.strictEqual(r.status, "ok");
    assert.deepStrictEqual(r.commit.themeOverrides.clawd.sounds, {
      complete: { file: "new-c.mp3" },
      confirm: { file: "x.wav" },
    });
  });

  it("preserves existing animation overrides when editing a sound slot", () => {
    const snapshot = {
      theme: "clawd",
      themeOverrides: {
        clawd: {
          states: { attention: { file: "attn.svg" } },
          hitbox: { wide: { "clawd-error.svg": true } },
          sounds: { confirm: { file: "c.wav" } },
        },
      },
    };
    const r = commandRegistry.setSoundOverride(
      { themeId: "clawd", soundName: "complete", file: "done.mp3" },
      { snapshot, activateTheme: () => {} }
    );
    assert.strictEqual(r.status, "ok");
    const nextClawd = r.commit.themeOverrides.clawd;
    assert.deepStrictEqual(nextClawd.states, { attention: { file: "attn.svg" } });
    assert.deepStrictEqual(nextClawd.hitbox, { wide: { "clawd-error.svg": true } });
    assert.deepStrictEqual(nextClawd.sounds, {
      confirm: { file: "c.wav" },
      complete: { file: "done.mp3" },
    });
  });

  it("same value is a noop (no commit)", () => {
    const snapshot = {
      theme: "clawd",
      themeOverrides: {
        clawd: { sounds: { complete: { file: "same.mp3" } } },
      },
    };
    const r = commandRegistry.setSoundOverride(
      { themeId: "clawd", soundName: "complete", file: "same.mp3" },
      { snapshot, activateTheme: () => {} }
    );
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(r.noop, true);
  });

  it("when active theme changes, calls activateTheme with the new override map", () => {
    const snapshot = { theme: "clawd", themeOverrides: {} };
    const calls = [];
    const r = commandRegistry.setSoundOverride(
      { themeId: "clawd", soundName: "complete", file: "a.mp3" },
      {
        snapshot,
        activateTheme: (themeId, variantId, overrideMap) => calls.push({ themeId, variantId, overrideMap }),
      }
    );
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0].overrideMap.sounds, { complete: { file: "a.mp3" } });
  });

  it("active theme edit without activateTheme dep returns error", () => {
    const r = commandRegistry.setSoundOverride(
      { themeId: "clawd", soundName: "complete", file: "a.mp3" },
      { snapshot: { theme: "clawd", themeOverrides: {} } }
    );
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /activateTheme/);
  });

  it("non-active theme skips activateTheme but still commits", () => {
    const calls = [];
    const r = commandRegistry.setSoundOverride(
      { themeId: "other", soundName: "complete", file: "a.mp3" },
      {
        snapshot: { theme: "clawd", themeOverrides: {} },
        activateTheme: () => calls.push("boom"),
      }
    );
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(calls.length, 0);
    assert.ok(r.commit.themeOverrides.other.sounds);
  });
});

describe("setWideHitboxOverride command", () => {
  it("rejects missing file / themeId", () => {
    const r = commandRegistry.setWideHitboxOverride({ themeId: "clawd", enabled: true }, { snapshot: {} });
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /file/);
  });

  it("rejects non-boolean / non-null enabled", () => {
    const r = commandRegistry.setWideHitboxOverride({
      themeId: "clawd", file: "x.svg", enabled: "yes",
    }, { snapshot: {} });
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /boolean or null/);
  });

  it("writes hitbox.wide[file] = true when enabled", () => {
    const snapshot = { theme: "clawd", themeOverrides: {} };
    const r = commandRegistry.setWideHitboxOverride(
      { themeId: "clawd", file: "clawd-error.svg", enabled: true },
      { snapshot, activateTheme: () => {} }
    );
    assert.strictEqual(r.status, "ok");
    assert.deepStrictEqual(
      r.commit.themeOverrides.clawd.hitbox.wide,
      { "clawd-error.svg": true }
    );
  });

  it("clears the entry when enabled=null (fall back to theme default)", () => {
    const snapshot = {
      theme: "clawd",
      themeOverrides: {
        clawd: { hitbox: { wide: { "clawd-error.svg": true } } },
      },
    };
    const r = commandRegistry.setWideHitboxOverride(
      { themeId: "clawd", file: "clawd-error.svg", enabled: null },
      { snapshot, activateTheme: () => {} }
    );
    assert.strictEqual(r.status, "ok");
    // Entire hitbox + themeId entry drops when last toggle is cleared.
    assert.strictEqual(r.commit.themeOverrides.clawd, undefined);
  });

  it("noop when setting same value", () => {
    const snapshot = {
      theme: "clawd",
      themeOverrides: {
        clawd: { hitbox: { wide: { "clawd-error.svg": true } } },
      },
    };
    const r = commandRegistry.setWideHitboxOverride(
      { themeId: "clawd", file: "clawd-error.svg", enabled: true },
      { snapshot }
    );
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(r.noop, true);
  });

  it("triggers activateTheme with next override map when active theme changes", () => {
    let activatedWith = null;
    const snapshot = { theme: "clawd", themeOverrides: {} };
    const r = commandRegistry.setWideHitboxOverride(
      { themeId: "clawd", file: "foo.svg", enabled: true },
      {
        snapshot,
        activateTheme: (id, variantId, overrideMap) => { activatedWith = { id, overrideMap }; },
      }
    );
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(activatedWith.id, "clawd");
    assert.deepStrictEqual(activatedWith.overrideMap, {
      hitbox: { wide: { "foo.svg": true } },
    });
  });

  it("prefers refreshActiveThemeHitboxOverrides over activateTheme for active theme changes", () => {
    let refreshedWith = null;
    let activated = false;
    const snapshot = { theme: "clawd", themeOverrides: {} };
    const r = commandRegistry.setWideHitboxOverride(
      { themeId: "clawd", file: "foo.svg", enabled: true },
      {
        snapshot,
        refreshActiveThemeHitboxOverrides: (id, overrideMap) => {
          refreshedWith = { id, overrideMap };
        },
        activateTheme: () => {
          activated = true;
        },
      }
    );
    assert.strictEqual(r.status, "ok");
    assert.deepStrictEqual(refreshedWith, {
      id: "clawd",
      overrideMap: {
        hitbox: { wide: { "foo.svg": true } },
      },
    });
    assert.strictEqual(activated, false);
  });
});

describe("theme override subtree preservation", () => {
  it("setThemeOverrideDisabled keeps existing reactions and hitbox overrides", () => {
    const snapshot = {
      theme: "clawd",
      themeOverrides: {
        clawd: {
          states: { attention: { file: "attention.svg" } },
          reactions: { clickLeft: { file: "click.svg" } },
          hitbox: { wide: { "clawd-error.svg": true } },
        },
      },
    };
    const r = commandRegistry.setThemeOverrideDisabled(
      { themeId: "clawd", stateKey: "attention", disabled: true },
      { snapshot }
    );
    assert.strictEqual(r.status, "ok");
    assert.deepStrictEqual(r.commit.themeOverrides.clawd.reactions, {
      clickLeft: { file: "click.svg" },
    });
    assert.deepStrictEqual(r.commit.themeOverrides.clawd.hitbox, {
      wide: { "clawd-error.svg": true },
    });
  });
});

describe("importAnimationOverrides command", () => {
  const validPayload = {
    version: 1,
    themes: {
      clawd: {
        states: {
          error: { file: "clawd-error.svg" },
          attention: { disabled: true },
        },
      },
    },
  };

  it("rejects non-object payloads", () => {
    const r = commandRegistry.importAnimationOverrides(null, { snapshot: {} });
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /must be an object/);
  });

  it("rejects payloads missing themes map", () => {
    const r = commandRegistry.importAnimationOverrides({ version: 1 }, { snapshot: {} });
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /themes/);
  });

  it("rejects payloads whose version is newer than supported", () => {
    const r = commandRegistry.importAnimationOverrides(
      { version: 999, themes: { clawd: {} } },
      { snapshot: {} }
    );
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /newer than supported/);
  });

  it("rejects when normalized payload has no valid entries", () => {
    const r = commandRegistry.importAnimationOverrides(
      { version: 1, themes: { clawd: { not_a_real_field: 1 } } },
      { snapshot: {} }
    );
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /no valid/);
  });

  it("merges by theme id into existing overrides by default", () => {
    const snapshot = {
      theme: "calico",
      themeOverrides: {
        calico: { states: { attention: { file: "cat-attention.svg" } } },
      },
    };
    const r = commandRegistry.importAnimationOverrides(validPayload, { snapshot });
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(r.mode, "merge");
    assert.ok(r.commit.themeOverrides.calico, "calico overrides preserved on merge");
    assert.ok(r.commit.themeOverrides.clawd, "clawd overrides added on merge");
    assert.strictEqual(r.importedThemeCount, 1);
  });

  it("replaces the entire map when mode=replace", () => {
    const snapshot = {
      theme: "calico",
      themeOverrides: {
        calico: { states: { attention: { file: "cat-attention.svg" } } },
      },
    };
    const r = commandRegistry.importAnimationOverrides(
      { ...validPayload, mode: "replace" },
      { snapshot, activateTheme: () => {} }
    );
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(r.mode, "replace");
    assert.strictEqual(r.commit.themeOverrides.calico, undefined);
    assert.ok(r.commit.themeOverrides.clawd);
  });

  it("calls activateTheme with the new override map for the active theme", () => {
    // Regression: the effect runs BEFORE controller._commit, so activateTheme
    // must receive the new override map explicitly — reading themeOverrides
    // from the store would see the stale pre-import value and the imported
    // slots would never take effect.
    const calls = [];
    const snapshot = { theme: "clawd", themeOverrides: {} };
    const r = commandRegistry.importAnimationOverrides(validPayload, {
      snapshot,
      activateTheme: (id, variantId, overrideMap) => {
        calls.push({ id, variantId, overrideMap });
      },
    });
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].id, "clawd");
    assert.ok(calls[0].overrideMap, "overrideMap must not be null");
    assert.deepStrictEqual(
      calls[0].overrideMap,
      r.commit.themeOverrides.clawd,
      "activateTheme must receive the same normalized override map that gets committed"
    );
  });

  it("skips activateTheme when active theme overrides are unchanged", () => {
    let activated = null;
    const snapshot = {
      theme: "clawd",
      themeOverrides: {
        clawd: {
          states: {
            error: { file: "clawd-error.svg" },
            attention: { disabled: true },
          },
        },
      },
    };
    const r = commandRegistry.importAnimationOverrides(validPayload, {
      snapshot,
      activateTheme: (id) => { activated = id; },
    });
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(activated, null, "activateTheme should not fire when data unchanged");
  });

  it("errors when activateTheme dep is missing and active theme needs reload", () => {
    const snapshot = { theme: "clawd", themeOverrides: {} };
    const r = commandRegistry.importAnimationOverrides(validPayload, { snapshot });
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /activateTheme/);
  });

  it("does not require activateTheme when import only touches non-active themes", () => {
    const snapshot = { theme: "calico", themeOverrides: {} };
    const r = commandRegistry.importAnimationOverrides(validPayload, { snapshot });
    assert.strictEqual(r.status, "ok");
    assert.ok(r.commit.themeOverrides.clawd);
  });
});

describe("textScaleByDisplay validator", () => {
  it("has a registry entry so command commits pass controller validation", () => {
    // Regression: the controller rejects command commits whose keys lack a
    // registry validator ("unknown settings key textScaleByDisplay").
    assert.strictEqual(typeof updateRegistry.textScaleByDisplay, "function");
  });

  it("accepts a valid display map and rejects junk entries", () => {
    assert.strictEqual(updateRegistry.textScaleByDisplay({ "1": 1.35, "2": 0.8 }).status, "ok");
    assert.strictEqual(updateRegistry.textScaleByDisplay({}).status, "ok");
    assert.strictEqual(updateRegistry.textScaleByDisplay(null).status, "error");
    assert.strictEqual(updateRegistry.textScaleByDisplay([1.2]).status, "error");
    assert.strictEqual(updateRegistry.textScaleByDisplay({ "1": 99 }).status, "error");
    assert.strictEqual(updateRegistry.textScaleByDisplay({ "1": "1.2" }).status, "error");
    assert.strictEqual(updateRegistry.textScaleByDisplay({ " ": 1.2 }).status, "error");
  });
});

describe("setTextScaleForDisplay command", () => {
  it("writes the entry for the resolved display and keeps other displays", () => {
    const r = commandRegistry.setTextScaleForDisplay({ value: 1.35 }, {
      snapshot: { textScaleByDisplay: { "2": 1.2 } },
      resolveTextScaleDisplayKey: () => "1",
    });
    assert.strictEqual(r.status, "ok");
    assert.deepStrictEqual(r.commit, { textScaleByDisplay: { "1": 1.35, "2": 1.2 } });
  });

  it("overwrites an existing entry for the same display", () => {
    const r = commandRegistry.setTextScaleForDisplay({ value: 1 }, {
      snapshot: { textScaleByDisplay: { "1": 1.35 } },
      resolveTextScaleDisplayKey: () => "1",
    });
    assert.deepStrictEqual(r.commit, { textScaleByDisplay: { "1": 1 } });
  });

  it("falls back to the legacy global without display context", () => {
    const r = commandRegistry.setTextScaleForDisplay({ value: 1.25 }, { snapshot: {} });
    assert.strictEqual(r.status, "ok");
    assert.deepStrictEqual(r.commit, { textScale: 1.25 });
  });

  it("never evicts the entry being written when the map is at capacity", () => {
    const full = {};
    for (let i = 0; i < 16; i++) full[`d${i}`] = 1.2;
    const r = commandRegistry.setTextScaleForDisplay({ value: 1.4 }, {
      snapshot: { textScaleByDisplay: full },
      resolveTextScaleDisplayKey: () => "fresh",
    });
    assert.strictEqual(r.commit.textScaleByDisplay.fresh, 1.4);
    assert.strictEqual(Object.keys(r.commit.textScaleByDisplay).length, 16);
  });

  it("rejects out-of-range and non-numeric values", () => {
    const deps = { snapshot: {}, resolveTextScaleDisplayKey: () => "1" };
    assert.strictEqual(commandRegistry.setTextScaleForDisplay({ value: 0.5 }, deps).status, "error");
    assert.strictEqual(commandRegistry.setTextScaleForDisplay({ value: 2 }, deps).status, "error");
    assert.strictEqual(commandRegistry.setTextScaleForDisplay({ value: "abc" }, deps).status, "error");
    assert.strictEqual(commandRegistry.setTextScaleForDisplay(null, deps).status, "error");
  });
});

describe("version validator", () => {
  it("accepts the current version", () => {
    const r = updateRegistry.version(prefs.CURRENT_VERSION, { snapshot: prefs.getDefaults() });
    assert.strictEqual(r.status, "ok");
  });

  it("rejects future versions", () => {
    const r = updateRegistry.version(prefs.CURRENT_VERSION + 1, { snapshot: prefs.getDefaults() });
    assert.strictEqual(r.status, "error");
  });

  it("rejects non-positive numbers", () => {
    const deps = { snapshot: prefs.getDefaults() };
    assert.strictEqual(updateRegistry.version(0, deps).status, "error");
    assert.strictEqual(updateRegistry.version(-1, deps).status, "error");
    assert.strictEqual(updateRegistry.version("1", deps).status, "error");
  });
});

describe("idle behavior validation and command", () => {
  for (const [key, other] of [["freeRoam", "idleActivities"], ["idleActivities", "freeRoam"]]) {
    it(`${key} validates booleans and rejects the conflicting enabled mode`, () => {
      const validate = updateRegistry[key];
      assert.strictEqual(typeof validate, "function");
      assert.strictEqual(validate(true).status, "ok");
      assert.strictEqual(validate(true, { snapshot: { [other]: false } }).status, "ok");
      const conflict = validate(true, { snapshot: { [other]: true } });
      assert.strictEqual(conflict.status, "error");
      assert.match(conflict.message, /mutually exclusive.*setIdleBehavior/);
      for (const otherValue of [false, true]) {
        assert.strictEqual(validate(false, { snapshot: { [other]: otherValue } }).status, "ok");
        for (const value of [null, undefined, "true", 1, {}, []]) {
          assert.strictEqual(validate(value, { snapshot: { [other]: otherValue } }).status, "error");
        }
      }
    });
  }

  const targets = {
    none: { freeRoam: false, idleActivities: false },
    roam: { freeRoam: true, idleActivities: false },
    activities: { freeRoam: false, idleActivities: true },
  };
  for (const [mode, target] of Object.entries(targets)) {
    it(`setIdleBehavior commits the ${mode} pair for string and object payloads`, () => {
      for (const payload of [mode, { mode }]) {
        for (const freeRoam of [false, true]) {
          for (const idleActivities of [false, true]) {
            const result = commandRegistry.setIdleBehavior(payload, { snapshot: { freeRoam, idleActivities } });
            assert.deepStrictEqual(result, freeRoam === target.freeRoam && idleActivities === target.idleActivities
              ? { status: "ok", noop: true }
              : { status: "ok", commit: target });
          }
        }
        assert.deepStrictEqual(commandRegistry.setIdleBehavior(payload), { status: "ok", commit: target });
      }
    });
  }

  it("setIdleBehavior rejects missing and invalid modes", () => {
    for (const payload of [undefined, null, {}, [], true, 1, "", "invalid", { mode: "invalid" }, { mode: false }]) {
      assert.strictEqual(commandRegistry.setIdleBehavior(payload).status, "error");
    }
  });
});

