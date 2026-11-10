// Shared constants and helpers for the omp-pet local server, its runtime file
// and the OMP installer. Node built-ins only.

const fs = require("fs");
const os = require("os");
const path = require("path");

const CLAWD_SERVER_ID = "omp-pet";
const CLAWD_SERVER_HEADER = "x-omp-pet-server";
// Own range, disjoint from upstream Clawd on Desk (23333-23337), so both apps
// can run side by side without answering each other's hooks.
const DEFAULT_SERVER_PORT = 23533;
// Per-user data directory under $HOME (runtime.json, roam area, port hint).
const APP_DATA_DIR_NAME = ".omp-pet";
const SERVER_PORT_COUNT = 5;
const SERVER_PORTS = Array.from({ length: SERVER_PORT_COUNT }, (_, i) => DEFAULT_SERVER_PORT + i);
const STATE_PATH = "/state";

const RUNTIME_REASON_MISSING = "runtime-missing";
const RUNTIME_REASON_APP_MISMATCH = "runtime-app-mismatch";
const RUNTIME_REASON_PORT_INVALID = "runtime-port-invalid";
const RUNTIME_REASON_OWNER_INVALID = "runtime-owner-invalid";

function normalizePort(value) {
  if (typeof value !== "number" && (typeof value !== "string" || !/^[1-9][0-9]{0,4}$/.test(value))) return null;
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function normalizeOwnerPid(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function defaultRuntimeConfigPath(options = {}) {
  const homeDir = typeof options.homeDir === "string" ? options.homeDir : os.homedir();
  return path.join(homeDir, APP_DATA_DIR_NAME, "runtime.json");
}

// ── runtime.json ─────────────────────────────────────────────────────────────
// The file carries app + port + ownerPid. It is a discovery hint for the OMP
// extension, not an authentication or ownership proof: any process running as
// this user can write it, and a PID can be reused.

// Parse + validate in one place so readRuntimePort and readRuntimeIdentity can
// never disagree about what a well-formed file looks like.
function parseRuntimeConfig(options = {}) {
  const readFileSync = options.readFileSync || fs.readFileSync;
  const filePath = options.runtimeConfigPath || defaultRuntimeConfigPath(options);
  let raw;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return { ok: false, reason: RUNTIME_REASON_MISSING, port: null, ownerPid: null };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: RUNTIME_REASON_MISSING, port: null, ownerPid: null };
  }
  if (raw.app !== CLAWD_SERVER_ID) {
    return { ok: false, reason: RUNTIME_REASON_APP_MISMATCH, port: null, ownerPid: null };
  }
  const port = normalizePort(raw.port);
  if (!port) {
    return { ok: false, reason: RUNTIME_REASON_PORT_INVALID, port: null, ownerPid: null };
  }
  return { ok: true, reason: null, port, ownerPid: normalizeOwnerPid(raw.ownerPid) };
}

function readRuntimeConfig(options = {}) {
  const parsed = parseRuntimeConfig(options);
  return parsed.ok ? { port: parsed.port } : null;
}

function readRuntimePort(options = {}) {
  const config = readRuntimeConfig(options);
  return config ? config.port : null;
}

// Strict identity used by Doctor: requires app + port + ownerPid. ok=true does
// not mean the owner is alive; the caller checks that.
function readRuntimeIdentity(options = {}) {
  const parsed = parseRuntimeConfig(options);
  if (!parsed.ok) return { ok: false, reason: parsed.reason, port: null, ownerPid: null };
  if (!parsed.ownerPid) {
    return { ok: false, reason: RUNTIME_REASON_OWNER_INVALID, port: parsed.port, ownerPid: null };
  }
  return { ok: true, reason: null, port: parsed.port, ownerPid: parsed.ownerPid };
}

// Boolean contract: true on success, false on ANY failure, never throws.
function writeRuntimeConfig(port, options = {}) {
  const safePort = normalizePort(port);
  if (!safePort) return false;

  const fsApi = options.fs || fs;
  const filePath = options.runtimeConfigPath || defaultRuntimeConfigPath(options);
  const ownerPid = normalizeOwnerPid(options.ownerPid) || process.pid;
  const dir = path.dirname(filePath);
  const tmpPath = path.join(dir, `.runtime.${process.pid}.${Date.now()}.tmp`);
  const body = JSON.stringify({ app: CLAWD_SERVER_ID, port: safePort, ownerPid }, null, 2);
  try {
    fsApi.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fsApi.writeFileSync(tmpPath, body, { encoding: "utf8", mode: 0o600 });
    fsApi.renameSync(tmpPath, filePath);
    return true;
  } catch {
    try { fsApi.unlinkSync(tmpPath); } catch {}
    return false;
  }
}

// Owner-guarded: an installed build and a dev build can both run, and whoever
// started last owns the file. An earlier instance quitting later must not tear
// down the survivor's identity, so the unlink happens only when the file's
// ownerPid is ours. Files without ownerPid and corrupt files are residue and
// still get cleaned.
function clearRuntimeConfig(filePath, options = {}) {
  const targetPath = filePath || defaultRuntimeConfigPath(options);
  const ownPid = normalizeOwnerPid(options.ownerPid) || process.pid;
  try {
    const raw = JSON.parse(fs.readFileSync(targetPath, "utf8"));
    const filePid = normalizeOwnerPid(raw && raw.ownerPid);
    if (filePid && filePid !== ownPid) return false;
  } catch {
    // Missing: the unlink below reports false. Corrupt/unreadable: clean it.
  }
  try {
    fs.unlinkSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

function getPortCandidates(preferredPort, options = {}) {
  const ports = [];
  const seen = new Set();
  const runtimePort = normalizePort(
    Object.prototype.hasOwnProperty.call(options, "runtimePort")
      ? options.runtimePort
      : readRuntimePort()
  );
  const add = (value) => {
    const port = normalizePort(value);
    if (!port || seen.has(port)) return;
    seen.add(port);
    ports.push(port);
  };

  if (Array.isArray(preferredPort)) preferredPort.forEach(add);
  else add(preferredPort);
  add(runtimePort);
  SERVER_PORTS.forEach(add);
  return ports;
}

// ── Node binary discovery ────────────────────────────────────────────────────
// Electron's process.execPath is the Electron binary, so the installer looks
// for the user's node to locate the OMP launcher next to it.

function joinPosixPath(...parts) {
  return path.posix.join(...parts.filter((part) => typeof part === "string" && part.length > 0));
}

function parseNodeVersionName(value) {
  const match = String(value || "").match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[.-].*)?$/);
  if (!match) return null;
  return [Number(match[1]) || 0, Number(match[2]) || 0, Number(match[3]) || 0];
}

function compareVersionNamesDesc(a, b) {
  const av = parseNodeVersionName(a);
  const bv = parseNodeVersionName(b);
  if (!av && !bv) return String(b).localeCompare(String(a));
  if (!av) return 1;
  if (!bv) return -1;
  for (let i = 0; i < 3; i++) {
    const delta = (bv[i] || 0) - (av[i] || 0);
    if (delta !== 0) return delta;
  }
  return String(b).localeCompare(String(a));
}

function readNodeVersionDirsSync(baseDir, options = {}) {
  const readdirSync = options.readdirSync || fs.readdirSync;
  try {
    return readdirSync(baseDir)
      .filter((entry) => typeof entry === "string" && parseNodeVersionName(entry))
      .sort(compareVersionNamesDesc);
  } catch {
    return [];
  }
}

function getManagedNodeCandidatesSync(homeDir, options = {}) {
  const candidates = [
    joinPosixPath(homeDir, ".volta", "bin", "node"),
    joinPosixPath(homeDir, ".local", "bin", "node"),
    joinPosixPath(homeDir, ".nvm", "current", "bin", "node"),
  ];
  const versionedRoots = [
    { root: joinPosixPath(homeDir, ".nvm", "versions", "node"), suffix: ["bin", "node"] },
    { root: joinPosixPath(homeDir, ".fnm", "node-versions"), suffix: ["installation", "bin", "node"] },
    { root: joinPosixPath(homeDir, ".local", "share", "fnm", "node-versions"), suffix: ["installation", "bin", "node"] },
    { root: joinPosixPath(homeDir, ".asdf", "installs", "nodejs"), suffix: ["bin", "node"] },
  ];
  for (const { root, suffix } of versionedRoots) {
    for (const versionDir of readNodeVersionDirsSync(root, options)) {
      candidates.push(joinPosixPath(root, versionDir, ...suffix));
    }
  }
  candidates.push(
    joinPosixPath(homeDir, ".asdf", "shims", "node"),
    joinPosixPath(homeDir, ".mise", "shims", "node"),
    joinPosixPath(homeDir, ".local", "share", "mise", "shims", "node"),
  );
  return candidates;
}

function getShellCandidates(options = {}) {
  const candidates = [];
  const add = (value) => {
    if (typeof value !== "string" || !value.startsWith("/")) return;
    if (!candidates.includes(value)) candidates.push(value);
  };
  add(options.shellPath);
  add(options.env && options.env.SHELL);
  add(process.env.SHELL);
  add("/bin/zsh");
  add("/bin/bash");
  add("/bin/sh");
  return candidates;
}

function extractAbsolutePathFromShellOutput(raw) {
  const lines = String(raw || "").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith("/") && !/[\s"'$`]/.test(line)) return line;
  }
  return null;
}

/**
 * Resolve the absolute path to the user's Node.js binary.
 * @returns {string|null} absolute path, or null when detection fails
 */
function resolveNodeBin(options = {}) {
  const isElectron = options.isElectron !== undefined
    ? options.isElectron
    : !!process.versions.electron;

  // Plain Node.js: process.execPath IS the node binary.
  if (!isElectron) return options.execPath || process.execPath;

  const homeDir = options.homeDir || os.homedir();
  const access = options.accessSync || fs.accessSync;
  const candidates = [
    "/usr/local/bin/node",
    ...getManagedNodeCandidatesSync(homeDir, options),
    "/usr/bin/node",
  ];
  for (const candidate of candidates) {
    try {
      access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }

  // Login + interactive shell: nvm/fnm initialize in rc files, not profiles.
  const execFileSync = options.execFileSync || require("child_process").execFileSync;
  for (const shell of getShellCandidates(options)) {
    try {
      const raw = execFileSync(shell, ["-lic", "command -v node 2>/dev/null; which node 2>/dev/null; true"], {
        encoding: "utf8",
        timeout: 5000,
      });
      const resolved = extractAbsolutePathFromShellOutput(raw);
      if (resolved) {
        access(resolved, fs.constants.X_OK);
        return resolved;
      }
    } catch {}
  }
  return null;
}

module.exports = {
  APP_DATA_DIR_NAME,
  CLAWD_SERVER_HEADER,
  CLAWD_SERVER_ID,
  DEFAULT_SERVER_PORT,
  SERVER_PORTS,
  STATE_PATH,
  clearRuntimeConfig,
  defaultRuntimeConfigPath,
  getPortCandidates,
  normalizeLocalPort: normalizePort,
  readRuntimeConfig,
  readRuntimeIdentity,
  readRuntimePort,
  resolveNodeBin,
  writeRuntimeConfig,
};
