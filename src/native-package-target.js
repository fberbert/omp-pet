"use strict";

const RELEASE_TARGETS = Object.freeze([
  Object.freeze({
    id: "linux-x64",
    runtimePlatform: "linux",
    runtimeArch: "x64",
    koffiTriplet: "linux_x64",
    format: "ELF",
    architecture: "x86_64",
    artifactArchAliases: Object.freeze(["x86_64", "amd64"]),
  }),
]);

const TARGET_BY_ID = new Map(RELEASE_TARGETS.map((target) => [target.id, target]));

const BUILDER_ARCH_BY_NUMBER = Object.freeze({
  0: "ia32",
  1: "x64",
  2: "armv7l",
  3: "arm64",
  4: "universal",
});

function normalizePlatform(value) {
  return String(value == null ? "" : value).trim().toLowerCase();
}

function normalizeBuilderArch(value) {
  if (typeof value === "number" && Number.isInteger(value)) {
    return BUILDER_ARCH_BY_NUMBER[value] || "";
  }
  const arch = String(value == null ? "" : value).trim().toLowerCase();
  if (/^\d+$/.test(arch)) return BUILDER_ARCH_BY_NUMBER[Number(arch)] || "";
  if (arch === "amd64" || arch === "x86_64") return "x64";
  if (arch === "aarch64") return "arm64";
  return arch;
}

function getReleaseTarget(targetId) {
  const target = TARGET_BY_ID.get(String(targetId || ""));
  if (!target) throw new Error(`Unknown release target: ${targetId || "<empty>"}`);
  return target;
}

function resolveReleaseTarget(platformValue, archValue) {
  const runtimePlatform = normalizePlatform(platformValue);
  const runtimeArch = normalizeBuilderArch(archValue);
  const target = RELEASE_TARGETS.find((candidate) => (
    candidate.runtimePlatform === runtimePlatform && candidate.runtimeArch === runtimeArch
  ));
  if (!target) {
    throw new Error(
      `Unsupported package target: platform=${platformValue == null ? "<empty>" : platformValue} ` +
      `arch=${archValue == null ? "<empty>" : archValue}`
    );
  }
  return target;
}

function resolveRuntimeTarget(platformValue = process.platform, archValue = process.arch) {
  return resolveReleaseTarget(platformValue, archValue);
}

module.exports = {
  RELEASE_TARGETS,
  BUILDER_ARCH_BY_NUMBER,
  normalizePlatform,
  normalizeBuilderArch,
  getReleaseTarget,
  resolveReleaseTarget,
  resolveRuntimeTarget,
};
