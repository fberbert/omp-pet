"use strict";

// Main-process glue between the HTTP server, the state machine and the OMP
// integration. Keeps main.js free of server/state wiring and gives Settings a
// single place to clear sessions or (re)sync the integration.

function createAgentRuntimeMain(options = {}) {
  const getServer = options.getServer || (() => null);
  const getStateRuntime = options.getStateRuntime || (() => null);
  const isAgentEnabled = options.isAgentEnabled || (() => true);
  const updateSession = options.updateSession || (() => {});

  function updateSessionFromServer(sessionId, state, event, opts = {}) {
    if (opts && opts.agentId && !isAgentEnabled(opts.agentId)) return false;
    return updateSession(sessionId, state, event, opts);
  }

  function updateSessionMetadataFromServer(sessionId, opts = {}) {
    const state = getStateRuntime();
    return !!(state && typeof state.updateSessionMetadata === "function"
      && state.updateSessionMetadata(sessionId, opts));
  }

  function callServer(method, ...args) {
    const server = getServer();
    return server && typeof server[method] === "function" ? server[method](...args) : false;
  }

  function syncIntegrationForAgent(agentId, optionsArg) {
    return callServer("syncIntegrationForAgent", agentId, optionsArg);
  }

  function repairIntegrationForAgent(agentId, optionsArg) {
    return callServer("repairIntegrationForAgent", agentId, optionsArg);
  }

  function uninstallIntegrationForAgent(agentId) {
    return callServer("uninstallIntegrationForAgent", agentId);
  }

  function clearSessionsByAgent(agentId) {
    const state = getStateRuntime();
    return state && typeof state.clearSessionsByAgent === "function"
      ? state.clearSessionsByAgent(agentId)
      : 0;
  }

  return {
    syncIntegrationForAgent,
    repairIntegrationForAgent,
    uninstallIntegrationForAgent,
    clearSessionsByAgent,
    updateSessionFromServer,
    updateSessionMetadataFromServer,
    cleanup() {},
  };
}

module.exports = createAgentRuntimeMain;
