"use strict";

// Agents tab: omp-pet follows a single agent, OMP (oh-my-pi), through a
// global extension under ~/.omp/agent/extensions/omp-pet. The tab shows the
// connection status and offers enable/disable plus install, repair and
// uninstall of the managed extension.
(function initSettingsTabAgents(root) {
  const AGENT_ID = "omp";

  let state = null;
  let runtime = null;
  let helpers = null;
  let ops = null;
  let lastActivity = null;
  let busy = false;

  function t(key) {
    return helpers.t(key);
  }

  function readAgentEntry() {
    const agents = state.snapshot && state.snapshot.agents;
    const entry = agents && agents[AGENT_ID];
    return entry && typeof entry === "object" ? entry : {};
  }

  function readDetection() {
    const hints = runtime.agentInstallationHints;
    const list = hints && Array.isArray(hints.agents) ? hints.agents : [];
    return list.find((item) => item && item.agentId === AGENT_ID) || null;
  }

  function describeStatus(entry, detection) {
    const installed = entry.integrationInstalled !== false;
    const enabled = entry.enabled !== false;
    if (!installed) return { tone: "off", text: t("agentOmpNotInstalled") };
    if (!enabled) return { tone: "off", text: t("agentStatusPaused") };
    if (detection && detection.detectedInstalled === false) {
      return { tone: "warn", text: t("agentOmpNotDetected") };
    }
    if (detection && detection.clawdIntegration && detection.clawdIntegration.detected === false) {
      return { tone: "warn", text: t("agentOmpExtensionMissing") };
    }
    return {
      tone: "ok",
      text: `${t("agentStatusReceivesExtension")} · ${t("agentStatusStateOnly")}`,
    };
  }

  function formatActivity() {
    if (!lastActivity || !Number.isFinite(lastActivity.timestamp)) return t("agentLastEventNone");
    const when = new Date(lastActivity.timestamp).toLocaleTimeString();
    return lastActivity.eventType ? `${lastActivity.eventType} · ${when}` : when;
  }

  async function runCommand(action, payload, successKey) {
    if (busy) return;
    busy = true;
    ops.requestRender({ content: true, preserveScroll: true });
    try {
      const result = await window.settingsAPI.command(action, payload);
      if (!result || (result.status !== "ok" && result.status !== "skipped")) {
        const message = (result && result.message) || "unknown error";
        ops.showToast(t("toastSaveFailed") + message, { error: true });
      } else if (successKey) {
        ops.showToast(t(successKey));
      }
    } catch (err) {
      ops.showToast(t("toastSaveFailed") + (err && err.message), { error: true });
    } finally {
      busy = false;
      ops.fetchAgentInstallationHints({ force: true });
      ops.requestRender({ content: true, preserveScroll: true });
    }
  }

  async function confirmUninstall() {
    const choice = await helpers.showSettingsConfirmModal({
      title: t("agentIntegrationUninstallConfirmTitle"),
      detail: t("agentIntegrationUninstallConfirm"),
      actions: [
        { id: "cancel", label: t("agentIntegrationUninstallCancel"), defaultFocus: true },
        { id: "uninstall", label: t("agentIntegrationUninstall"), tone: "danger" },
      ],
    });
    if (choice !== "uninstall") return;
    runCommand("uninstallAgentIntegration", { agentId: AGENT_ID }, "toastAgentIntegrationUninstalled");
  }

  function buildStatusRow(entry, detection) {
    const row = helpers.buildSettingRow({ labelKey: "rowAgentStatus" });
    const status = helpers.buildStatusLine(describeStatus(entry, detection));
    row.controlElement.appendChild(status.element);
    return row.element;
  }

  function buildEnabledRow(entry) {
    const row = helpers.buildSettingRow({
      labelKey: "rowAgentEnabled",
      descriptionKey: "rowAgentEnabledDesc",
    });
    const installed = entry.integrationInstalled !== false;
    const control = helpers.buildSwitch({
      checked: entry.enabled !== false,
      disabled: !installed || busy,
      ariaLabelledBy: row.labelElement.id,
    });
    control.setOnToggle(() => {
      runCommand("setAgentFlag", {
        agentId: AGENT_ID,
        flag: "enabled",
        value: entry.enabled === false,
      });
    });
    row.controlElement.appendChild(control.element);
    return row.element;
  }

  function buildPathRow(detection) {
    const configPath = detection && detection.paths && detection.paths.configPath;
    const row = helpers.buildSettingRow({
      labelKey: "rowAgentExtensionPath",
      description: configPath || "~/.omp/agent/extensions/omp-pet",
    });
    return row.element;
  }

  function buildActivityRow() {
    const row = helpers.buildSettingRow({
      labelKey: "rowAgentLastEvent",
      description: formatActivity(),
    });
    row.element.dataset.agentActivityRow = AGENT_ID;
    return row.element;
  }

  function buildActionsRow(entry) {
    const row = document.createElement("div");
    row.className = "row agent-integration-actions-row";
    const installed = entry.integrationInstalled !== false;
    if (!installed) {
      row.appendChild(helpers.buildButton({
        labelKey: busy ? "agentIntegrationWorking" : "agentIntegrationInstall",
        tone: "accent",
        disabled: busy,
        onClick: () => runCommand(
          "installAgentIntegration",
          { agentId: AGENT_ID },
          "toastAgentIntegrationInstalled"
        ),
      }));
      return row;
    }
    row.appendChild(helpers.buildButton({
      labelKey: busy ? "agentIntegrationWorking" : "agentIntegrationRepair",
      disabled: busy || entry.enabled === false,
      onClick: () => runCommand(
        "repairAgentIntegration",
        { agentId: AGENT_ID },
        "toastAgentIntegrationRepaired"
      ),
    }));
    row.appendChild(helpers.buildButton({
      labelKey: "agentIntegrationUninstall",
      tone: "danger",
      disabled: busy,
      onClick: () => { confirmUninstall(); },
    }));
    return row;
  }

  function render(parent) {
    const h1 = document.createElement("h1");
    h1.textContent = t("agentsTitle");
    parent.appendChild(h1);

    const subtitle = document.createElement("p");
    subtitle.className = "subtitle";
    subtitle.textContent = t("agentsSubtitleOmp");
    parent.appendChild(subtitle);

    if (!runtime.agentInstallationHintsFetched && !runtime.agentInstallationHintsPending) {
      ops.fetchAgentInstallationHints();
    }

    if (window.settingsAPI && typeof window.settingsAPI.getRecentAgentActivity === "function") {
      window.settingsAPI.getRecentAgentActivity(AGENT_ID)
        .then((activity) => { if (activity) applyAgentActivity({ agentId: AGENT_ID, ...activity }); })
        .catch(() => {});
    }

    const entry = readAgentEntry();
    const detection = readDetection();
    parent.appendChild(helpers.buildSection("OMP (oh-my-pi)", [
      buildStatusRow(entry, detection),
      buildEnabledRow(entry),
      buildPathRow(detection),
      buildActivityRow(),
      buildActionsRow(entry),
    ]));
  }

  function applyAgentActivity(payload) {
    if (!payload || payload.agentId !== AGENT_ID) return;
    lastActivity = { timestamp: payload.timestamp, eventType: payload.eventType };
    const row = document.querySelector(`[data-agent-activity-row="${AGENT_ID}"] .row-desc`);
    if (row) row.textContent = formatActivity();
  }

  function init(core) {
    state = core.state;
    runtime = core.runtime;
    helpers = core.helpers;
    ops = core.ops;
    core.tabs.agents = {
      render,
      applyAgentActivity,
    };
  }

  root.ClawdSettingsTabAgents = { init };
})(globalThis);
