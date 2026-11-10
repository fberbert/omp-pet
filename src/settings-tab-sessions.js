"use strict";

// Sessions tab: the session HUD, the session dashboard, and the timeout
// cleanup group. patchInPlace only accepts
// SESSIONS_IN_PLACE_KEYS; it never patches notification or pet controls.
(function initSettingsTabSessions(root) {
  const SESSIONS_IN_PLACE_KEYS = new Set([
    "sessionHudEnabled",
    "sessionHudShowStateLabels",
    "sessionHudShowElapsed",
    "sessionHudCleanupDetached",
    "sessionStaleMs",
    "workingStaleMs",
    "detachedIdleStaleMs",
  ]);
  const SESSION_CLEANUP_NUMBER_KEYS = new Set([
    "sessionStaleMs",
    "workingStaleMs",
    "detachedIdleStaleMs",
  ]);
  const SESSION_CLEANUP_DEFAULTS = {
    sessionStaleMs: 600_000,
    workingStaleMs: 300_000,
    detachedIdleStaleMs: 30_000,
  };
  const SESSION_HUD_CHILD_SWITCH_KEYS = [
    "sessionHudShowStateLabels",
    "sessionHudShowElapsed",
    "sessionHudCleanupDetached",
  ];

  let state = null;
  let readers = null;
  let helpers = null;
  let ops = null;

  function t(key) {
    return helpers.t(key);
  }

  function buildDashboardRow() {
    const row = document.createElement("div");
    row.className = "row";
    const text = document.createElement("div");
    text.className = "row-text";
    const label = document.createElement("span");
    label.className = "row-label";
    label.textContent = t("rowSessionDashboard");
    const desc = document.createElement("span");
    desc.className = "row-desc";
    desc.textContent = t("rowSessionDashboardDesc");
    text.append(label, desc);
    const control = document.createElement("div");
    control.className = "row-control";
    const btn = helpers.buildButton({
      labelKey: "actionOpenDashboard",
      tone: "accent",
    });
    btn.addEventListener("click", () => {
      if (window.settingsAPI && typeof window.settingsAPI.openDashboard === "function") {
        window.settingsAPI.openDashboard();
      }
    });
    control.appendChild(btn);
    row.append(text, control);
    return row;
  }

  function buildOptionList(className, rows) {
    const list = document.createElement("div");
    list.className = `settings-option-list ${className || ""}`.trim();
    for (const row of rows) {
      row.classList.add("settings-option-item");
      list.appendChild(row);
    }
    return list;
  }

  // Returns the row array directly so the Session HUD section can lay them out
  // as ordinary rows; the name is kept for the original call site.
  function buildSessionHudOptionsList(sessionHudControlsEnabled) {
    return [
      helpers.buildSwitchRow({
        key: "sessionHudEnabled",
        labelKey: "rowSessionHudMaster",
      }),
      helpers.buildSwitchRow({
        key: "sessionHudShowStateLabels",
        labelKey: "rowSessionHudStateLabels",
        descKey: "rowSessionHudStateLabelsDesc",
        disabled: !sessionHudControlsEnabled,
      }),
      helpers.buildSwitchRow({
        key: "sessionHudShowElapsed",
        labelKey: "rowSessionHudElapsed",
        descKey: "rowSessionHudElapsedDesc",
        disabled: !sessionHudControlsEnabled,
      }),
      helpers.buildSwitchRow({
        key: "sessionHudCleanupDetached",
        labelKey: "rowSessionHudCleanupDetached",
        descKey: "rowSessionHudCleanupDetachedDesc",
        disabled: !sessionHudControlsEnabled,
      }),
    ];
  }

  function buildSessionCleanupGroup() {
    const optionList = buildOptionList("session-cleanup-option-list", [
      helpers.buildNumberInputRow({
        key: "sessionStaleMs",
        labelKey: "rowStaleSession",
        descKey: "rowStaleSessionDesc",
        unitKey: "unitMinutes",
        toDisplay: (ms) => Math.round(ms / 60_000),
        fromDisplay: (min) => Math.max(0, Math.round(min * 60_000)),
        min: 0,
        max: 1440,
        zeroLabelKey: "valueDisabled",
      }).row,
      helpers.buildNumberInputRow({
        key: "workingStaleMs",
        labelKey: "rowStaleWorking",
        descKey: "rowStaleWorkingDesc",
        unitKey: "unitSeconds",
        toDisplay: (ms) => Math.round(ms / 1000),
        fromDisplay: (sec) => Math.max(30_000, Math.min(86_400_000, Math.round(sec * 1000))),
        min: 30,
        max: 86_400,
      }).row,
      helpers.buildNumberInputRow({
        key: "detachedIdleStaleMs",
        labelKey: "rowStaleDetached",
        descKey: "rowStaleDetachedDesc",
        unitKey: "unitSeconds",
        toDisplay: (ms) => Math.round(ms / 1000),
        fromDisplay: (sec) => Math.max(5_000, Math.min(300_000, Math.round(sec * 1000))),
        min: 5,
        max: 300,
      }).row,
    ]);

    // Reset lives in its own row outside the option-list so it doesn't render
    // as a card; mirrors how Sound group puts the volume slider on its own row.
    const resetRow = document.createElement("div");
    resetRow.className = "row session-cleanup-reset-row";
    const resetButton = helpers.buildButton({
      labelKey: "actionResetSessionCleanup",
      size: "compact",
    });
    resetButton.addEventListener("click", async () => {
      helpers.setButtonState(resetButton, { pending: true });
      try {
        const result = await window.settingsAPI.command(
          "sessionCleanup.setTriple",
          { ...SESSION_CLEANUP_DEFAULTS }
        );
        if (!result || result.status !== "ok") {
          const msg = (result && result.message) || "unknown error";
          ops.showToast(t("toastSaveFailed") + msg, { error: true });
        }
      } catch (err) {
        ops.showToast(t("toastSaveFailed") + (err && err.message), { error: true });
      } finally {
        helpers.setButtonState(resetButton, { pending: false });
      }
    });
    resetRow.appendChild(resetButton);

    return helpers.buildCollapsibleGroup({
      id: "sessions:timeouts",
      title: t("rowSessionCleanupGroup"),
      desc: t("rowSessionCleanupGroupDesc"),
      defaultCollapsed: true,
      className: "session-cleanup-collapsible",
      children: [optionList, resetRow],
    });
  }

  function getMountedGeneralSwitch(key) {
    const meta = state.mountedControls.generalSwitches.get(key);
    if (!meta || !document.body.contains(meta.element)) return null;
    return meta;
  }

  function setGeneralSwitchDisabled(key, disabled) {
    const meta = getMountedGeneralSwitch(key);
    if (!meta) return false;
    meta.control.setState({ disabled: !!disabled });
    return true;
  }

  function syncSessionHudChildSwitchesDisabled() {
    const disabled = !(state.snapshot && state.snapshot.sessionHudEnabled);
    for (const key of SESSION_HUD_CHILD_SWITCH_KEYS) {
      if (!setGeneralSwitchDisabled(key, disabled)) return false;
    }
    return true;
  }

  function render(parent) {
    const h1 = document.createElement("h1");
    h1.textContent = t("sessionsTitle");
    parent.appendChild(h1);

    const subtitle = document.createElement("p");
    subtitle.className = "subtitle";
    subtitle.textContent = t("sessionsSubtitle");
    parent.appendChild(subtitle);

    parent.appendChild(helpers.buildSection("", [buildDashboardRow()]));

    const hudEnabled = !!(state.snapshot && state.snapshot.sessionHudEnabled);
    parent.appendChild(helpers.buildSection(t("sectionSessionHud"), [
      ...buildSessionHudOptionsList(hudEnabled),
    ]));

    parent.appendChild(helpers.buildSection(t("sectionAdvanced"), [
      buildSessionCleanupGroup(),
    ]));
  }

  function patchInPlace(changes) {
    const keys = changes ? Object.keys(changes) : [];
    if (keys.length === 0) return false;
    if (!keys.every((key) => SESSIONS_IN_PLACE_KEYS.has(key))) return false;
    if (keys.includes("sessionHudEnabled")
      && !SESSION_HUD_CHILD_SWITCH_KEYS.every((key) => getMountedGeneralSwitch(key))) {
      return false;
    }
    if (keys.some((key) => SESSION_CLEANUP_NUMBER_KEYS.has(key))) {
      for (const key of keys) {
        if (!SESSION_CLEANUP_NUMBER_KEYS.has(key)) continue;
        const meta = state.mountedControls.sessionCleanupControls.get(key);
        if (!meta || !document.body.contains(meta.row)) return false;
      }
    }
    for (const key of keys) {
      if (SESSION_CLEANUP_NUMBER_KEYS.has(key)) continue;
      const meta = state.mountedControls.generalSwitches.get(key);
      if (!meta || !document.body.contains(meta.element)) return false;
    }
    for (const key of keys) {
      if (SESSION_CLEANUP_NUMBER_KEYS.has(key)) {
        state.mountedControls.sessionCleanupControls.get(key).syncFromSnapshot();
        continue;
      }
      const meta = state.mountedControls.generalSwitches.get(key);
      state.transientUiState.generalSwitches.delete(key);
      meta.control.setState({
        checked: readers.readGeneralSwitchVisual(key, meta.invert),
        pending: false,
      });
    }
    if (keys.includes("sessionHudEnabled") && !syncSessionHudChildSwitchesDisabled()) return false;
    return true;
  }

  function init(core) {
    state = core.state;
    readers = core.readers;
    helpers = core.helpers;
    ops = core.ops;
    core.tabs.sessions = {
      render,
      patchInPlace,
    };
  }

  root.ClawdSettingsTabSessions = { init };
})(globalThis);
