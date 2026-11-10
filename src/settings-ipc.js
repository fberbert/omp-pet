"use strict";

const defaultFs = require("fs");
const defaultPath = require("path");
const { pathToFileURL } = require("url");
const { detectAgentInstallations: defaultDetectAgentInstallations } = require("./agent-installation-detector");
const {
  listPetTintOptions,
  listPetAccessoryOptions,
  listPetMouthAccessoryOptions,
} = require("./pet-customization-catalog");

const SOUND_OVERRIDE_ASSET_EXTS = new Set([".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"]);
const SOUND_OVERRIDE_DIALOG_STRINGS = {
  en: { title: "Choose a sound file", filterName: "Audio" },
  "pt-BR": { title: "Escolha um arquivo de som", filterName: "Áudio" },
};

const REMOVE_THEME_DIALOG_STRINGS = {
  en: {
    delete: "Delete",
    cancel: "Cancel",
    message: (name) => `Delete theme "${name}"?`,
    detail: "This cannot be undone. All files for this theme will be removed from disk.",
  },
  "pt-BR": {
    delete: "Excluir",
    cancel: "Cancelar",
    message: (name) => `Excluir o tema "${name}"?`,
    detail: "Isso não pode ser desfeito. Todos os arquivos deste tema serão removidos do disco.",
  },
};

function requiredDependency(value, name) {
  if (!value) throw new Error(`registerSettingsIpc requires ${name}`);
  return value;
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getSettingsDialogParent(event, { BrowserWindow, getSettingsWindow }) {
  const sender = event && event.sender;
  const fromSender = sender && BrowserWindow && typeof BrowserWindow.fromWebContents === "function"
    ? BrowserWindow.fromWebContents(sender)
    : null;
  return fromSender || (typeof getSettingsWindow === "function" ? getSettingsWindow() : null) || null;
}

function cleanupSiblingSoundOverrides(fs, path, overridesDir, soundName, keepExt) {
  let entries;
  try { entries = fs.readdirSync(overridesDir); }
  catch { return; }
  for (const entry of entries) {
    if (path.parse(entry).name !== soundName) continue;
    if (path.extname(entry).toLowerCase() === keepExt) continue;
    try { fs.unlinkSync(path.join(overridesDir, entry)); } catch {}
  }
}

function rememberRuntimeSoundOverrideFile({ getActiveTheme }, themeId, soundName, absPath) {
  const activeTheme = getActiveTheme();
  if (!activeTheme || activeTheme._id !== themeId) return;
  if (typeof soundName !== "string" || !soundName) return;
  if (typeof absPath !== "string" || !absPath) return;
  const nextOverrideMap = isPlainObject(activeTheme._soundOverrideFiles)
    ? { ...activeTheme._soundOverrideFiles }
    : {};
  nextOverrideMap[soundName] = absPath;
  activeTheme._soundOverrideFiles = nextOverrideMap;
}

function mapAgentMetadata(agent) {
  const metadata = {
    id: agent.id,
    name: agent.name,
    eventSource: agent.eventSource,
    capabilities: agent.capabilities || {},
  };
  if (typeof agent.category === "string" && agent.category) {
    metadata.category = agent.category;
  }
  return metadata;
}

function registerSettingsIpc(options = {}) {
  const ipcMain = requiredDependency(options.ipcMain, "ipcMain");
  const settingsController = requiredDependency(options.settingsController, "settingsController");
  const themeLoader = requiredDependency(options.themeLoader, "themeLoader");
  const dialog = requiredDependency(options.dialog, "dialog");
  const shell = requiredDependency(options.shell, "shell");
  const app = requiredDependency(options.app, "app");
  const BrowserWindow = requiredDependency(options.BrowserWindow, "BrowserWindow");
  const fs = options.fs || defaultFs;
  const path = options.path || defaultPath;
  const settingsPageUrl = pathToFileURL(
    options.settingsHtmlPath || defaultPath.join(__dirname, "settings.html"),
  ).href;
  const getSettingsWindow = options.getSettingsWindow || (() => null);
  const getActiveTheme = options.getActiveTheme || (() => null);
  const getLang = options.getLang || (() => "en");
  const roamFenceSettings = requiredDependency(options.roamFenceSettings, "roamFenceSettings");
  const roamFencePicker = requiredDependency(options.roamFencePicker, "roamFencePicker");
  const settingsSizePreviewSession = requiredDependency(
    options.settingsSizePreviewSession,
    "settingsSizePreviewSession"
  );
  const isValidSizePreviewKey = requiredDependency(
    options.isValidSizePreviewKey,
    "isValidSizePreviewKey"
  );
  const sendToRenderer = options.sendToRenderer || (() => {});
  const getDoNotDisturb = options.getDoNotDisturb || (() => false);
  const getSoundMuted = options.getSoundMuted || (() => false);
  const getSoundVolume = options.getSoundVolume || (() => 1);
  const previewTextScale = options.previewTextScale
    || (() => ({ status: "error", message: "text scale preview unavailable" }));
  const endTextScalePreview = options.endTextScalePreview
    || (() => ({ status: "error", message: "text scale preview unavailable" }));
  const getTextScaleContext = options.getTextScaleContext
    || (() => ({ percent: 100 }));
  const getSizeContext = options.getSizeContext || (() => null);
  const getAllAgents = requiredDependency(options.getAllAgents, "getAllAgents");
  const detectAgentInstallations = options.detectAgentInstallations || defaultDetectAgentInstallations;
  const getRecentHookEvents = options.getRecentHookEvents || (() => []);
  const getHardwareAccelerationDisabledAtStartup =
    options.getHardwareAccelerationDisabledAtStartup || (() => false);
  const getPetAlwaysOnTopAtStartup = options.getPetAlwaysOnTopAtStartup || (() => true);
  const showTutorial = options.showTutorial || (() => ({
    status: "error",
    message: "Tutorial is unavailable",
  }));
  const now = options.now || (() => Date.now());
  const aboutHeroSvgPath = options.aboutHeroSvgPath
    || path.join(__dirname, "..", "assets", "svg", "clawd-about-hero.svg");
  const disposers = [];

  function handle(channel, listener) {
    ipcMain.handle(channel, listener);
    disposers.push(() => ipcMain.removeHandler(channel));
  }

  function getDialogParent(event) {
    return getSettingsDialogParent(event, { BrowserWindow, getSettingsWindow });
  }

  function isTrustedSettingsEvent(event) {
    const win = getSettingsWindow();
    if (!win || (typeof win.isDestroyed === "function" && win.isDestroyed())) return false;
    const contents = win.webContents;
    const frame = event && event.senderFrame;
    return !!contents
      && event.sender === contents
      && !!frame
      && frame === contents.mainFrame
      && frame.url === settingsPageUrl;
  }

  function rejectUntrustedSettingsEvent(event) {
    return isTrustedSettingsEvent(event)
      ? null
      : { status: "error", message: "untrusted settings sender" };
  }

  handle("settings:get-snapshot", () => settingsController.getSnapshot());
  handle("settings:recap-query", async (event, period) => {
    const rejected = rejectUntrustedSettingsEvent(event);
    if (rejected) return rejected;
    if (!["today", "week", "month", "year"].includes(period)) {
      return { status: "error", reason: "invalid-period" };
    }
    const runtime = options.recapRuntime;
    if (!runtime || typeof runtime.query !== "function") {
      return { status: "error", reason: "runtime-unavailable" };
    }
    try {
      if (typeof runtime.whenReady === "function") await runtime.whenReady();
      return runtime.query(period);
    }
    catch { return { status: "error", reason: "query-failed" }; }
  });
  handle("settings:recap-clear", (event) => {
    const rejected = rejectUntrustedSettingsEvent(event);
    if (rejected) return rejected;
    const runtime = options.recapRuntime;
    if (!runtime || typeof runtime.clear !== "function") {
      return { status: "error", reason: "runtime-unavailable" };
    }
    try {
      return runtime.clear()
        ? { status: "ok" }
        : { status: "error", reason: "clear-failed" };
    } catch {
      return { status: "error", reason: "clear-failed" };
    }
  });
  handle("settings:get-pet-tint-options", () => listPetTintOptions());
  handle("settings:get-pet-accessory-options", () => listPetAccessoryOptions());
  handle("settings:get-pet-mouth-accessory-options", () => listPetMouthAccessoryOptions());
  handle("settings:get-roam-fence", (event) => {
    const rejected = rejectUntrustedSettingsEvent(event);
    return rejected || roamFenceSettings.getStatus();
  });
  handle("settings:select-roam-fence", async (event) => {
    const rejected = rejectUntrustedSettingsEvent(event);
    if (rejected) return rejected;
    const picked = await roamFencePicker.selectArea({
      lang: getLang(),
    });
    if (!picked || picked.status !== "ok") return picked || { status: "cancel" };
    return roamFenceSettings.saveFence(picked.fence);
  });
  handle("settings:clear-roam-fence", (event) => {
    const rejected = rejectUntrustedSettingsEvent(event);
    return rejected || roamFenceSettings.clearFence();
  });
  handle("settings:update", (_event, payload) => {
    if (!payload || typeof payload !== "object") {
      return { status: "error", message: "settings:update payload must be { key, value }" };
    }
    return settingsController.applyUpdate(payload.key, payload.value);
  });
  handle("settings:begin-size-preview", () => settingsSizePreviewSession.begin());
  handle("settings:preview-size", (_event, value) => {
    if (!isValidSizePreviewKey(value)) {
      return { status: "error", message: `invalid preview size "${value}"` };
    }
    return settingsSizePreviewSession.preview(value).then(() => ({ status: "ok" }));
  });
  handle("settings:end-size-preview", (_event, value) => {
    if (value !== null && value !== undefined && !isValidSizePreviewKey(value)) {
      return { status: "error", message: `invalid preview size "${value}"` };
    }
    return settingsSizePreviewSession.end(value || null);
  });
  // Transient textScale preview while the slider drags: applies zoom to live
  // windows but never writes the store. Commit still goes through
  // settings:update so the controller stays the only writer.
  handle("settings:preview-text-scale", (_event, value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      return { status: "error", message: `invalid text scale "${value}"` };
    }
    return previewTextScale(n);
  });
  handle("settings:end-text-scale-preview", () => endTextScalePreview());
  // textScale is per-display; the renderer can't resolve its own display, so
  // the slider asks main for the committed value of the display the settings
  // window currently sits on.
  handle("settings:get-text-scale-context", () => getTextScaleContext());
  handle("settings:get-size-context", () => getSizeContext());
  handle("settings:get-preview-sound-url", () => {
    try { return themeLoader.getPreviewSoundUrl(); }
    catch { return null; }
  });
  handle("settings:command", async (event, payload) => {
    if (!payload || typeof payload !== "object") {
      return { status: "error", message: "settings:command payload must be { action, payload }" };
    }
    return settingsController.applyCommand(payload.action, payload.payload);
  });

  handle("settings:pick-sound-file", async (event, payload) => {
    if (!payload || typeof payload !== "object") {
      return { status: "error", message: "pickSoundFile payload must be an object" };
    }
    const { soundName } = payload;
    if (typeof soundName !== "string" || !soundName) {
      return { status: "error", message: "pickSoundFile.soundName must be a non-empty string" };
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(soundName)) {
      return { status: "error", message: `pickSoundFile.soundName "${soundName}" contains invalid characters` };
    }

    const activeTheme = getActiveTheme();
    if (!activeTheme) return { status: "error", message: "no active theme" };
    const themeId = activeTheme._id;
    if (!isPlainObject(activeTheme.sounds) || !activeTheme.sounds[soundName]) {
      return { status: "error", message: `sound "${soundName}" not declared by theme "${themeId}"` };
    }
    const overridesDir = themeLoader.getSoundOverridesDir(themeId);
    if (!overridesDir) return { status: "error", message: "sound-overrides directory unavailable" };

    const lang = getLang();
    const strings = SOUND_OVERRIDE_DIALOG_STRINGS[lang] || SOUND_OVERRIDE_DIALOG_STRINGS.en;
    const extList = [...SOUND_OVERRIDE_ASSET_EXTS].map((ext) => ext.slice(1));
    let result;
    try {
      result = await dialog.showOpenDialog(getDialogParent(event), {
        title: strings.title,
        filters: [{ name: strings.filterName, extensions: extList }],
        properties: ["openFile"],
      });
    } catch (err) {
      return { status: "error", message: `pick dialog failed: ${err && err.message}` };
    }
    if (result.canceled || !result.filePaths || !result.filePaths[0]) {
      return { status: "cancel" };
    }

    const sourcePath = result.filePaths[0];
    const ext = path.extname(sourcePath).toLowerCase();
    if (!SOUND_OVERRIDE_ASSET_EXTS.has(ext)) {
      return { status: "error", message: `unsupported audio extension: ${ext || "(none)"}` };
    }

    try { fs.mkdirSync(overridesDir, { recursive: true }); }
    catch (err) { return { status: "error", message: `mkdir failed: ${err && err.message}` }; }

    const destFilename = `${soundName}${ext}`;
    const destPath = path.join(overridesDir, destFilename);
    try {
      fs.copyFileSync(sourcePath, destPath);
    } catch (err) {
      return { status: "error", message: `copy failed: ${err && err.message}` };
    }
    cleanupSiblingSoundOverrides(fs, path, overridesDir, soundName, ext);

    const cmdResult = await settingsController.applyCommand("setSoundOverride", {
      themeId,
      soundName,
      file: destFilename,
      originalName: path.basename(sourcePath),
    });
    if (!cmdResult || cmdResult.status !== "ok") {
      return cmdResult || { status: "error", message: "setSoundOverride failed" };
    }
    rememberRuntimeSoundOverrideFile({ getActiveTheme }, themeId, soundName, destPath);
    const newUrl = themeLoader.getSoundUrl(soundName);
    if (newUrl) {
      sendToRenderer("invalidate-sound-cache", newUrl);
      sendToRenderer("preload-sounds", { urls: [newUrl] });
    }
    return { status: "ok", file: destFilename };
  });

  handle("settings:preview-sound", (_event, payload) => {
    if (!payload || typeof payload !== "object") {
      return { status: "error", message: "previewSound payload must be an object" };
    }
    const { soundName } = payload;
    if (typeof soundName !== "string" || !soundName) {
      return { status: "error", message: "previewSound.soundName must be a non-empty string" };
    }
    if (getDoNotDisturb()) return { status: "skipped", reason: "dnd" };
    if (getSoundMuted()) return { status: "skipped", reason: "muted" };
    const url = themeLoader.getSoundUrl(soundName);
    if (!url) return { status: "error", message: "sound unavailable" };
    const bustedUrl = `${url}${url.includes("?") ? "&" : "?"}_t=${now()}`;
    sendToRenderer("play-sound", { url: bustedUrl, volume: getSoundVolume() });
    return { status: "ok" };
  });

  handle("settings:open-sound-overrides-dir", async () => {
    const activeTheme = getActiveTheme();
    if (!activeTheme) return { status: "error", message: "no active theme" };
    const dir = themeLoader.getSoundOverridesDir(activeTheme._id);
    if (!dir) return { status: "error", message: "sound-overrides directory unavailable" };
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    const openResult = await shell.openPath(dir);
    if (openResult) return { status: "error", message: openResult };
    return { status: "ok", path: dir };
  });

  handle("settings:list-themes", () => {
    try {
      const activeTheme = getActiveTheme();
      const activeId = activeTheme ? activeTheme._id : "clawd";
      return themeLoader.listThemesWithMetadata().map((theme) => {
        const active = theme.id === activeId;
        const runtimeCapabilities = active
          && activeTheme
          && isPlainObject(activeTheme._capabilities)
          ? activeTheme._capabilities
          : null;
        return {
          ...theme,
          active,
          ...(runtimeCapabilities
            ? { capabilities: { ...(theme.capabilities || {}), ...runtimeCapabilities } }
            : {}),
        };
      });
    } catch (err) {
      console.warn("omp-pet: settings:list-themes failed:", err && err.message);
      return [];
    }
  });

  handle("settings:open-user-themes-dir", async () => {
    const dir = typeof themeLoader.ensureUserThemesDir === "function"
      ? themeLoader.ensureUserThemesDir()
      : null;
    if (!dir) return { status: "error", message: "user themes directory unavailable" };
    const openResult = await shell.openPath(dir);
    if (openResult) return { status: "error", message: openResult };
    return { status: "ok", path: dir };
  });

  handle("settings:confirm-remove-theme", async (event, themeId) => {
    if (typeof themeId !== "string" || !themeId) return { confirmed: false };
    const meta = themeLoader.getThemeMetadata(themeId);
    const displayName = (meta && meta.name) || themeId;
    const lang = getLang();
    const strings = REMOVE_THEME_DIALOG_STRINGS[lang] || REMOVE_THEME_DIALOG_STRINGS.en;
    try {
      const { response } = await dialog.showMessageBox(getDialogParent(event), {
        type: "warning",
        buttons: [strings.delete, strings.cancel],
        defaultId: 1,
        cancelId: 1,
        message: strings.message(displayName),
        detail: strings.detail,
        noLink: true,
      });
      return { confirmed: response === 0 };
    } catch (err) {
      console.warn("omp-pet: confirm-remove-theme dialog failed:", err && err.message);
      return { confirmed: false };
    }
  });

  handle("settings:list-agents", () => {
    try {
      return getAllAgents().map(mapAgentMetadata);
    } catch (err) {
      console.warn("omp-pet: settings:list-agents failed:", err && err.message);
      return [];
    }
  });

  handle("settings:recent-agent-activity", (_event, agentId) => {
    if (typeof agentId !== "string" || !agentId) return null;
    try {
      const accepted = getRecentHookEvents({ agentId })
        .filter((event) => event && event.route === "state" && event.outcome === "accepted");
      const last = accepted.length > 0 ? accepted[accepted.length - 1] : null;
      return last ? { timestamp: last.timestamp, eventType: last.eventType } : null;
    } catch {
      return null;
    }
  });

  handle("settings:detect-agent-installations", async () => {
    try {
      const detectorOptions = { fs, path, now, snapshot: settingsController.getSnapshot() };
      return detectAgentInstallations(detectorOptions);
    } catch (err) {
      console.warn("omp-pet: settings:detect-agent-installations failed:", err && err.message);
      return {
        checkedAt: now(),
        agents: [],
        error: err && err.message ? err.message : String(err),
      };
    }
  });

  handle("settings:get-about-info", () => {
    let heroSvgContent = "";
    try {
      heroSvgContent = fs.readFileSync(aboutHeroSvgPath, "utf8");
    } catch (err) {
      console.warn("omp-pet: failed to read about hero SVG:", err && err.message);
    }
    return {
      version: app.getVersion(),
      repoUrl: "https://github.com/fberbert/omp-pet",
      license: "AGPL-3.0",
      authorName: "Fábio Berbert de Paula",
      authorUrl: "https://github.com/fberbert",
      heroSvgContent,
    };
  });

  // #1183/#1275: Settings compares launch values with saved preferences to
  // offer a restart for GPU mode and macOS pet topmost changes.
  handle("settings:get-startup-render-state", () => ({
    hardwareAccelerationDisabled: getHardwareAccelerationDisabledAtStartup() === true,
    petAlwaysOnTop: getPetAlwaysOnTopAtStartup(),
  }));

  handle("settings:show-tutorial", async () => {
    try {
      const result = await showTutorial();
      return result || { status: "ok" };
    } catch (err) {
      return { status: "error", message: (err && err.message) || String(err) };
    }
  });


  handle("settings:open-external", async (_event, url) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      return { status: "error", message: "Invalid URL" };
    }
    try {
      await shell.openExternal(url);
      return { status: "ok" };
    } catch (err) {
      return { status: "error", message: (err && err.message) || String(err) };
    }
  });

  return {
    dispose() {
      while (disposers.length) {
        const dispose = disposers.pop();
        try { dispose(); } catch {}
      }
    },
  };
}

module.exports = {
  registerSettingsIpc,
};
