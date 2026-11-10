"use strict";

// Notifications tab: the ways the pet gets your attention - sound and tray
// flashing. patchInPlace only accepts
// NOTIFICATIONS_IN_PLACE_KEYS; the sound toggle owns its own optimistic save.
(function initSettingsTabNotifications(root) {
  const NOTIFICATIONS_IN_PLACE_KEYS = new Set([
    "soundMuted",
    "soundVolume",
    "flashTaskbarOnComplete",
    "flashIntervalMs",
    "flashDurationMs",
  ]);
  const NUMBER_INPUT_KEYS = new Set([
    "flashIntervalMs",
    "flashDurationMs",
  ]);

  let state = null;
  let readers = null;
  let helpers = null;
  let ops = null;

  function t(key) {
    return helpers.t(key);
  }

  function getMountedGeneralSwitch(key) {
    const meta = state.mountedControls.generalSwitches.get(key);
    if (!meta || !document.body.contains(meta.element)) return null;
    return meta;
  }

  function buildSoundEnabledRow() {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML =
      `<div class="row-text">` +
        `<span class="row-label"></span>` +
      `</div>` +
      `<div class="row-control"></div>`;
    const label = row.querySelector(".row-label");
    label.id = "settings-sound-enabled-label";
    label.textContent = t("rowSoundEnabled");
    const text = row.querySelector(".row-text");
    const override = state.transientUiState.generalSwitches.get("soundMuted");
    const visualOn = override ? override.visualOn : readers.readGeneralSwitchVisual("soundMuted", true);
    const switchControl = helpers.buildSwitch({
      checked: visualOn,
      pending: override ? override.pending : false,
      ariaLabelledBy: label.id,
    });
    row.querySelector(".row-control").appendChild(switchControl.element);
    state.mountedControls.generalSwitches.set("soundMuted", {
      control: switchControl,
      element: switchControl.element,
      invert: true,
      row,
      text,
      extraElement: null,
    });

    function getSoundTransientState() {
      return state.transientUiState.generalSwitches.get("soundMuted") || null;
    }

    function getCommittedSoundVisual() {
      return readers.readGeneralSwitchVisual("soundMuted", true);
    }

    function setSoundChildSwitchVisual(visualOn, pendingVisual) {
      const meta = getMountedGeneralSwitch("soundMuted");
      if (!meta) return;
      meta.control.setState({ checked: visualOn, pending: pendingVisual });
    }

    function toggleSound(ev) {
      if (ev) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      const activeTransient = getSoundTransientState();
      if (activeTransient && activeTransient.pending) return;
      const currentRaw = readers.readGeneralSwitchRaw("soundMuted");
      const currentVisual = !currentRaw;
      const nextVisual = !currentVisual;
      const nextMuted = !nextVisual;
      const seq = state.nextTransientUiSeq++;
      state.transientUiState.generalSwitches.set("soundMuted", {
        visualOn: nextVisual,
        pending: true,
        seq,
      });
      setSoundChildSwitchVisual(nextVisual, true);
      window.settingsAPI.update("soundMuted", nextMuted).then((result) => {
        const currentTransient = getSoundTransientState();
        if (!currentTransient || currentTransient.seq !== seq) return;
        state.transientUiState.generalSwitches.delete("soundMuted");
        if (!result || result.status !== "ok" || result.noop) {
          const committedVisual = getCommittedSoundVisual();
          setSoundChildSwitchVisual(committedVisual, false);
          if (result && result.noop) return;
          const msg = (result && result.message) || "unknown error";
          ops.showToast(t("toastSaveFailed") + msg, { error: true });
          return;
        }
        setSoundChildSwitchVisual(nextVisual, false);
      }).catch((err) => {
        const currentTransient = getSoundTransientState();
        if (!currentTransient || currentTransient.seq !== seq) return;
        state.transientUiState.generalSwitches.delete("soundMuted");
        const committedVisual = getCommittedSoundVisual();
        setSoundChildSwitchVisual(committedVisual, false);
        ops.showToast(t("toastSaveFailed") + (err && err.message), { error: true });
      });
    }

    switchControl.setOnToggle(({ event }) => toggleSound(event));
    return row;
  }

  function buildVolumeSliderRow() {
    const row = document.createElement("div");
    row.className = "row volume-slider-row";
    row.innerHTML =
      `<div class="row-text">` +
        `<span class="row-label"></span>` +
        `<span class="row-desc"></span>` +
      `</div>` +
      `<div class="row-control volume-control">` +
        `<input type="range" class="volume-slider" min="0" max="100" step="1" />` +
        `<span class="volume-readout" aria-hidden="true"></span>` +
      `</div>`;
    row.querySelector(".row-label").textContent = t("rowVolume");
    row.querySelector(".row-desc").textContent = t("rowVolumeDesc");

    const control = row.querySelector(".volume-control");
    const slider = row.querySelector(".volume-slider");
    const readout = row.querySelector(".volume-readout");

    let previewUrl = null;
    let previewAudio = null;

    function applySliderValue(pct) {
      slider.value = String(pct);
      slider.style.setProperty("--volume-fill", `${pct}%`);
      readout.textContent = `${pct}%`;
    }

    function getSnapshotVolumePct() {
      const v = state.snapshot && typeof state.snapshot.soundVolume === "number"
        ? state.snapshot.soundVolume : 1;
      return Math.round(v * 100);
    }

    function applyDisabledState(muted) {
      control.classList.toggle("disabled", !!muted);
      slider.disabled = !!muted;
      slider.tabIndex = muted ? -1 : 0;
    }

    function playPreview(vol) {
      if (!previewUrl) return;
      if (!previewAudio) previewAudio = new Audio(previewUrl);
      previewAudio.volume = Math.max(0, Math.min(1, vol));
      previewAudio.currentTime = 0;
      previewAudio.play().catch(() => {});
    }

    applySliderValue(getSnapshotVolumePct());
    applyDisabledState(!!(state.snapshot && state.snapshot.soundMuted));

    slider.addEventListener("input", () => {
      applySliderValue(Number(slider.value));
    });

    slider.addEventListener("change", () => {
      const pct = Number(slider.value);
      const vol = pct / 100;
      playPreview(vol);
      window.settingsAPI.update("soundVolume", vol).then((result) => {
        if (!result || result.status !== "ok") {
          const msg = (result && result.message) || "unknown error";
          ops.showToast(t("toastSaveFailed") + msg, { error: true });
          applySliderValue(getSnapshotVolumePct());
        }
      }).catch((err) => {
        ops.showToast(t("toastSaveFailed") + (err && err.message), { error: true });
        applySliderValue(getSnapshotVolumePct());
      });
    });

    window.settingsAPI.getPreviewSoundUrl().then((url) => {
      if (url) previewUrl = url;
    }).catch(() => {});

    state.mountedControls.soundVolume = {
      row,
      syncDisabled() {
        applyDisabledState(!!(state.snapshot && state.snapshot.soundMuted));
      },
      syncValueFromSnapshot() {
        applySliderValue(getSnapshotVolumePct());
      },
      dispose() {
        if (previewAudio) {
          previewAudio.pause();
          previewAudio = null;
        }
      },
    };

    return row;
  }

  function render(parent) {
    const h1 = document.createElement("h1");
    h1.textContent = t("notificationsTitle");
    parent.appendChild(h1);

    const subtitle = document.createElement("p");
    subtitle.className = "subtitle";
    subtitle.textContent = t("notificationsSubtitle");
    parent.appendChild(subtitle);

    const soundSection = helpers.buildSection(t("sectionSound"), [
      buildSoundEnabledRow(),
      buildVolumeSliderRow(),
    ]);
    soundSection.classList.add("sound-section");
    parent.appendChild(soundSection);

    parent.appendChild(helpers.buildSection(t("sectionTrayFlash"), [
      helpers.buildSwitchRow({
        key: "flashTaskbarOnComplete",
        labelKey: "rowFlashTaskbarOnComplete",
        descKey: "rowFlashTaskbarOnCompleteDesc",
      }),
      helpers.buildNumberInputRow({
        key: "flashIntervalMs",
        labelKey: "rowFlashInterval",
        descKey: "rowFlashIntervalDesc",
        unitKey: "unitMilliseconds",
        toDisplay: (ms) => ms,
        fromDisplay: (v) => Math.max(200, Math.min(2000, Math.round(v))),
        min: 200,
        max: 2000,
      }).row,
      helpers.buildNumberInputRow({
        key: "flashDurationMs",
        labelKey: "rowFlashDuration",
        descKey: "rowFlashDurationDesc",
        unitKey: "unitMilliseconds",
        toDisplay: (ms) => ms,
        fromDisplay: (v) => {
          const n = parseInt(v, 10);
          return Number.isFinite(n) ? Math.max(0, Math.min(60000, Math.round(n))) : 0;
        },
        min: 0,
        max: 60000,
        zeroLabelKey: "valueAlways",
      }).row,
    ]));

  }

  function patchInPlace(changes) {
    const keys = changes ? Object.keys(changes) : [];
    if (keys.length === 0) return false;
    if (!keys.every((key) => NOTIFICATIONS_IN_PLACE_KEYS.has(key))) return false;
    if (keys.includes("soundVolume") || keys.includes("soundMuted")) {
      const vc = state.mountedControls.soundVolume;
      if (!vc || !document.body.contains(vc.row)) return false;
    }
    if (keys.some((key) => NUMBER_INPUT_KEYS.has(key))) {
      for (const key of keys) {
        if (!NUMBER_INPUT_KEYS.has(key)) continue;
        const meta = state.mountedControls.sessionCleanupControls.get(key);
        if (!meta || !document.body.contains(meta.row)) return false;
      }
    }
    for (const key of keys) {
      if (key === "soundVolume") continue;
      if (NUMBER_INPUT_KEYS.has(key)) continue;
      const meta = state.mountedControls.generalSwitches.get(key);
      if (!meta || !document.body.contains(meta.element)) return false;
    }
    for (const key of keys) {
      if (key === "soundVolume") {
        state.mountedControls.soundVolume.syncValueFromSnapshot();
        continue;
      }
      if (NUMBER_INPUT_KEYS.has(key)) {
        state.mountedControls.sessionCleanupControls.get(key).syncFromSnapshot();
        continue;
      }
      const meta = state.mountedControls.generalSwitches.get(key);
      state.transientUiState.generalSwitches.delete(key);
      meta.control.setState({
        checked: readers.readGeneralSwitchVisual(key, meta.invert),
        pending: false,
      });
      if (key === "soundMuted") {
        state.mountedControls.soundVolume.syncDisabled();
      }
    }
    return true;
  }

  function init(core) {
    state = core.state;
    readers = core.readers;
    helpers = core.helpers;
    ops = core.ops;
    core.tabs.notifications = {
      render,
      patchInPlace,
    };
  }

  root.ClawdSettingsTabNotifications = { init };
})(globalThis);
