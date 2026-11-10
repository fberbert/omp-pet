"use strict";

// Pure gate helpers over a prefs snapshot. Gates default true for a missing
// snapshot / entry / flag so an un-normalized snapshot still runs.

function readFlag(snapshot, agentId, flag, defaultValue = true) {
  if (!agentId) return defaultValue;
  if (!snapshot || typeof snapshot !== "object") return defaultValue;
  const agents = snapshot.agents;
  if (!agents || typeof agents !== "object") return defaultValue;
  const entry = agents[agentId];
  if (!entry || typeof entry !== "object") return defaultValue;
  if (typeof entry[flag] !== "boolean") return defaultValue;
  return entry[flag];
}

const isAgentEnabled = (snapshot, agentId) => readFlag(snapshot, agentId, "enabled");
const isAgentIntegrationInstalled = (snapshot, agentId) => (
  readFlag(snapshot, agentId, "integrationInstalled", true)
);
const shouldSyncAgentIntegration = (snapshot, agentId) => (
  isAgentEnabled(snapshot, agentId) && isAgentIntegrationInstalled(snapshot, agentId)
);

// Runtime reader over the live Settings controller snapshot. The pure helpers
// above deliberately fail open for missing fields; that is correct only when
// the snapshot came from readable prefs. An unreadable prefs file instead
// supplies an in-memory defaults fallback, so every prefs-backed runtime gate
// must fail closed until restart rather than treating those defaults as user
// intent.
function createRuntimeAgentGate({ getSnapshot, isAuthoritative = () => true } = {}) {
  if (typeof getSnapshot !== "function") {
    throw new TypeError("createRuntimeAgentGate requires getSnapshot");
  }

  function canUseSnapshot() {
    try {
      return isAuthoritative() !== false;
    } catch {
      return false;
    }
  }

  function withSnapshot(read) {
    if (!canUseSnapshot()) return false;
    try {
      return read(getSnapshot());
    } catch {
      return false;
    }
  }

  return Object.freeze({
    isAuthoritative: canUseSnapshot,
    isAgentEnabled(agentId) {
      return withSnapshot((current) => isAgentEnabled(current, agentId));
    },
    isAgentIntegrationInstalled(agentId) {
      return withSnapshot((current) => isAgentIntegrationInstalled(current, agentId));
    },
    shouldSyncAgentIntegration(agentId) {
      return withSnapshot((current) => shouldSyncAgentIntegration(current, agentId));
    },
  });
}

module.exports = {
  createRuntimeAgentGate,
  isAgentIntegrationInstalled,
  isAgentEnabled,
  shouldSyncAgentIntegration,
};
