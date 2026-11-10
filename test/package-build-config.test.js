const assert = require("node:assert");
const { describe, it } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { minimatch } = require("minimatch");
const yaml = require("js-yaml");

const pkg = require("../package.json");
const ROOT = path.join(__dirname, "..");

function matchedByAnyGlob(globs, target) {
  return globs.some((g) => minimatch(target, g));
}

function loadWorkflow(name) {
  return yaml.load(fs.readFileSync(
    path.join(ROOT, ".github", "workflows", name),
    "utf8",
  ));
}

describe("package build config", () => {
  describe("full-suite CI", () => {
    it("runs npm test with a display on pull requests and main pushes", () => {
      const workflow = loadWorkflow("test.yml");
      assert.strictEqual(workflow.name, "Test");
      assert.deepStrictEqual(Object.keys(workflow.on).sort(), [
        "pull_request",
        "push",
        "workflow_dispatch",
      ]);
      assert.deepStrictEqual(workflow.on.push.branches, ["main"]);
      assert.deepStrictEqual(workflow.permissions, { contents: "read" });
      assert.strictEqual(workflow.concurrency["cancel-in-progress"], true);
      assert.match(workflow.concurrency.group, /github\.ref/);

      const job = workflow.jobs.test;
      assert.ok(job, "Test workflow should contain the test job");
      assert.strictEqual(job["runs-on"], "ubuntu-latest");
      const setupNode = job.steps.find((step) => step.uses === "actions/setup-node@v4");
      assert.deepStrictEqual(setupNode.with, { "node-version-file": ".nvmrc" });
      assert.deepStrictEqual(
        job.steps.filter((step) => step.run).map((step) => step.run),
        ["npm ci", "xvfb-run -a npm test"],
      );
    });

  });

  describe("repository asset audit", () => {
    it("exposes a Windows-compatible npm audit command", () => {
      assert.strictEqual(
        pkg.scripts["audit:assets"],
        "node scripts/audit-repository-assets.js"
      );
    });

    it("does not match retained source artwork with package globs", () => {
      assert.strictEqual(
        matchedByAnyGlob(pkg.build.files, "assets/source/dock-icon-fullbleed.png"),
        false,
        "assets/source/** must stay outside build.files"
      );
    });

  });

  it("ships project window icons in packaged builds", () => {
    assert.ok(
      pkg.build.files.includes("assets/icons/**/*"),
      "build.files should include assets/icons/**/*"
    );
  });

  it("ships agent session icons in packaged builds", () => {
    assert.ok(
      pkg.build.files.includes("assets/icons/agents/**/*"),
      "build.files should include assets/icons/agents/**/*"
    );
  });

  it("ships third-party notices in packaged builds", () => {
    assert.ok(
      pkg.build.files.includes("NOTICE.md"),
      "build.files should include NOTICE.md"
    );
  });

  it("unpacks built-in theme assets so the folder can be opened from settings", () => {
    assert.ok(
      pkg.build.asarUnpack.includes("assets/svg/**/*"),
      "asarUnpack should include assets/svg/**/*"
    );
    assert.ok(
      pkg.build.files.includes("assets/accessories/**/*"),
      "build.files should include assets/accessories/**/*"
    );
    assert.ok(
      pkg.build.asarUnpack.includes("assets/accessories/**/*"),
      "asarUnpack should include assets/accessories/**/*"
    );
    assert.ok(
      pkg.build.asarUnpack.includes("themes/**/*"),
      "asarUnpack should include themes/**/*"
    );
  });

  describe("target-native Koffi packaging", () => {
    it("pins the reviewed Koffi line and prunes only through the afterPack hook", () => {
      assert.strictEqual(pkg.dependencies.koffi, "2.16.3");
      assert.strictEqual(pkg.build.afterPack, "scripts/after-pack-koffi.js");
      assert.strictEqual(pkg.scripts["audit:native-package"], "node scripts/audit-packaged-native.js");
    });

  });

  describe("Linux artifact targets", () => {
    it("uses Linux artifact names without spaces so latest-linux.yml URLs match uploaded assets", () => {
      const artifactName = pkg.build.linux && pkg.build.linux.artifactName;
      assert.strictEqual(
        typeof artifactName,
        "string",
        "build.linux.artifactName should be a string"
      );
      assert.match(
        artifactName,
        /\$\{arch\}/,
        "Linux artifactName should include ${arch} so architecture-specific assets stay explicit"
      );
      assert.doesNotMatch(
        artifactName,
        /\s/,
        "Linux artifactName should not contain spaces so latest-linux.yml URLs match uploaded assets"
      );
    });
  });

  // Windows shell consumers need a physical icon resource outside app.asar.
  // extraResources provides that canonical runtime copy; the packaged EXE
  // embeds the same build.win.icon and is the fallback if the copy is missing.
  describe("Windows shell icon fallback chain", () => {

    it("does not duplicate the shell icon inside app.asar", () => {
      assert.strictEqual(
        matchedByAnyGlob(pkg.build.files, "assets/icon.ico"),
        false,
        "assets/icon.ico should be packaged only once via extraResources"
      );
    });
  });

  describe("Telegram legacy retirement packaging", () => {
    it("starts directly without fetching a retired executable", () => {
      assert.strictEqual(pkg.scripts.start, "node launch.js");
    });

    it("contains no retired scripts, prebuild hooks, or extraResources", () => {
      for (const key of [
        "fetch:sidecars",
        "verify:sidecars",
        "assert:packaged-sidecar",
        "prebuild",
        "prebuild:win:x64",
        "prebuild:win:arm64",
        "prebuild:win:all",
        "prebuild:mac",
        "prebuild:linux",
        "prebuild:all",
      ]) {
        assert.equal(pkg.scripts[key], undefined, key);
      }
      assert.equal(pkg.build.linux.extraResources, undefined);
      assert.equal(pkg.build.extraResources, undefined);
    });

    it("declares the asar inspector directly and keeps the Linux build commands", () => {
      assert.match(pkg.devDependencies["@electron/asar"], /^\^3\./);
      assert.strictEqual(pkg.scripts.build, "electron-builder --linux");
      assert.strictEqual(pkg.scripts["build:linux:x64"], "electron-builder --linux AppImage:x64 deb:x64");
    });

  });
});

