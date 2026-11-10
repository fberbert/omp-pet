"use strict";

const { getAllAgents } = require("../agents/registry");

// OMP is the only agent. A POST without agent_id (test-demo.sh and other manual
// pokes) is attributed to it; any other explicit id is rejected so foreign
// hooks that happen to find this port cannot create sessions.
const DEFAULT_HOOK_AGENT_ID = "omp";
const MAX_REJECTED_AGENT_ID_LENGTH = 80;

const KNOWN_HOOK_AGENT_IDS = new Set(getAllAgents().map((agent) => agent.id));

const HOOK_SOURCE_AGENT_IDS = new Map([
  ["omp-extension", "omp"],
]);

function normalizeHookText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function resolveHookAgentId(data) {
  const explicit = normalizeHookText(data && data.agent_id);
  if (explicit && KNOWN_HOOK_AGENT_IDS.has(explicit)) {
    return { agentId: explicit, source: "explicit", defaulted: false };
  }
  const sourceAgentId = HOOK_SOURCE_AGENT_IDS.get(normalizeHookText(data && data.hook_source));
  if (sourceAgentId) {
    return { agentId: sourceAgentId, source: "hook-source", defaulted: false };
  }
  if (explicit) {
    return {
      agentId: null,
      source: "rejected",
      rejected: true,
      rawAgentId: explicit.slice(0, MAX_REJECTED_AGENT_ID_LENGTH),
    };
  }
  return { agentId: DEFAULT_HOOK_AGENT_ID, source: "default", defaulted: true };
}

module.exports = {
  DEFAULT_HOOK_AGENT_ID,
  HOOK_SOURCE_AGENT_IDS,
  KNOWN_HOOK_AGENT_IDS,
  MAX_REJECTED_AGENT_ID_LENGTH,
  resolveHookAgentId,
};
