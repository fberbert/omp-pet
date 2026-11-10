#!/usr/bin/env node
"use strict";

// Installs the omp-pet <-> OMP (oh-my-pi) extension into
// ~/.omp/agent/extensions/omp-pet/. A directory is only updated or removed when
// it carries the omp-pet managed marker.

const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");
const { asarUnpackedPath, writeJsonAtomic } = require("./json-utils");
const { resolveNodeBin } = require("./server-config");

const EXTENSION_DIR_NAME = "omp-pet";
const EXTENSION_FILE = "index.ts";
const CORE_FILE = "omp-extension-core.js";
const MARKER_FILE = ".omp-pet-managed.json";
const OMP_CONFIG_DIR_NAME = ".omp";
const PROFILES_DIR_NAME = "profiles";
const AGENT_DIR_NAME = "agent";
const EXTENSIONS_DIR_NAME = "extensions";
const DEFAULT_PARENT_DIR = path.join(os.homedir(), OMP_CONFIG_DIR_NAME, AGENT_DIR_NAME);
const DEFAULT_EXTENSIONS_DIR = path.join(DEFAULT_PARENT_DIR, EXTENSIONS_DIR_NAME);
const DEFAULT_EXTENSION_DIR = path.join(DEFAULT_EXTENSIONS_DIR, EXTENSION_DIR_NAME);

function resolveSourcePath(fileName, baseDir = __dirname) {
  return asarUnpackedPath(path.resolve(baseDir, fileName));
}

function writeTextAtomic(filePath, text) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmpPath = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(tmpPath, text, "utf8");
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch {}
    throw err;
  }
}

function fileExists(filePath, fsImpl = fs) {
  try {
    return fsImpl.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function dirExists(dirPath, fsImpl = fs) {
  try {
    return fsImpl.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function readJsonIfPresent(filePath, fsImpl = fs) {
  try {
    const raw = fsImpl.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isManagedMarker(value) {
  return !!(
    value
    && value.app === "omp-pet"
    && value.integration === "omp"
    && value.managed === true
  );
}

function buildMarker() {
  return {
    app: "omp-pet",
    integration: "omp",
    managed: true,
    version: 1,
    installedAt: new Date().toISOString(),
  };
}

function commandExists(command, args, options = {}) {
  const execFileSync = options.execFileSync || childProcess.execFileSync;
  try {
    const timeout = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 1500;
    const raw = execFileSync(command, args, {
      encoding: "utf8",
      timeout,
    });
    return String(raw || "").trim().length > 0;
  } catch {
    return false;
  }
}

function executableExists(filePath, accessSync = fs.accessSync) {
  try {
    accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function hasOmpCommand(options = {}) {
  if (typeof options.ompCommandAvailable === "boolean") return options.ompCommandAvailable;
  if (typeof options.ompCommandAvailable === "function") return !!options.ompCommandAvailable();

  const accessSync = options.accessSync || fs.accessSync;
  const execFileSync = options.execFileSync || childProcess.execFileSync;
  const nodeBin = Object.prototype.hasOwnProperty.call(options, "nodeBin")
    ? options.nodeBin
    : resolveNodeBin({ execFileSync, accessSync });

  // OMP installs its launcher next to the node binary for npm/bun global
  // installs; a login shell lookup covers everything else.
  if (nodeBin && nodeBin !== "node" && executableExists(path.join(path.dirname(nodeBin), "omp"), accessSync)) {
    return true;
  }

  for (const shell of ["/bin/zsh", "/bin/bash"]) {
    if (commandExists(shell, ["-lic", "command -v omp"], { execFileSync })) return true;
  }
  return commandExists("sh", ["-lc", "command -v omp"], { execFileSync });
}

// OMP resolves user extensions through the ACTIVE agent directory, not a fixed
// path: the config root is <home>/<PI_CONFIG_DIR or ".omp">, a named profile
// selected by the PRESENCE of OMP_PROFILE (falling back to PI_PROFILE only when
// it is undefined) lives under profiles/<name>, and PI_CODING_AGENT_DIR
// relocates the profile-less default. OMP treats "default" as the default
// profile sentinel. Mirroring those details here keeps install, uninstall, the
// installation detector and Doctor pointing at the directory OMP actually
// loads. A directory OMP never reads would otherwise report a successful
// install.
//
// A profile name is a validated slug. OMP's module-load resolver catches an
// invalid value and uses the default profile, so this non-CLI installer does the
// same rather than throwing before Settings can report a result.
const PROFILE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
// OMP rejects these device names on every platform, so the installer does too.
const WINDOWS_RESERVED_NAME_PATTERN = /^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\..*)?$/i;

function normalizeOmpProfileName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name === "default") return null;
  if (name === "." || name === ".." || name.endsWith(".")) return null;
  if (!PROFILE_NAME_PATTERN.test(name)) return null;
  if (WINDOWS_RESERVED_NAME_PATTERN.test(name)) return null;
  return name;
}

function resolveOmpEnvironment(options = {}) {
  const env = options.env && typeof options.env === "object" ? options.env : process.env;
  const homeDir = typeof options.homeDir === "string" && options.homeDir
    ? options.homeDir
    : os.homedir();
  const configuredRoot = typeof env.PI_CONFIG_DIR === "string" ? env.PI_CONFIG_DIR : "";
  // OMP always joins the name under the home directory, even when the value
  // looks absolute, so an absolute-looking value must not escape it here.
  const root = path.join(homeDir, configuredRoot || OMP_CONFIG_DIR_NAME);
  const rawProfile = env.OMP_PROFILE !== undefined ? env.OMP_PROFILE : env.PI_PROFILE;
  const profile = normalizeOmpProfileName(rawProfile);
  return {
    env,
    homeDir,
    root,
    profile,
    configRoot: profile ? path.join(root, PROFILES_DIR_NAME, profile) : root,
  };
}

// The agent directory OMP would load extensions from for this environment.
function resolveOmpAgentDir(options = {}) {
  if (typeof options.parentDir === "string" && options.parentDir) return options.parentDir;
  const { env, root, configRoot, profile } = resolveOmpEnvironment(options);
  const defaultAgentDir = path.join(configRoot, AGENT_DIR_NAME);
  // An active profile owns its directory outright: OMP ignores
  // PI_CODING_AGENT_DIR while one is set.
  if (profile) return defaultAgentDir;
  let override = typeof env.PI_CODING_AGENT_DIR === "string"
    ? env.PI_CODING_AGENT_DIR
    : "";
  // setProfile("work") exports PI_PROFILE=work together with the derived
  // PI_CODING_AGENT_DIR. A child can explicitly select the default profile via
  // OMP_PROFILE=default/empty while inheriting both legacy values. OMP detects
  // that derived override and discards it; otherwise default mode would keep
  // loading the profile directory it explicitly bypassed.
  const legacyProfile = normalizeOmpProfileName(env.PI_PROFILE);
  const legacyProfileAgentDir = legacyProfile
    ? path.join(root, PROFILES_DIR_NAME, legacyProfile, AGENT_DIR_NAME)
    : null;
  if (legacyProfileAgentDir && override === legacyProfileAgentDir) override = "";
  return override ? path.resolve(override) : defaultAgentDir;
}

// Every OTHER loadable profile on this machine, i.e. the agent directories
// this installation does NOT manage. omp-pet resolves exactly one, so a machine
// that runs OMP under a profile loads nothing from it; Doctor says so rather
// than reporting bare "verified".
function listOtherOmpProfileAgentDirs(options = {}) {
  const fsImpl = options.fs || fs;
  const { root } = resolveOmpEnvironment(options);
  const managed = path.resolve(resolveOmpAgentDir(options));
  const dirs = [];
  const defaultAgentDir = path.join(root, AGENT_DIR_NAME);
  if (path.resolve(defaultAgentDir) !== managed && dirExists(defaultAgentDir, fsImpl)) {
    dirs.push({ profile: "default", agentDir: defaultAgentDir });
  }
  const profilesDir = path.join(root, PROFILES_DIR_NAME);
  let entries;
  try {
    entries = fsImpl.readdirSync(profilesDir, { withFileTypes: true });
  } catch {
    // No profiles directory (the common case) or an fs double without
    // readdirSync: the default profile above may still need reporting.
    return dirs;
  }
  for (const entry of entries) {
    if (!entry || typeof entry.isDirectory !== "function" || !entry.isDirectory()) continue;
    const profile = normalizeOmpProfileName(entry.name);
    // normalizeOmpProfileName mirrors OMP's env parser, which trims names.
    // A filesystem entry such as "work " can therefore never be selected as
    // that directory: OMP resolves OMP_PROFILE="work " to profiles/work.
    if (!profile || profile !== entry.name) continue;
    const agentDir = path.join(profilesDir, entry.name, AGENT_DIR_NAME);
    if (path.resolve(agentDir) === managed) continue;
    if (!dirExists(agentDir, fsImpl)) continue;
    dirs.push({ profile, agentDir });
  }
  // readdir order is filesystem-defined; the Doctor detail renders this list,
  // so pin it to a stable order instead of whatever the directory happens to
  // return.
  return dirs.sort((a, b) => a.profile.localeCompare(b.profile));
}

function resolveExtensionsDir(options = {}) {
  if (options.extensionDir) return path.dirname(options.extensionDir);
  return path.join(resolveOmpAgentDir(options), EXTENSIONS_DIR_NAME);
}

function resolveExtensionDir(options = {}) {
  return options.extensionDir || path.join(resolveExtensionsDir(options), EXTENSION_DIR_NAME);
}

function readSourceFiles(options = {}) {
  const sourceDir = options.sourceDir || __dirname;
  const extensionPath = options.extensionSourcePath || resolveSourcePath("omp-extension.ts", sourceDir);
  const corePath = options.coreSourcePath || resolveSourcePath(CORE_FILE, sourceDir);
  return {
    extensionPath,
    corePath,
    extensionText: fs.readFileSync(extensionPath, "utf8"),
    coreText: fs.readFileSync(corePath, "utf8"),
  };
}

function registerOmpExtension(options = {}) {
  const fsImpl = options.fs || fs;
  const parentDir = resolveOmpAgentDir(options);
  const extensionDir = resolveExtensionDir(options);
  const markerPath = path.join(extensionDir, MARKER_FILE);
  const extensionPath = path.join(extensionDir, EXTENSION_FILE);
  const corePath = path.join(extensionDir, CORE_FILE);

  const parentExists = dirExists(parentDir, fsImpl);
  if (!parentExists && !hasOmpCommand(options)) {
    if (!options.silent) {
      console.log("omp-pet: OMP not found - skipping OMP extension registration");
    }
    return { installed: false, skipped: true, updated: false, reason: "omp-not-found", extensionDir };
  }

  const extensionExists = dirExists(extensionDir, fsImpl);
  if (extensionExists && !isManagedMarker(readJsonIfPresent(markerPath, fsImpl))) {
    if (!options.silent) {
      console.log(`omp-pet: ${extensionDir} exists but is not managed by omp-pet - skipping`);
    }
    return { installed: false, skipped: true, updated: false, reason: "unmanaged-existing-extension", extensionDir };
  }

  const { extensionText, coreText } = readSourceFiles(options);
  const previousExtension = fileExists(extensionPath, fsImpl) ? fsImpl.readFileSync(extensionPath, "utf8") : null;
  const previousCore = fileExists(corePath, fsImpl) ? fsImpl.readFileSync(corePath, "utf8") : null;
  const updated = previousExtension !== extensionText || previousCore !== coreText;

  fsImpl.mkdirSync(extensionDir, { recursive: true });
  writeTextAtomic(extensionPath, extensionText);
  writeTextAtomic(corePath, coreText);
  writeJsonAtomic(markerPath, buildMarker());

  if (!options.silent) {
    console.log(`omp-pet OMP extension -> ${extensionDir}`);
    console.log(updated ? "  Installed or updated" : "  Already up to date");
  }

  return { installed: true, skipped: false, updated, extensionDir };
}

function unregisterOmpExtension(options = {}) {
  const fsImpl = options.fs || fs;
  const extensionDir = resolveExtensionDir(options);
  const markerPath = path.join(extensionDir, MARKER_FILE);
  const marker = readJsonIfPresent(markerPath, fsImpl);
  if (!dirExists(extensionDir, fsImpl)) {
    if (!options.silent) console.log("omp-pet: OMP extension is not installed");
    return { removed: false, skipped: true, reason: "missing", extensionDir };
  }
  if (!isManagedMarker(marker)) {
    if (!options.silent) console.log(`omp-pet: ${extensionDir} is not managed by omp-pet - skipping uninstall`);
    return { removed: false, skipped: true, reason: "unmanaged-existing-extension", extensionDir };
  }
  fsImpl.rmSync(extensionDir, { recursive: true, force: true });
  if (!options.silent) console.log(`omp-pet: removed OMP extension from ${extensionDir}`);
  return { removed: true, skipped: false, extensionDir };
}

module.exports = {
  CORE_FILE,
  resolveExtensionsDir,
  DEFAULT_EXTENSION_DIR,
  DEFAULT_EXTENSIONS_DIR,
  DEFAULT_PARENT_DIR,
  EXTENSION_DIR_NAME,
  EXTENSIONS_DIR_NAME,
  EXTENSION_FILE,
  MARKER_FILE,
  buildMarker,
  hasOmpCommand,
  isManagedMarker,
  listOtherOmpProfileAgentDirs,
  registerOmpExtension,
  resolveExtensionDir,
  resolveOmpAgentDir,
  resolveOmpEnvironment,
  resolveSourcePath,
  unregisterOmpExtension,
  writeTextAtomic,
};

if (require.main === module) {
  try {
    if (process.argv.includes("--uninstall")) {
      unregisterOmpExtension({});
    } else {
      registerOmpExtension({});
    }
  } catch (err) {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  }
}
