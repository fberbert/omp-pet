"use strict";

// Read-only detection of whether OMP is installed locally and whether the
// omp-pet extension is present in the directory OMP loads extensions from.
// Settings → Agents uses it to show install hints; it never writes anything.

const fs = require("fs");
const path = require("path");
const { getAgentDescriptors } = require("./doctor-detectors/agent-descriptors");

function dirExists(fsImpl, dirPath) {
  try {
    return !!dirPath && fsImpl.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function fileExists(fsImpl, filePath) {
  try {
    return !!filePath && fsImpl.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function checkedAtValue(now) {
  const value = typeof now === "function" ? now() : Date.now();
  return Number.isFinite(value) ? value : Date.now();
}

function resolveAgentPaths(descriptor) {
  return { parentDir: descriptor.parentDir, configPath: descriptor.configPath };
}

function detectInstallation(descriptor, paths, fsImpl) {
  if (dirExists(fsImpl, paths.parentDir)) {
    return {
      detectedInstalled: true,
      confidence: "high",
      reason: "parent-dir",
      detail: `${paths.parentDir} exists`,
    };
  }
  return {
    detectedInstalled: false,
    confidence: "high",
    reason: "not-found",
    detail: "No local installation signal found",
  };
}

function detectExtension(descriptor, paths, fsImpl) {
  const markerPath = path.join(paths.configPath, descriptor.markerFile);
  return fileExists(fsImpl, markerPath)
    ? { detected: true, reason: "marker-file", detail: `${markerPath} exists`, paths: { markerPath } }
    : { detected: false, reason: "not-found", detail: "No omp-pet managed OMP extension marker found" };
}

function detectAgentInstallation(descriptor, options = {}) {
  const fsImpl = options.fs || fs;
  const paths = resolveAgentPaths(descriptor);
  const installation = detectInstallation(descriptor, paths, fsImpl);
  return {
    agentId: descriptor.agentId,
    agentName: descriptor.agentName,
    detectedInstalled: installation.detectedInstalled,
    confidence: installation.confidence,
    reason: installation.reason,
    detail: installation.detail,
    paths,
    clawdIntegration: detectExtension(descriptor, paths, fsImpl),
  };
}

function detectAgentInstallations(options = {}) {
  const descriptors = Array.isArray(options.descriptors) ? options.descriptors : getAgentDescriptors();
  const agents = [];
  for (const descriptor of descriptors) {
    if (!descriptor || typeof descriptor.agentId !== "string") continue;
    agents.push(detectAgentInstallation(descriptor, options));
  }
  return {
    checkedAt: checkedAtValue(options.now),
    agents,
  };
}

module.exports = {
  detectAgentInstallation,
  detectAgentInstallations,
  resolveAgentPaths,
};
