"use strict";

// Keeps the OMP extension in ~/.omp/agent/extensions/omp-pet in sync with the
// copy shipped in this build. Startup sync runs only when the integration is
// installed and enabled; Settings Install/Uninstall and Doctor Repair call the
// same entry points explicitly.

const OMP_AGENT_ID = "omp";

function asSkipped(result, reason, message) {
  const base = result && typeof result === "object" ? result : {};
  return {
    status: "skipped",
    ...base,
    reason: base.reason || reason,
    message: base.message || message,
  };
}

function normalizeRegisterResult(result) {
  if (!result || typeof result !== "object") return { status: "ok" };
  if (typeof result.status === "string") return result;
  if (result.installed === false) {
    const reason = result.reason || "omp-not-found";
    const message = reason === "omp-not-found"
      ? "OMP is not installed; skipped integration sync"
      : `OMP integration sync skipped: ${reason}`;
    return asSkipped(result, reason, message);
  }
  return { status: "ok", ...result };
}

function createIntegrationSyncRuntime(options = {}) {
  const ctx = options.ctx || {};
  const shouldSyncAgentIntegration = typeof options.shouldSyncAgentIntegration === "function"
    ? options.shouldSyncAgentIntegration
    : (() => true);
  const log = typeof options.log === "function" ? options.log : console.log;
  const warn = typeof options.warn === "function" ? options.warn : console.warn;

  function syncOmpExtension() {
    try {
      if (typeof ctx.syncOmpExtensionImpl === "function") return ctx.syncOmpExtensionImpl();
      const { registerOmpExtension } = require("../hooks/omp-install.js");
      const result = registerOmpExtension({ silent: true });
      if (result && result.installed && result.updated) log("omp-pet: synced OMP extension");
      return normalizeRegisterResult(result);
    } catch (err) {
      warn("omp-pet: failed to sync OMP extension:", err && err.message);
      return { status: "error", message: err && err.message ? err.message : "Failed to sync OMP extension" };
    }
  }

  function uninstallOmpExtension() {
    try {
      if (typeof ctx.uninstallOmpExtensionImpl === "function") return ctx.uninstallOmpExtensionImpl();
      const { unregisterOmpExtension } = require("../hooks/omp-install.js");
      return unregisterOmpExtension({ silent: true });
    } catch (err) {
      warn("omp-pet: failed to uninstall OMP extension:", err && err.message);
      return { status: "error", message: err && err.message ? err.message : "Failed to uninstall OMP extension" };
    }
  }

  function syncIntegrationForAgent(agentId) {
    if (agentId !== OMP_AGENT_ID) return false;
    return syncOmpExtension();
  }

  function repairIntegrationForAgent(agentId) {
    return syncIntegrationForAgent(agentId);
  }

  function uninstallIntegrationForAgent(agentId) {
    if (agentId !== OMP_AGENT_ID) return false;
    return uninstallOmpExtension();
  }

  function syncEnabledStartupIntegrations() {
    if (shouldSyncAgentIntegration(OMP_AGENT_ID)) syncOmpExtension();
  }

  return {
    syncOmpExtension,
    syncIntegrationForAgent,
    repairIntegrationForAgent,
    uninstallIntegrationForAgent,
    syncEnabledStartupIntegrations,
  };
}

module.exports = {
  createIntegrationSyncRuntime,
};
