"use strict";

const { getAgent } = require("../../agents/registry");
const omp = require("../../hooks/omp-install");

function agentName(agentId) {
  const agent = getAgent(agentId);
  return agent && agent.name ? agent.name : agentId;
}

// OMP's extension directory moves with PI_CONFIG_DIR / PI_CODING_AGENT_DIR /
// OMP_PROFILE, so every copy re-resolves it: install, the installation
// detector and Doctor must all judge the directory OMP would actually load.
function buildOmpDescriptor() {
  return {
    agentId: "omp",
    agentName: agentName("omp"),
    eventSource: "extension",
    parentDir: omp.resolveOmpAgentDir(),
    configPath: omp.resolveExtensionDir(),
    configMode: "omp-extension",
    autoInstall: true,
    marker: omp.EXTENSION_FILE,
    coreFile: omp.CORE_FILE,
    markerFile: omp.MARKER_FILE,
  };
}

function getAgentDescriptors() {
  return [buildOmpDescriptor()];
}

function getAgentDescriptor(agentId) {
  return agentId === "omp" ? buildOmpDescriptor() : null;
}

module.exports = {
  getAgentDescriptors,
  getAgentDescriptor,
};
