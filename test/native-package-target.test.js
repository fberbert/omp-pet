"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  RELEASE_TARGETS,
  normalizePlatform,
  normalizeBuilderArch,
  getReleaseTarget,
  resolveReleaseTarget,
} = require("../src/native-package-target");

test("native package target map covers the Linux release target exactly", () => {
  assert.deepEqual(RELEASE_TARGETS.map((target) => target.id), ["linux-x64"]);
  assert.equal(getReleaseTarget("linux-x64").koffiTriplet, "linux_x64");
  assert.equal(getReleaseTarget("linux-x64").artifactArchAliases.includes("amd64"), true);
});

test("electron-builder numeric and textual architecture values normalize once", () => {
  assert.equal(normalizeBuilderArch(1), "x64");
  assert.equal(normalizeBuilderArch(3), "arm64");
  assert.equal(normalizeBuilderArch("1"), "x64");
  assert.equal(normalizeBuilderArch("amd64"), "x64");
  assert.equal(normalizeBuilderArch("aarch64"), "arm64");
  assert.equal(normalizePlatform(" Linux "), "linux");
});

test("target resolution rejects unsupported platform and architecture tuples", () => {
  assert.equal(resolveReleaseTarget("linux", "amd64").id, "linux-x64");
  assert.equal(resolveReleaseTarget("linux", 1).id, "linux-x64");
  assert.throws(() => resolveReleaseTarget("linux", "arm64"), /Unsupported package target/);
  assert.throws(() => resolveReleaseTarget("win32", 1), /Unsupported package target/);
  assert.throws(() => resolveReleaseTarget("darwin", "x64"), /Unsupported package target/);
  assert.throws(() => getReleaseTarget("windows-x64"), /Unknown release target/);
});
