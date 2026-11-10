"use strict";

const { AGENT_FLAGS } = require("./prefs");
const {
  isAgentEnabled,
  isAgentIntegrationInstalled,
} = require("./agent-gate");
const {
  requireBoolean,
  requireString,
} = require("./settings-validators");

// Agents whose integration the pet can install, uninstall and repair itself.
const INSTALLABLE_AGENT_IDS = new Set(["omp"]);
const AUTO_REPAIRABLE_AGENT_IDS = INSTALLABLE_AGENT_IDS;
const SETTABLE_AGENT_FLAGS = AGENT_FLAGS.filter((flag) => flag !== "integrationInstalled");

const _validateAgentFlagId = requireString("setAgentFlag.agentId");
const _validateAgentFlagValue = requireBoolean("setAgentFlag.value");
const _validateRepairAgentId = requireString("repairAgentIntegration.agentId");
const _validateInstallAgentId = requireString("installAgentIntegration.agentId");
const _validateUninstallAgentId = requireString("uninstallAgentIntegration.agentId");
const _validateDismissInstallHintId = requireString("dismissAgentInstallHints.agentId");

function buildAgentCommit(snapshot, agentId, patch) {
  const currentAgents = (snapshot && snapshot.agents) || {};
  const currentEntry = currentAgents[agentId] && typeof currentAgents[agentId] === "object"
    ? currentAgents[agentId]
    : {};
  return {
    agents: {
      ...currentAgents,
      [agentId]: {
        ...currentEntry,
        ...patch,
      },
    },
  };
}

// setAgentFlag is an atomic single-agent, single-flag toggle.
// Payload `{ agentId, flag, value }` where flag is a settable AGENT_FLAG.
function setAgentFlag(payload, deps) {
  if (!payload || typeof payload !== "object") {
    return { status: "error", message: "setAgentFlag: payload must be an object" };
  }
  const { agentId, flag, value } = payload;
  const idCheck = _validateAgentFlagId(agentId);
  if (idCheck.status !== "ok") return idCheck;
  if (typeof flag !== "string" || !SETTABLE_AGENT_FLAGS.includes(flag)) {
    return {
      status: "error",
      message: `setAgentFlag.flag must be one of: ${SETTABLE_AGENT_FLAGS.join(", ")}`,
    };
  }
  const valueCheck = _validateAgentFlagValue(value);
  if (valueCheck.status !== "ok") return valueCheck;
  const snapshot = deps && deps.snapshot;
  const currentAgents = (snapshot && snapshot.agents) || {};
  const currentEntry = currentAgents[agentId];
  const currentValue =
    currentEntry && typeof currentEntry[flag] === "boolean" ? currentEntry[flag] : true;
  if (currentValue === value) {
    return { status: "ok", noop: true };
  }

  try {
    if (flag === "enabled") {
      if (!value) {
        if (typeof deps.clearSessionsByAgent === "function") deps.clearSessionsByAgent(agentId);
      } else if (
        isAgentIntegrationInstalled(snapshot, agentId)
        && typeof deps.syncIntegrationForAgent === "function"
      ) {
        deps.syncIntegrationForAgent(agentId);
      }
    }
  } catch (err) {
    return {
      status: "error",
      message: `setAgentFlag side effect threw: ${err && err.message}`,
    };
  }

  return { status: "ok", commit: buildAgentCommit(snapshot, agentId, { [flag]: value }) };
}

function normalizeAgentIntegrationPayload(payload, validateAgentId, actionName) {
  const agentId = typeof payload === "string" ? payload : payload && payload.agentId;
  const idCheck = validateAgentId(agentId);
  if (idCheck.status !== "ok") return idCheck;
  if (!INSTALLABLE_AGENT_IDS.has(agentId)) {
    return {
      status: "error",
      message: `No automatic integration ${actionName} is available for ${agentId}`,
    };
  }
  return {
    status: "ok",
    agentId,
    dismissInstallHint: !(payload && typeof payload === "object" && payload.dismissInstallHint === false),
  };
}

function resultMessage(result, fallback) {
  return result && typeof result === "object" && typeof result.message === "string" && result.message
    ? result.message
    : fallback;
}

function integrationResultMetadata(result) {
  if (!result || typeof result !== "object") return {};
  return typeof result.reason === "string" && result.reason ? { reason: result.reason } : {};
}

function withoutDismissedInstallHint(snapshot, agentId) {
  const current = snapshot && snapshot.dismissedAgentInstallHints;
  if (!current || typeof current !== "object" || Array.isArray(current)) return {};
  if (current[agentId] !== true) return current;
  const next = { ...current };
  delete next[agentId];
  return next;
}

function withDismissedInstallHint(snapshot, agentId) {
  const current = snapshot && snapshot.dismissedAgentInstallHints;
  return {
    ...(current && typeof current === "object" && !Array.isArray(current) ? current : {}),
    [agentId]: true,
  };
}

async function installAgentIntegration(payload, deps = {}) {
  const normalized = normalizeAgentIntegrationPayload(payload, _validateInstallAgentId, "install");
  if (normalized.status !== "ok") return normalized;
  const { agentId } = normalized;
  const snapshot = deps.snapshot || {};
  if (!deps || typeof deps.syncIntegrationForAgent !== "function") {
    return { status: "error", message: "installAgentIntegration requires syncIntegrationForAgent dep" };
  }

  try {
    const result = await deps.syncIntegrationForAgent(agentId);
    if (result === false) {
      return { status: "error", message: `No automatic integration install is available for ${agentId}` };
    }
    if (result && typeof result === "object" && result.status === "skipped") {
      return {
        status: "skipped",
        ...integrationResultMetadata(result),
        message: resultMessage(result, `Skipped installing ${agentId}`),
      };
    }
    if (result && typeof result === "object" && result.status && result.status !== "ok") {
      return {
        status: "error",
        ...integrationResultMetadata(result),
        message: resultMessage(result, `Failed to install ${agentId}`),
      };
    }
    return {
      status: "ok",
      message: resultMessage(result, `Installed ${agentId}`),
      commit: {
        ...buildAgentCommit(snapshot, agentId, {
          integrationInstalled: true,
          enabled: true,
        }),
        dismissedAgentInstallHints: withoutDismissedInstallHint(snapshot, agentId),
      },
    };
  } catch (err) {
    return {
      status: "error",
      message: `installAgentIntegration: ${err && err.message}`,
    };
  }
}

async function uninstallAgentIntegration(payload, deps = {}) {
  const normalized = normalizeAgentIntegrationPayload(payload, _validateUninstallAgentId, "uninstall");
  if (normalized.status !== "ok") return normalized;
  const { agentId, dismissInstallHint } = normalized;
  const snapshot = deps.snapshot || {};
  if (!deps || typeof deps.uninstallIntegrationForAgent !== "function") {
    return { status: "error", message: "uninstallAgentIntegration requires uninstallIntegrationForAgent dep" };
  }

  try {
    const result = await deps.uninstallIntegrationForAgent(agentId);
    if (result === false) {
      return { status: "error", message: `No automatic integration uninstall is available for ${agentId}` };
    }
    if (result && typeof result === "object" && result.status === "error") {
      return {
        status: "error",
        ...integrationResultMetadata(result),
        message: resultMessage(result, `Failed to uninstall ${agentId}`),
      };
    }
    if (typeof deps.clearSessionsByAgent === "function") deps.clearSessionsByAgent(agentId);
    return {
      status: "ok",
      ...integrationResultMetadata(result),
      message: resultMessage(result, `Uninstalled ${agentId}`),
      commit: {
        ...buildAgentCommit(snapshot, agentId, {
          integrationInstalled: false,
          enabled: false,
        }),
        dismissedAgentInstallHints: dismissInstallHint
          ? withDismissedInstallHint(snapshot, agentId)
          : withoutDismissedInstallHint(snapshot, agentId),
      },
    };
  } catch (err) {
    return {
      status: "error",
      message: `uninstallAgentIntegration: ${err && err.message}`,
    };
  }
}

async function repairAgentIntegration(payload, deps) {
  const agentId = typeof payload === "string" ? payload : payload && payload.agentId;
  const idCheck = _validateRepairAgentId(agentId);
  if (idCheck.status !== "ok") return idCheck;

  if (!AUTO_REPAIRABLE_AGENT_IDS.has(agentId)) {
    return {
      status: "error",
      message: `No automatic integration repair is available for ${agentId}`,
    };
  }

  const snapshot = deps && deps.snapshot;
  if (!isAgentIntegrationInstalled(snapshot, agentId)) {
    return {
      status: "error",
      message: `${agentId} integration is not installed in Settings; install it before repairing`,
    };
  }
  if (!isAgentEnabled(snapshot, agentId)) {
    return {
      status: "error",
      message: `${agentId} is disabled in Settings; enable it before repairing the integration`,
    };
  }

  const repairFn =
    deps && typeof deps.repairIntegrationForAgent === "function"
      ? deps.repairIntegrationForAgent
      : deps && typeof deps.syncIntegrationForAgent === "function"
        ? deps.syncIntegrationForAgent
        : null;
  if (!repairFn) {
    return {
      status: "error",
      message: "repairAgentIntegration requires repairIntegrationForAgent or syncIntegrationForAgent dep",
    };
  }

  try {
    const result = await repairFn(agentId);
    if (result === false) {
      return { status: "error", message: `No automatic integration repair is available for ${agentId}` };
    }
    if (result && typeof result === "object" && result.status && result.status !== "ok") {
      return {
        status: "error",
        ...integrationResultMetadata(result),
        message: resultMessage(result, `Failed to repair ${agentId}`),
      };
    }
    return {
      status: "ok",
      message: resultMessage(result, `Repaired ${agentId}`),
    };
  } catch (err) {
    return {
      status: "error",
      message: `repairAgentIntegration: ${err && err.message}`,
    };
  }
}

function normalizeDismissAgentHintPayload(payload, validateAgentId, commandName) {
  const raw = Array.isArray(payload && payload.agentIds)
    ? payload.agentIds
    : [typeof payload === "string" ? payload : payload && payload.agentId].filter(Boolean);
  const agentIds = [];
  for (const value of raw) {
    const idCheck = validateAgentId(value);
    if (idCheck.status !== "ok") return idCheck;
    if (!INSTALLABLE_AGENT_IDS.has(value)) {
      return {
        status: "error",
        message: `No automatic integration dismiss is available for ${value}`,
      };
    }
    if (!agentIds.includes(value)) agentIds.push(value);
  }
  if (agentIds.length === 0) {
    return { status: "error", message: `${commandName}.agentIds must include at least one agent` };
  }
  return { status: "ok", agentIds };
}

function updateInstallHints(payload, deps, commandName, dismissed) {
  const normalized = normalizeDismissAgentHintPayload(payload, _validateDismissInstallHintId, commandName);
  if (normalized.status !== "ok") return normalized;
  const snapshot = deps.snapshot || {};
  const current = snapshot.dismissedAgentInstallHints;
  const next = current && typeof current === "object" && !Array.isArray(current) ? { ...current } : {};
  let changed = false;
  for (const agentId of normalized.agentIds) {
    if ((next[agentId] === true) === dismissed) continue;
    if (dismissed) next[agentId] = true;
    else delete next[agentId];
    changed = true;
  }
  if (!changed) return { status: "ok", noop: true };
  return { status: "ok", commit: { dismissedAgentInstallHints: next } };
}

function dismissAgentInstallHints(payload, deps = {}) {
  return updateInstallHints(payload, deps, "dismissAgentInstallHints", true);
}

function clearAgentInstallHints(payload, deps = {}) {
  return updateInstallHints(payload, deps, "clearAgentInstallHints", false);
}

setAgentFlag.lockKey = "agentIntegration";
installAgentIntegration.lockKey = "agentIntegration";
uninstallAgentIntegration.lockKey = "agentIntegration";
repairAgentIntegration.lockKey = "agentIntegration";
dismissAgentInstallHints.lockKey = "agentIntegration";
clearAgentInstallHints.lockKey = "agentIntegration";

module.exports = {
  AUTO_REPAIRABLE_AGENT_IDS,
  INSTALLABLE_AGENT_IDS,
  clearAgentInstallHints,
  dismissAgentInstallHints,
  installAgentIntegration,
  setAgentFlag,
  uninstallAgentIntegration,
  repairAgentIntegration,
};
