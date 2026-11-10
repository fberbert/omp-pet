"use strict";

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const prefs = require("../src/prefs");

const tempDirs = [];

function makeTempPath(name = "clawd-prefs.json") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-prefs-"));
  tempDirs.push(dir);
  return path.join(dir, name);
}

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("prefs.getDefaults", () => {
  it("includes the current schema version", () => {
    const d = prefs.getDefaults();
    assert.strictEqual(d.version, prefs.CURRENT_VERSION);
  });

  it("defaults the pet always-on-top master switch on and coerces non-booleans (#1275)", () => {
    const defaults = prefs.getDefaults();
    assert.strictEqual(defaults.petAlwaysOnTop, true);
    assert.strictEqual(prefs.validate({ petAlwaysOnTop: false }).petAlwaysOnTop, false);
    assert.strictEqual(prefs.validate({ petAlwaysOnTop: "off" }).petAlwaysOnTop, true);
  });
});

describe("prefs.validate", () => {
  it("accepts soundVolume 0 (silent playback is valid)", () => {
    const v = prefs.validate({ soundVolume: 0 });
    assert.strictEqual(v.soundVolume, 0);
  });

  it("keeps textScale within 0.8–1.6 and defaults out-of-range values", () => {
    assert.strictEqual(prefs.validate({ textScale: 1.25 }).textScale, 1.25);
    assert.strictEqual(prefs.validate({ textScale: 0.8 }).textScale, 0.8);
    assert.strictEqual(prefs.validate({ textScale: 1.6 }).textScale, 1.6);
    assert.strictEqual(prefs.validate({ textScale: 0.5 }).textScale, 1);
    assert.strictEqual(prefs.validate({ textScale: 2 }).textScale, 1);
    assert.strictEqual(prefs.validate({ textScale: "1.2" }).textScale, 1);
    assert.strictEqual(prefs.getDefaults().textScale, 1);
  });

  it("normalizes agents: preserves integrationInstalled for every known agent", () => {
    const d = prefs.getDefaults();
    const inputAgents = {};
    for (const agentId of Object.keys(d.agents)) {
      inputAgents[agentId] = {
        integrationInstalled: !d.agents[agentId].integrationInstalled,
        enabled: d.agents[agentId].enabled,
      };
    }
    const v = prefs.validate({ agents: inputAgents });
    for (const agentId of Object.keys(d.agents)) {
      assert.strictEqual(
        v.agents[agentId].integrationInstalled,
        !d.agents[agentId].integrationInstalled,
        `${agentId} should preserve integrationInstalled`
      );
    }
  });

  it("returns defaults for null/non-object input", () => {
    const a = prefs.validate(null);
    const b = prefs.validate("not an object");
    const d = prefs.getDefaults();
    assert.deepStrictEqual(a, d);
    assert.deepStrictEqual(b, d);
  });

  it("positionDisplay defaults to null and round-trips a valid snapshot", () => {
    const d = prefs.getDefaults();
    assert.strictEqual(d.positionDisplay, null);

    const v = prefs.validate({
      positionDisplay: {
        id: 42,
        scaleFactor: 2,
        bounds: { x: 0, y: 0, width: 2560, height: 1440 },
        workArea: { x: 0, y: 0, width: 2560, height: 1392 },
        stray: "ignored",
      },
    });
    assert.deepStrictEqual(v.positionDisplay, {
      id: 42,
      scaleFactor: 2,
      bounds: { x: 0, y: 0, width: 2560, height: 1440 },
      workArea: { x: 0, y: 0, width: 2560, height: 1392 },
    });
  });

  it("positionDisplay drops malformed snapshots back to null", () => {
    for (const bad of [
      { positionDisplay: "not an object" },
      { positionDisplay: { bounds: null } },
      { positionDisplay: { bounds: { x: 0, y: 0, width: 0, height: 1080 } } },
      { positionDisplay: { bounds: { x: NaN, y: 0, width: 1920, height: 1080 } } },
    ]) {
      const v = prefs.validate(bad);
      assert.strictEqual(v.positionDisplay, null, `expected null for ${JSON.stringify(bad)}`);
    }
  });

  // Phase 3b-swap: themeVariant field
  it("themeVariant defaults to empty object (no migration needed)", () => {
    const d = prefs.getDefaults();
    assert.deepStrictEqual(d.themeVariant, {});
  });

  it("themeVariant drops malformed entries but keeps string/string pairs", () => {
    const v = prefs.validate({
      themeVariant: {
        clawd: "chill",
        calico: "default",
        bogus: 42,           // wrong value type
        "": "chill",         // empty themeId
        nullVal: "",         // empty variantId
      },
    });
    assert.deepStrictEqual(v.themeVariant, { clawd: "chill", calico: "default" });
  });

  it("themeVariant falls back to defaults when not an object", () => {
    const v = prefs.validate({ themeVariant: "nope" });
    assert.deepStrictEqual(v.themeVariant, {});
    const w = prefs.validate({ themeVariant: [1, 2] });
    assert.deepStrictEqual(w.themeVariant, {});
  });

  // #509: idleVisual field
  it("idleVisual defaults to empty object (no migration needed)", () => {
    const d = prefs.getDefaults();
    assert.deepStrictEqual(d.idleVisual, {});
  });

  it("idleVisual keeps string/string pairs, drops malformed and path-y entries", () => {
    const v = prefs.validate({
      idleVisual: {
        clawd: "clawd-idle-reading.svg",
        calico: "calico-idle-stretch.svg",
        bogus: 42,                          // wrong value type
        "": "x.svg",                        // empty themeId
        emptyVal: "",                       // empty file
        sneaky: "../outside.svg",           // path traversal
        sneakier: "sub\\dir.svg",           // backslash path
      },
    });
    assert.deepStrictEqual(v.idleVisual, {
      clawd: "clawd-idle-reading.svg",
      calico: "calico-idle-stretch.svg",
    });
  });

  it("idleVisual falls back to defaults when not an object", () => {
    const v = prefs.validate({ idleVisual: "nope" });
    assert.deepStrictEqual(v.idleVisual, {});
    const w = prefs.validate({ idleVisual: ["a.svg"] });
    assert.deepStrictEqual(w.idleVisual, {});
  });

  it("sessionAliases normalizes valid entries and drops malformed values", () => {
    const v = prefs.validate({
      sessionAliases: {
        "local|codex|s1": { title: "  Codex main  ", updatedAt: 100 },
        "local|codex|missing-time": { title: "Missing time" },
        "local|codex|empty": { title: "   ", updatedAt: 100 },
        "local|codex|bad": { title: 42, updatedAt: 100 },
      },
    });
    assert.strictEqual(v.sessionAliases["local|codex|s1"].title, "Codex main");
    assert.strictEqual(v.sessionAliases["local|codex|s1"].updatedAt, 100);
    assert.strictEqual(v.sessionAliases["local|codex|missing-time"].title, "Missing time");
    assert.strictEqual(typeof v.sessionAliases["local|codex|missing-time"].updatedAt, "number");
    assert.strictEqual(Object.prototype.hasOwnProperty.call(v.sessionAliases, "local|codex|empty"), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(v.sessionAliases, "local|codex|bad"), false);
  });

  it("sessionAliases falls back to defaults when not an object", () => {
    assert.deepStrictEqual(prefs.validate({ sessionAliases: "nope" }).sessionAliases, {});
    assert.deepStrictEqual(prefs.validate({ sessionAliases: [1, 2] }).sessionAliases, {});
  });

  it("drops legacy workspaceAliases because they are no longer in the schema", () => {
    const v = prefs.validate({
      workspaceAliases: {
        "local|d:/animation": "Clawd main repo",
      },
    });
    assert.strictEqual(Object.prototype.hasOwnProperty.call(v, "workspaceAliases"), false);
    assert.deepStrictEqual(v.sessionAliases, {});
  });

  it("accepts sessionStaleMs=0 (disables idle-age cutoff)", () => {
    const v = prefs.validate({ sessionStaleMs: 0 });
    assert.strictEqual(v.sessionStaleMs, 0);
  });

  it("drops below-minimum non-zero sessionStaleMs back to default", () => {
    // 30s is below the 60s floor for non-zero values, so it should fall
    // back to the default rather than land on disk as an unsafe value.
    const v = prefs.validate({ sessionStaleMs: 30_000 });
    assert.strictEqual(v.sessionStaleMs, 600_000);
  });

  it("drops workingStaleMs=0 back to default (0 not allowed)", () => {
    const v = prefs.validate({ workingStaleMs: 0 });
    assert.strictEqual(v.workingStaleMs, 300_000);
  });

  it("drops detachedIdleStaleMs=0 back to default (0 not allowed)", () => {
    const v = prefs.validate({ detachedIdleStaleMs: 0 });
    assert.strictEqual(v.detachedIdleStaleMs, 30_000);
  });

  it("clamps a hand-edited inverted pair: workingStaleMs > sessionStaleMs", () => {
    const v = prefs.validate({
      sessionStaleMs: 120_000,
      workingStaleMs: 600_000,
    });
    assert.strictEqual(v.sessionStaleMs, 120_000);
    assert.strictEqual(v.workingStaleMs, 120_000);
  });

  it("leaves workingStaleMs alone when sessionStaleMs is disabled (=0)", () => {
    const v = prefs.validate({
      sessionStaleMs: 0,
      workingStaleMs: 600_000,
    });
    assert.strictEqual(v.sessionStaleMs, 0);
    assert.strictEqual(v.workingStaleMs, 600_000);
  });
});

describe("prefs.migrate", () => {
  it("migrates v1 files to the current version while preserving agent prefs", () => {
    const raw = {
      version: 1,
      lang: "en",
      agents: { "claude-code": { enabled: false } },
    };
    const upgraded = prefs.migrate(raw);
    assert.strictEqual(upgraded.version, prefs.CURRENT_VERSION);
    assert.strictEqual(upgraded.agents["claude-code"].enabled, false);
  });

  it("does not overwrite existing positionSaved field", () => {
    const raw = { version: 1, x: 0, y: 0, positionSaved: true };
    const upgraded = prefs.migrate(raw);
    assert.strictEqual(upgraded.positionSaved, true);
  });
});

describe("prefs.migrate v4 → v5 (sessionHudAutoHide removal)", () => {
  it("treats missing sessionHudAutoHide as no-op (no pin auto-set)", () => {
    const upgraded = prefs.migrate({
      version: 4,
      sessionHudPinned: false,
    });
    assert.strictEqual(upgraded.sessionHudPinned, false);
    assert.strictEqual("sessionHudAutoHide" in upgraded, false);
  });
});

describe("prefs.migrate v9 → v10 (compact HUD defaults are fresh-install only)", () => {
  it("preserves explicit values that match neither old nor new default", () => {
    const validated = prefs.validate(prefs.migrate({
      version: 9,
      sessionHudShowElapsed: false,
      sessionHudCleanupDetached: true,
    }));
    assert.strictEqual(validated.sessionHudShowElapsed, false);
    assert.strictEqual(validated.sessionHudCleanupDetached, true);
  });

  it("fresh defaults (no prefs file, migrate never runs) get the compact HUD", () => {
    const d = prefs.getDefaults();
    assert.strictEqual(d.sessionHudShowElapsed, false);
    assert.strictEqual(d.sessionHudCleanupDetached, true);
  });

  it("is idempotent on v10 input (a fresh-install save is not re-backfilled)", () => {
    // A v10 file that legitimately lacks the keys does not exist (save()
    // bakes them), but the branch must still not fire for v10 input.
    const upgraded = prefs.migrate({ version: 10 });
    assert.strictEqual("sessionHudShowElapsed" in upgraded, false);
    assert.strictEqual("sessionHudCleanupDetached" in upgraded, false);
  });
});

describe("prefs.migrate v11 → v12 (showDock default off for fresh installs)", () => {

  it("is idempotent on v12 input (a fresh-install save is not re-backfilled)", () => {
    const upgraded = prefs.migrate({ version: 12 });
    assert.strictEqual("showDock" in upgraded, false);
  });
});

describe("prefs.migrate v13 → v14 (Dashboard window bounds)", () => {
  it("preserves valid geometry from an early v13 build or hand-edited file", () => {
    const bounds = { x: -1180, y: 90, width: 920, height: 680 };
    const upgraded = prefs.validate(prefs.migrate({
      version: 13,
      dashboardWindowBounds: bounds,
    }));
    assert.deepStrictEqual(upgraded.dashboardWindowBounds, bounds);
  });
});

describe("prefs.migrate v16 → v17 (mouth accessory slot)", () => {
  it("preserves a valid mouth selection from an unreleased v16 development snapshot", () => {
    const upgraded = prefs.validate(prefs.migrate({
      version: 16,
      petMouthAccessory: { clawd: "cigarette" },
    }));
    assert.deepStrictEqual(upgraded.petMouthAccessory, { clawd: "cigarette" });
  });

  it("does not share the new default map between snapshots", () => {
    const first = prefs.validate(prefs.migrate({ version: 16 }));
    const second = prefs.validate(prefs.migrate({ version: 16 }));
    assert.notStrictEqual(first.petMouthAccessory, second.petMouthAccessory);
  });
});

describe("prefs.migrate v12 → v13 (Settings window bounds)", () => {
  it("preserves valid geometry from an early v12 build or hand-edited file", () => {
    const bounds = { x: -1180, y: 90, width: 920, height: 680 };
    const upgraded = prefs.validate(prefs.migrate({
      version: 12,
      settingsWindowBounds: bounds,
    }));
    assert.deepStrictEqual(upgraded.settingsWindowBounds, bounds);
  });
});

describe("prefs permission automation safe startup persistence", () => {
  it("save() strips autoApproveAllPermissions from the on-disk file", () => {
    const p = makeTempPath();
    prefs.save(p, { ...prefs.getDefaults(), autoApproveAllPermissions: true, lang: "zh" });
    const onDisk = JSON.parse(fs.readFileSync(p, "utf8"));
    assert.strictEqual("autoApproveAllPermissions" in onDisk, false, "ephemeral key must not be written");
    assert.strictEqual(onDisk.lang, "zh", "non-ephemeral fields still persist");
  });
});

describe("prefs.load", () => {
  it("returns defaults for missing file (ENOENT) without backup", () => {
    const p = makeTempPath();
    const { snapshot, locked, fresh, recovered } = prefs.load(p);
    assert.strictEqual(locked, false);
    assert.strictEqual(fresh, true);
    assert.strictEqual(recovered, undefined);
    assert.deepStrictEqual(snapshot, prefs.getDefaults());
    // Should NOT have created a backup since file never existed
    assert.strictEqual(fs.existsSync(p + ".bak"), false);
  });

  it("backs up corrupt JSON and returns defaults", () => {
    const p = makeTempPath();
    fs.writeFileSync(p, "{ this is not valid json", "utf8");
    const { snapshot, locked, recovered } = prefs.load(p);
    assert.strictEqual(locked, false);
    assert.strictEqual(recovered, true);
    assert.deepStrictEqual(snapshot, prefs.getDefaults());
    assert.strictEqual(fs.existsSync(p + ".bak"), true);
    assert.strictEqual(
      fs.readFileSync(p + ".bak", "utf8"),
      "{ this is not valid json"
    );
  });

  it("locks an invalid prefs file when its recovery backup cannot be created", () => {
    const p = makeTempPath();
    const original = "{ invalid json";
    fs.writeFileSync(p, original, "utf8");
    fs.mkdirSync(p + ".bak");

    const loaded = prefs.load(p);
    assert.strictEqual(loaded.locked, true);
    assert.strictEqual(loaded.recovered, true);
    assert.strictEqual(loaded.recoveryBackupFailed, true);
    assert.deepStrictEqual(loaded.snapshot, prefs.getDefaults());

    if (!loaded.locked) prefs.save(p, loaded.snapshot);
    assert.strictEqual(fs.readFileSync(p, "utf8"), original);
  });

  // POSIX-only: on Windows `chmod` only toggles the read-only bit and does not deny
  // reads, so the EACCES branch is unreachable there and these assertions would fail
  // for a reason that has nothing to do with prefs. `npm test` does run on
  // windows-latest (.github/workflows/build.yml), so the skip is load-bearing.
  // Same shape as `posixOnly` in test/antigravity-install.test.js.
  const unreadableOnly = {
    skip: process.platform === "win32" ? "chmod cannot deny reads on Windows" : false,
  };

  it("locks an unreadable prefs file so save() cannot clobber it", unreadableOnly, function () {
    // Root can read anything, so the EACCES path is unreachable there too.
    if (typeof process.getuid === "function" && process.getuid() === 0) return this.skip?.();
    // 0o200 (write-only), NOT 0o000. With 0o000 the file is also unwritable, so the
    // clobber this test exists to prevent could never happen there — the lane would
    // assert a flag while the invariant was safe for an unrelated reason. Write-only
    // is the state that actually loses data: unreadable, yet perfectly writable.
    const p = makeTempPath();
    const original = JSON.stringify({ agents: { "claude-code": { enabled: false } } });
    fs.writeFileSync(p, original, "utf8");
    fs.chmodSync(p, 0o200);
    try {
      const loaded = prefs.load(p);
      assert.strictEqual(loaded.locked, true);
      assert.strictEqual(loaded.recovered, true);
      assert.deepStrictEqual(loaded.snapshot, prefs.getDefaults());
      // No backup: copyFileSync would read the same unreadable file.
      assert.strictEqual(fs.existsSync(p + ".bak"), false);

    } finally {
      fs.chmodSync(p, 0o600);
    }
  });

  // Separate from the lane above **on purpose**: that one asserts the flag, and an
  // assertion on the flag short-circuits before the outcome is ever exercised. This
  // one never looks at `locked` directly — it only does what the single real caller
  // does (settings-controller.js:111, `if (locked) return { noop: true }`) and then
  // asks the question that actually matters: is the user's file still there?
  it("does not clobber prefs it could not read", unreadableOnly, function () {
    if (typeof process.getuid === "function" && process.getuid() === 0) return this.skip?.();
    const p = makeTempPath();
    const original = JSON.stringify({ agents: { "claude-code": { enabled: false } } });
    fs.writeFileSync(p, original, "utf8");
    fs.chmodSync(p, 0o200); // write-only: unreadable, yet perfectly writable
    try {
      const loaded = prefs.load(p);
      if (!loaded.locked) prefs.save(p, loaded.snapshot);
      fs.chmodSync(p, 0o600);
      assert.strictEqual(
        fs.readFileSync(p, "utf8"),
        original,
        "prefs we could not read must survive a persist attempt byte for byte"
      );
    } finally {
      fs.chmodSync(p, 0o600);
    }
  });

  it("marks a non-object prefs root as a recovered defaults snapshot", () => {
    const p = makeTempPath();
    fs.writeFileSync(p, "null", "utf8");
    const { snapshot, locked, fresh, recovered } = prefs.load(p);
    assert.strictEqual(locked, false);
    assert.strictEqual(fresh, undefined);
    assert.strictEqual(recovered, true);
    assert.deepStrictEqual(snapshot, prefs.getDefaults());
    assert.strictEqual(fs.readFileSync(p + ".bak", "utf8"), "null");
  });

  it("marks an array prefs root as a recovered defaults snapshot", () => {
    const p = makeTempPath();
    fs.writeFileSync(p, "[]", "utf8");
    const { snapshot, locked, fresh, recovered } = prefs.load(p);
    assert.strictEqual(locked, false);
    assert.strictEqual(fresh, undefined);
    assert.strictEqual(recovered, true);
    assert.deepStrictEqual(snapshot, prefs.getDefaults());
    assert.strictEqual(fs.readFileSync(p + ".bak", "utf8"), "[]");
  });

  it("migrates a v0 file (no version field) on load", () => {
    const p = makeTempPath();
    fs.writeFileSync(
      p,
      JSON.stringify({ lang: "zh", x: 100, y: 200, size: "P:12" }),
      "utf8"
    );
    const { snapshot, locked } = prefs.load(p);
    assert.strictEqual(locked, false);
    assert.strictEqual(snapshot.version, prefs.CURRENT_VERSION);
    assert.strictEqual(snapshot.lang, "zh");
    assert.strictEqual(snapshot.x, 100);
    assert.strictEqual(snapshot.y, 200);
    assert.strictEqual(snapshot.size, "P:12");
    // New fields populated from defaults
    assert.ok(snapshot.agents);
    assert.ok(snapshot.themeOverrides);
  });

  it("returns locked=true and warns for future-version files", () => {
    const p = makeTempPath();
    fs.writeFileSync(
      p,
      JSON.stringify({ version: 999, lang: "en" }),
      "utf8"
    );
    const originalWarn = console.warn;
    let warned = false;
    console.warn = () => { warned = true; };
    try {
      const { snapshot, locked } = prefs.load(p);
      assert.strictEqual(locked, true);
      assert.strictEqual(snapshot.lang, "en");
      assert.strictEqual(warned, true);
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe("prefs.save", () => {
  it("round-trips an explicit native macOS Control shortcut", () => {
    const p = makeTempPath();
    const snap = prefs.getDefaults();
    snap.shortcuts.togglePet = "Control+Shift+1";

    prefs.save(p, snap);
    const { snapshot, locked } = prefs.load(p);

    assert.strictEqual(locked, false);
    assert.strictEqual(snapshot.version, prefs.CURRENT_VERSION);
    assert.strictEqual(snapshot.shortcuts.togglePet, "Control+Shift+1");
  });

  it("normalizes Settings window bounds and drops invalid geometry", () => {
    assert.deepStrictEqual(
      prefs.validate({
        settingsWindowBounds: {
          x: 10.4,
          y: -20.6,
          width: 801.7,
          height: 559.8,
          ignored: true,
        },
      }).settingsWindowBounds,
      { x: 10, y: -21, width: 802, height: 560 },
    );

    for (const value of [
      { x: 0, y: 0, width: 0, height: 560 },
      { x: Infinity, y: 0, width: 800, height: 560 },
      { x: "0", y: 0, width: 800, height: 560 },
      { x: 0, y: 0, width: 800 },
      [],
      "800x560",
    ]) {
      assert.strictEqual(prefs.validate({ settingsWindowBounds: value }).settingsWindowBounds, null);
    }
  });

  it("normalizes Dashboard window bounds and drops invalid geometry", () => {
    assert.deepStrictEqual(
      prefs.validate({
        dashboardWindowBounds: {
          x: 10.6,
          y: -20.6,
          width: 801.7,
          height: 559.8,
          ignored: true,
        },
      }).dashboardWindowBounds,
      { x: 11, y: -21, width: 802, height: 560 },
    );

    for (const value of [
      { x: 0, y: 0, width: 0, height: 560 },
      { x: Infinity, y: 0, width: 800, height: 560 },
      { x: "0", y: 0, width: 800, height: 560 },
      { x: 0, y: 0, width: 800 },
      [],
      "800x560",
    ]) {
      assert.strictEqual(prefs.validate({ dashboardWindowBounds: value }).dashboardWindowBounds, null);
    }
  });

  it("round-trips per-theme pet tints and drops invalid entries before writing", () => {
    const p = makeTempPath();
    prefs.save(p, {
      ...prefs.getDefaults(),
      petTint: { clawd: "vaporwave", cloudling: "matcha" },
    });
    assert.deepStrictEqual(
      prefs.load(p).snapshot.petTint,
      { clawd: "vaporwave", cloudling: "matcha" }
    );

    prefs.save(p, {
      ...prefs.getDefaults(),
      petTint: { clawd: "custom", "../unsafe": "gold", calico: "none" },
    });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(p, "utf8")).petTint, {});
  });

  it("migrates the short-lived global pet tint to supported built-in themes", () => {
    assert.deepStrictEqual(
      prefs.validate({ petTint: "gold" }).petTint,
      { clawd: "gold", cloudling: "gold" }
    );
    assert.deepStrictEqual(prefs.validate({ petTint: "none" }).petTint, {});
  });

  it("round-trips per-theme accessories and rejects the discarded global scalar shape", () => {
    const p = makeTempPath();
    prefs.save(p, {
      ...prefs.getDefaults(),
      petAccessory: { clawd: "wizard-hat", cloudling: "halo" },
    });
    assert.deepStrictEqual(
      prefs.load(p).snapshot.petAccessory,
      { clawd: "wizard-hat", cloudling: "halo" }
    );

    prefs.save(p, {
      ...prefs.getDefaults(),
      petAccessory: {
        clawd: "seasonal",
        "../unsafe": "halo",
        calico: "none",
      },
    });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(p, "utf8")).petAccessory, {});
    assert.deepStrictEqual(prefs.validate({ petAccessory: "wizard-hat" }).petAccessory, {});
  });

  it("round-trips per-theme mouth accessories and stores only catalog ids", () => {
    const p = makeTempPath();
    prefs.save(p, {
      ...prefs.getDefaults(),
      petMouthAccessory: { clawd: "cigarette" },
    });
    assert.deepStrictEqual(
      prefs.load(p).snapshot.petMouthAccessory,
      { clawd: "cigarette" }
    );

    prefs.save(p, {
      ...prefs.getDefaults(),
      petMouthAccessory: {
        clawd: "pipe",
        "../unsafe": "cigarette",
        calico: "none",
      },
    });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(p, "utf8")).petMouthAccessory, {});
    assert.deepStrictEqual(prefs.validate({ petMouthAccessory: "cigarette" }).petMouthAccessory, {});
  });

  it("round-trips per-theme holiday accessory opt-ins and stores only true entries", () => {
    const p = makeTempPath();
    prefs.save(p, {
      ...prefs.getDefaults(),
      holidayAccessoryEnabled: {
        clawd: true,
        cloudling: false,
        "../unsafe": true,
        calico: "true",
      },
    });
    assert.deepStrictEqual(
      prefs.load(p).snapshot.holidayAccessoryEnabled,
      { clawd: true }
    );
    assert.deepStrictEqual(
      prefs.validate({ holidayAccessoryEnabled: true }).holidayAccessoryEnabled,
      {}
    );
  });

  it("validates before writing — bad fields fall back to defaults on disk", () => {
    const p = makeTempPath();
    const dirty = {
      ...prefs.getDefaults(),
      lang: "klingon",
      x: NaN,
    };
    prefs.save(p, dirty);
    const written = JSON.parse(fs.readFileSync(p, "utf8"));
    assert.strictEqual(written.lang, "en");
    assert.strictEqual(written.x, 0);
  });

  it("round-trips themeOverrides with disabled: true", () => {
    const p = makeTempPath();
    const snap = prefs.getDefaults();
    snap.themeOverrides = {
      clawd: {
        states: {
          sweeping: { disabled: true },
        },
      },
    };
    prefs.save(p, snap);
    const { snapshot } = prefs.load(p);
    assert.deepStrictEqual(snapshot.themeOverrides.clawd.states.sweeping, { disabled: true });
  });

  it("themeOverrides: nested state entry preserves file + transition while keeping disabled", () => {
    const p = makeTempPath();
    const snap = prefs.getDefaults();
    snap.themeOverrides = {
      clawd: {
        states: {
          attention: {
            disabled: true,
            sourceThemeId: "clawd",
            file: "clawd-happy.svg",
            transition: { in: 100, out: 220 },
          },
        },
      },
    };
    prefs.save(p, snap);
    const { snapshot } = prefs.load(p);
    assert.deepStrictEqual(snapshot.themeOverrides.clawd.states.attention, {
      disabled: true,
      sourceThemeId: "clawd",
      file: "clawd-happy.svg",
      transition: { in: 100, out: 220 },
    });
  });

  it("themeOverrides: state/tier/timing entries round-trip in Path A schema", () => {
    const p = makeTempPath();
    const snap = prefs.getDefaults();
    snap.themeOverrides = {
      clawd: {
        states: {
          attention: {
            file: "clawd-happy.svg",
            transition: { in: 80, out: 140 },
          },
        },
        tiers: {
          workingTiers: {
            "clawd-working-typing.svg": {
              file: "custom-working.svg",
              transition: { in: 0, out: 90 },
            },
          },
        },
        timings: {
          autoReturn: { attention: 2800 },
        },
      },
    };
    prefs.save(p, snap);
    const { snapshot } = prefs.load(p);
    assert.deepStrictEqual(snapshot.themeOverrides.clawd, {
      states: {
        attention: {
          file: "clawd-happy.svg",
          transition: { in: 80, out: 140 },
        },
      },
      tiers: {
        workingTiers: {
          "clawd-working-typing.svg": {
            file: "custom-working.svg",
            transition: { in: 0, out: 90 },
          },
        },
      },
      timings: {
        autoReturn: { attention: 2800 },
      },
    });
  });

  it("themeOverrides.sounds: round-trips per-soundName file entries", () => {
    const p = makeTempPath();
    const snap = prefs.getDefaults();
    snap.themeOverrides = {
      clawd: {
        sounds: {
          complete: { file: "my-done.mp3" },
          confirm: { file: "nope.wav" },
        },
      },
    };
    prefs.save(p, snap);
    const { snapshot } = prefs.load(p);
    assert.deepStrictEqual(snapshot.themeOverrides.clawd.sounds, {
      complete: { file: "my-done.mp3" },
      confirm: { file: "nope.wav" },
    });
  });

  it("themeOverrides.sounds: drops entries with invalid / empty file and non-string keys", () => {
    const validated = prefs.validate({
      ...prefs.getDefaults(),
      themeOverrides: {
        clawd: {
          sounds: {
            complete: { file: "ok.mp3" },
            confirm: { file: "" },    // empty
            weird:    { durationMs: 1000 }, // no file → dropped
            "":       { file: "x.mp3" }, // empty key → dropped
          },
        },
      },
    });
    assert.deepStrictEqual(validated.themeOverrides.clawd.sounds, {
      complete: { file: "ok.mp3" },
    });
  });

  it("themeOverrides.sounds: strips ancillary fields (durationMs / transition / sourceThemeId) — sounds only keep file", () => {
    const validated = prefs.validate({
      ...prefs.getDefaults(),
      themeOverrides: {
        clawd: {
          sounds: {
            complete: { file: "ok.mp3", durationMs: 1000, transition: { in: 50 }, sourceThemeId: "x" },
          },
        },
      },
    });
    assert.deepStrictEqual(validated.themeOverrides.clawd.sounds, {
      complete: { file: "ok.mp3" },
    });
  });

  it("themeOverrides.sounds: preserves originalName when valid, basename-strips and caps length", () => {
    // originalName is display-only — stores what the user picked before the
    // copy renamed it to `${soundName}${ext}`. Sanitised to guard hand-edited
    // pref files from shoving path traversal / absurd strings into the UI.
    const longName = "a".repeat(300) + ".mp3";
    const validated = prefs.validate({
      ...prefs.getDefaults(),
      themeOverrides: {
        clawd: {
          sounds: {
            complete: { file: "complete.mp3", originalName: "cat-demo.mp3" },
            confirm:  { file: "confirm.wav", originalName: "../../etc/passwd.wav" }, // basenamed
            hiss:     { file: "hiss.mp3", originalName: ".." },                      // dropped
            purr:     { file: "purr.mp3", originalName: "" },                        // dropped
            growl:    { file: "growl.mp3", originalName: longName },                 // capped
          },
        },
      },
    });
    assert.strictEqual(validated.themeOverrides.clawd.sounds.complete.originalName, "cat-demo.mp3");
    assert.strictEqual(validated.themeOverrides.clawd.sounds.confirm.originalName, "passwd.wav");
    assert.strictEqual(validated.themeOverrides.clawd.sounds.hiss.originalName, undefined);
    assert.strictEqual(validated.themeOverrides.clawd.sounds.purr.originalName, undefined);
    assert.strictEqual(validated.themeOverrides.clawd.sounds.growl.originalName.length, 256);
  });

  it("themeOverrides.sounds: rejects path-unsafe soundName keys and basename-sanitises file", () => {
    // soundName becomes a filename stem under sound-overrides/<themeId>/ —
    // a malicious theme or hand-edited pref must not be able to escape that
    // directory. File paths with separators get basename-stripped.
    const validated = prefs.validate({
      ...prefs.getDefaults(),
      themeOverrides: {
        clawd: {
          sounds: {
            complete:      { file: "ok.mp3" },
            "../../evil":  { file: "x.mp3" },           // unsafe key → dropped
            "foo/bar":     { file: "x.mp3" },           // unsafe key → dropped
            "spaces bad":  { file: "x.mp3" },           // unsafe key → dropped
            confirm:       { file: "../../etc/passwd" },// unsafe file → basenamed
            quiet:         { file: ".." },               // bare `..` → dropped
          },
        },
      },
    });
    assert.deepStrictEqual(validated.themeOverrides.clawd.sounds, {
      complete: { file: "ok.mp3" },
      confirm:  { file: "passwd" },
    });
  });

  it("themeOverrides: legacy flat state entries normalize into states map", () => {
    const validated = prefs.validate({
      ...prefs.getDefaults(),
      themeOverrides: {
        clawd: {
          attention: { disabled: true },
        },
      },
    });
    assert.deepStrictEqual(validated.themeOverrides, {
      clawd: {
        states: {
          attention: { disabled: true },
        },
      },
    });
  });

  it("themeOverrides: reactions round-trip with file + durationMs + transition", () => {
    const p = makeTempPath();
    const snap = prefs.getDefaults();
    snap.themeOverrides = {
      clawd: {
        reactions: {
          clickLeft: {
            file: "my-poke.svg",
            durationMs: 2200,
            transition: { in: 50, out: 100 },
          },
          double: { file: "my-double.svg", durationMs: 4000 },
        },
      },
    };
    prefs.save(p, snap);
    const { snapshot } = prefs.load(p);
    assert.deepStrictEqual(snapshot.themeOverrides.clawd.reactions, {
      clickLeft: {
        file: "my-poke.svg",
        durationMs: 2200,
        transition: { in: 50, out: 100 },
      },
      double: { file: "my-double.svg", durationMs: 4000 },
    });
  });

  it("themeOverrides: hitbox.wide round-trips boolean per-file flags", () => {
    const p = makeTempPath();
    const snap = prefs.getDefaults();
    snap.themeOverrides = {
      clawd: {
        hitbox: {
          wide: {
            "clawd-error.svg": true,
            "clawd-idle.svg": false,
          },
        },
      },
    };
    prefs.save(p, snap);
    const { snapshot } = prefs.load(p);
    assert.deepStrictEqual(snapshot.themeOverrides.clawd.hitbox, {
      wide: {
        "clawd-error.svg": true,
        "clawd-idle.svg": false,
      },
    });
  });

  it("themeOverrides: hitbox normalize drops non-boolean values", () => {
    const validated = prefs.validate({
      ...prefs.getDefaults(),
      themeOverrides: {
        clawd: {
          hitbox: {
            wide: {
              "ok.svg": true,
              "bad.svg": "yes",   // dropped
              "null-val.svg": null,  // dropped
            },
          },
        },
      },
    });
    assert.deepStrictEqual(validated.themeOverrides.clawd.hitbox, {
      wide: { "ok.svg": true },
    });
  });

  it("themeOverrides: normalize drops unknown reaction keys and strips durationMs from drag", () => {
    const validated = prefs.validate({
      ...prefs.getDefaults(),
      themeOverrides: {
        clawd: {
          reactions: {
            explode: { file: "bogus.svg" },           // invalid key
            drag: { file: "my-drag.svg", durationMs: 9999 },  // drag can't have duration
            clickLeft: { file: "p.svg" },             // valid
          },
        },
      },
    });
    assert.deepStrictEqual(validated.themeOverrides.clawd.reactions, {
      drag: { file: "my-drag.svg" },     // durationMs stripped
      clickLeft: { file: "p.svg" },
      // explode: absent
    });
  });
});

describe("prefs.tutorialSeen (first-run tutorial gate)", () => {
  it("defaults to false on fresh defaults", () => {
    assert.strictEqual(prefs.getDefaults().tutorialSeen, false);
  });

  it("persists true across a save/load round-trip", () => {
    const p = makeTempPath();
    prefs.save(p, { ...prefs.getDefaults(), tutorialSeen: true });
    assert.strictEqual(prefs.load(p).snapshot.tutorialSeen, true);
  });

  it("resolves to false for an existing-user file lacking the key (they see it once too)", () => {
    const p = makeTempPath();
    // Pre-tutorial prefs file: current version, no tutorialSeen key at all.
    fs.writeFileSync(p, JSON.stringify({ version: prefs.CURRENT_VERSION, showTray: true }));
    assert.strictEqual(prefs.load(p).snapshot.tutorialSeen, false);
  });

  it("is NOT backfilled to true by migrate (unlike showDock)", () => {
    const migrated = prefs.migrate({ version: 1 });
    assert.notStrictEqual(migrated.tutorialSeen, true);
    // migrate never adds it; validate fills the false default so the user is unseen.
    assert.strictEqual(prefs.validate(migrated).tutorialSeen, false);
  });
});

describe("prefs.load fresh flag (brand-new install detection)", () => {
  it("flags fresh: true when there is no prefs file", () => {
    const p = makeTempPath();          // temp dir exists, prefs file does not
    assert.strictEqual(prefs.load(p).fresh, true);
  });

  it("does NOT flag fresh once a file exists", () => {
    const p = makeTempPath();
    prefs.save(p, prefs.getDefaults());
    assert.notStrictEqual(prefs.load(p).fresh, true);
  });

  it("does NOT flag fresh for a corrupt file (returning user — keep their language)", () => {
    const p = makeTempPath();
    fs.writeFileSync(p, "{ this is not valid json ");
    assert.notStrictEqual(prefs.load(p).fresh, true);
  });
});

describe("prefs.mapLocaleToLang (device locale → UI language)", () => {
  const cases = [
    ["en-US", "en"], ["en", "en"],
    ["zh-CN", "zh"], ["zh-Hans", "zh"], ["zh", "zh"],
    ["zh-TW", "zh-TW"], ["zh-Hant", "zh-TW"], ["zh-HK", "zh-TW"], ["zh-Hant-TW", "zh-TW"],
    ["ko-KR", "ko"], ["ko", "ko"],
    ["ja-JP", "ja"], ["ja", "ja"],
    ["pt-BR", "pt-BR"], ["pt_BR", "pt-BR"],
    // Only the shipped regional variant is auto-selected.
    ["pt", "en"], ["pt-PT", "en"], ["pt-AO", "en"],
    ["es-MX", "es"], ["es-ES", "es"], ["es", "es"],
    ["fr-FR", "en"], ["de", "en"],
  ];
  for (const [input, expected] of cases) {
    it(`maps ${input} -> ${expected}`, () => {
      assert.strictEqual(prefs.mapLocaleToLang(input), expected);
    });
  }

  it("falls back to en for empty / non-string input", () => {
    assert.strictEqual(prefs.mapLocaleToLang(""), "en");
    assert.strictEqual(prefs.mapLocaleToLang(undefined), "en");
    assert.strictEqual(prefs.mapLocaleToLang(null), "en");
    assert.strictEqual(prefs.mapLocaleToLang(123), "en");
  });

  it("only ever returns a value inside the lang enum", () => {
    const enumVals = new Set(["en", "zh", "zh-TW", "ko", "ja", "pt-BR", "es"]);
    for (const probe of ["xx", "ZH-tw", "JA", "en-GB", "pt-BR", "PT-br", "es-MX", ""]) {
      assert.ok(enumVals.has(prefs.mapLocaleToLang(probe)), `${probe} mapped outside enum`);
    }
  });
});

describe("idle behavior file normalization", () => {
  it("preserves roam when both behaviors are enabled", () => {
    const snapshot = prefs.validate({ freeRoam: true, idleActivities: true });
    assert.strictEqual(snapshot.freeRoam, true);
    assert.strictEqual(snapshot.idleActivities, false);
  });

  it("preserves all three valid behavior pairs", () => {
    for (const [freeRoam, idleActivities] of [[false, false], [true, false], [false, true]]) {
      const snapshot = prefs.validate({ freeRoam, idleActivities });
      assert.strictEqual(snapshot.freeRoam, freeRoam);
      assert.strictEqual(snapshot.idleActivities, idleActivities);
    }
  });

  it("defaults idle activities off for older files with only roam", () => {
    const file = makeTempPath();
    fs.writeFileSync(file, JSON.stringify({ version: prefs.CURRENT_VERSION, freeRoam: true }));
    const snapshot = prefs.load(file).snapshot;
    assert.strictEqual(snapshot.freeRoam, true);
    assert.strictEqual(snapshot.idleActivities, prefs.getDefaults().idleActivities);
    assert.strictEqual(snapshot.idleActivities, false);
  });
});
