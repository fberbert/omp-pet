"use strict";

const fs = require("fs");
const path = require("path");

const {
  isAgentEnabled,
  isAgentIntegrationInstalled,
} = require("../agent-gate");
const { listOtherOmpProfileAgentDirs } = require("../../hooks/omp-install");
const { getAgentDescriptors } = require("./agent-descriptors");

// Statuses Doctor offers a Fix (re-run the installer) for.
const REPAIRABLE_AGENT_STATUSES = new Set([
  "not-connected",
  "broken-path",
]);

function dirExists(fsImpl, dirPath) {
  try {
    return fsImpl.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function fileExists(fsImpl, filePath) {
  try {
    return fsImpl.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function readJsonIfPresent(fsImpl, filePath) {
  try {
    return JSON.parse(fsImpl.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function makeDetail(descriptor, status, fields = {}) {
  return {
    agentId: descriptor.agentId,
    agentName: descriptor.agentName,
    eventSource: descriptor.eventSource,
    status,
    ...fields,
  };
}

function statusLevel(status) {
  if (
    status === "not-connected"
    || status === "broken-path"
    || status === "needs-review"
  ) {
    return "warning";
  }
  return status === "ok" ? null : "info";
}

function withAgentFixAction(detail, descriptor) {
  if (!descriptor.autoInstall || !REPAIRABLE_AGENT_STATUSES.has(detail.status)) return detail;
  return { ...detail, fixAction: { type: "agent-integration", agentId: descriptor.agentId } };
}

function isExtensionManagedMarker(value) {
  return !!(
    value
    && value.app === "omp-pet"
    && value.integration === "omp"
    && value.managed === true
  );
}

// The extension is a managed directory holding the entry file, the core it
// imports next to it, and an ownership marker.
function checkExtensionMode(descriptor, options) {
  const extensionDir = descriptor.configPath;
  const markerPath = path.join(extensionDir, descriptor.markerFile);
  const extensionPath = path.join(extensionDir, descriptor.marker);
  const corePath = path.join(extensionDir, descriptor.coreFile);
  const base = {
    parentDirExists: true,
    configPath: extensionDir,
    extensionDir,
  };

  if (!dirExists(options.fs, extensionDir)) {
    return makeDetail(descriptor, "not-connected", {
      ...base,
      level: "warning",
      configFileExists: false,
      detail: `${extensionDir} missing`,
    });
  }

  if (!isExtensionManagedMarker(readJsonIfPresent(options.fs, markerPath))) {
    return makeDetail(descriptor, "needs-review", {
      ...base,
      level: "warning",
      configFileExists: true,
      markerPath,
      detail: `${extensionDir} exists but is not managed by omp-pet`,
    });
  }

  const extensionFileExists = fileExists(options.fs, extensionPath);
  const coreFileExists = fileExists(options.fs, corePath);
  const files = { markerPath, extensionPath, corePath, extensionFileExists, coreFileExists };
  if (!extensionFileExists || !coreFileExists) {
    return makeDetail(descriptor, "broken-path", {
      ...base,
      ...files,
      level: "warning",
      configFileExists: true,
      detail: `${descriptor.agentName} extension files are missing or incomplete`,
    });
  }

  return makeDetail(descriptor, "ok", {
    ...base,
    ...files,
    level: null,
    configFileExists: true,
    detail: `${extensionDir} extension verified`,
  });
}

// omp-pet installs into the ONE OMP agent directory it resolves for its own
// environment. A machine that also runs OMP under another profile (including
// the default profile) therefore has sessions that load nothing from it - the
// extension directory is per-profile. The note names the unmanaged profiles
// (setting OMP_PROFILE for omp-pet is the fix). Never masks a finding.
function withOmpProfileNotice(detail, options) {
  if (detail.status !== "ok") return detail;
  const unmanaged = listOtherOmpProfileAgentDirs({
    env: options.env,
    homeDir: options.homeDir,
    fs: options.fs,
  });
  if (!unmanaged.length) return detail;
  const names = unmanaged.map((entry) => entry.profile).join(", ");
  return {
    ...detail,
    detail: `${detail.detail}; ${unmanaged.length} other OMP profile(s) are not managed here (${names}) - omp-pet resolves one OMP agent directory per environment`,
    unmanagedOmpProfiles: unmanaged.map((entry) => entry.profile),
  };
}

function checkAgent(descriptor, options) {
  const prefs = options.prefs || {};
  if (!isAgentIntegrationInstalled(prefs, descriptor.agentId)) {
    return makeDetail(descriptor, "not-managed", {
      level: "info",
      detail: "This integration is not installed in Settings",
    });
  }

  if (!isAgentEnabled(prefs, descriptor.agentId)) {
    return makeDetail(descriptor, "disabled", {
      level: "info",
      detail: "You disabled this agent in Settings",
    });
  }

  if (!descriptor.parentDir || !dirExists(options.fs, descriptor.parentDir)) {
    return makeDetail(descriptor, "not-installed", {
      level: "info",
      parentDirExists: false,
      configPath: descriptor.configPath,
      detail: `${descriptor.parentDir} missing`,
    });
  }

  const detail = withOmpProfileNotice(checkExtensionMode(descriptor, options), options);
  return withAgentFixAction(detail, descriptor);
}

function summarize(details) {
  const counts = {};
  for (const detail of details) {
    counts[detail.status] = (counts[detail.status] || 0) + 1;
  }
  const warningCount = details.filter((detail) => statusLevel(detail.status) === "warning").length;
  const okCount = counts.ok || 0;
  // An all-info aggregate (integration disabled / not installed) is a
  // deliberate user or environment choice, not a fault, so the summary stays
  // green; a broken local server is flagged by the separate local-server check.
  const status = warningCount > 0 ? "warning" : "pass";
  return { status, level: warningCount > 0 ? "warning" : null, counts, okCount, warningCount };
}

function checkAgentIntegrations(options = {}) {
  const detectorOptions = {
    fs: options.fs || fs,
    env: options.env || process.env,
    prefs: options.prefs || {},
    homeDir: options.homeDir,
  };
  const descriptors = options.descriptors || getAgentDescriptors();
  const details = descriptors.map((descriptor) => checkAgent(descriptor, detectorOptions));
  return {
    id: "agent-integrations",
    ...summarize(details),
    details,
  };
}

module.exports = {
  checkAgentIntegrations,
  checkAgent,
  summarize,
  __test: {
    checkExtensionMode,
  },
};
