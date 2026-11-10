// src/server.js - local HTTP server for the OMP extension (/state).
//
// Binds 127.0.0.1 on the first free port of the omp-pet range, publishes the
// actual port in ~/.omp-pet/runtime.json for the extension, and routes state
// events into the agent runtime. After the server listens it syncs the OMP
// extension when the integration is installed and enabled.

const http = require("http");
const {
  DEFAULT_SERVER_PORT,
  SERVER_PORTS,
  normalizeLocalPort,
  defaultRuntimeConfigPath,
  clearRuntimeConfig,
  getPortCandidates,
  readRuntimeIdentity,
  readRuntimePort,
  writeRuntimeConfig,
} = require("../hooks/server-config");
const { createIntegrationSyncRuntime } = require("./integration-sync");
const {
  sendStateHealthResponse,
  handleStatePost,
} = require("./server-route-state");
const {
  createSingleRequestHookEventRecorder,
  recordHookEventInBuffer,
  getRecentHookEventsFromBuffer,
} = require("./server-hook-events");

// Liveness probe without spawning: process.kill(pid, 0) is a syscall.
// ESRCH => gone; EPERM => alive but owned by another user.
function processAlive(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (e) {
    return !!(e && e.code === "EPERM");
  }
}

const LOCAL_HOOK_REJECT_LOG_INTERVAL_MS = 30 * 1000;

module.exports = function initServer(ctx) {

const createHttpServer = ctx.createHttpServer || http.createServer.bind(http);
const setImmediateFn = ctx.setImmediate || setImmediate;
const nowFn = typeof ctx.now === "function" ? ctx.now : Date.now;
const clearRuntimeConfigFn = ctx.clearRuntimeConfig || clearRuntimeConfig;
const getPortCandidatesFn = ctx.getPortCandidates || getPortCandidates;
const readRuntimePortFn = ctx.readRuntimePort || readRuntimePort;
const writeRuntimeConfigFn = ctx.writeRuntimeConfig || writeRuntimeConfig;
// Opt-in production IO: tests never read or overwrite the user's restart hint.
const readPortHint = ctx.readLocalServerPortHint || (() => null);
const writePortHint = ctx.writeLocalServerPortHint || (() => true);
// Injectable so tests never read the developer's real ~/.omp-pet/runtime.json.
const readRuntimeIdentityFn = ctx.readRuntimeIdentity
  || (() => readRuntimeIdentity({ runtimeConfigPath: ctx.runtimeConfigPath }));
const isProcessAliveFn = ctx.isProcessAlive || processAlive;

function writeCurrentRuntimeConfig(port) {
  return writeRuntimeConfigFn(port);
}

function runtimeConfigFilePath() {
  return typeof ctx.runtimeConfigPath === "string"
    ? ctx.runtimeConfigPath
    : defaultRuntimeConfigPath();
}

let httpServer = null;
let activeServerPort = null;
let bindAttempts = [];
let startupFailure = null;
const recentHookEvents = new Map();
const localHookRejectTelemetry = new Map();

function shouldDropForDnd() {
  if (typeof ctx.shouldDropForDnd === "function") {
    try {
      return !!ctx.shouldDropForDnd();
    } catch {}
  }
  return !!ctx.doNotDisturb;
}

function recordHookEvent(identity, data, route, outcome) {
  return recordHookEventInBuffer(recentHookEvents, identity, data, route, outcome, { now: nowFn });
}

function createRequestHookRecorder(identity, data, defaultRoute) {
  return createSingleRequestHookEventRecorder(recordHookEvent, identity, data, defaultRoute);
}

function getRecentHookEvents(options = {}) {
  return getRecentHookEventsFromBuffer(recentHookEvents, options);
}

function clearRecentHookEvents(agentId) {
  if (typeof agentId === "string" && agentId) recentHookEvents.delete(agentId);
  else recentHookEvents.clear();
}

function shouldSyncAgentIntegration(agentId) {
  if (typeof ctx.shouldSyncAgentIntegration === "function") {
    return ctx.shouldSyncAgentIntegration(agentId) !== false;
  }
  if (typeof ctx.isAgentEnabled === "function") return ctx.isAgentEnabled(agentId) !== false;
  return true;
}

function getHookServerPort() {
  if (activeServerPort) return activeServerPort;
  const runtime = readRuntimePortFn();
  return SERVER_PORTS.includes(runtime) ? runtime : DEFAULT_SERVER_PORT;
}

function getRuntimeStatus() {
  let address = null;
  try {
    address = httpServer && typeof httpServer.address === "function" ? httpServer.address() : null;
  } catch {
    address = null;
  }
  const addressPort = address && typeof address === "object" && Number.isInteger(address.port)
    ? address.port
    : null;
  const port = activeServerPort && activeServerPort === addressPort ? activeServerPort : null;
  const runtimePort = readRuntimePortFn();
  // A stale ownerPid (a crashed instance's leftover file) means the extension
  // may be talking to nobody even while this server listens; Doctor shows it.
  const identity = readRuntimeIdentityFn();
  const runtimeOwnerPid = identity && identity.ok ? identity.ownerPid : null;
  return {
    listening: !!port && (!httpServer || httpServer.listening !== false),
    port,
    bindAttempts: bindAttempts.map((attempt) => ({ ...attempt })),
    startupFailure: startupFailure ? { ...startupFailure } : null,
    runtimePath: runtimeConfigFilePath(),
    runtimePort,
    runtimeFileExists: Number.isInteger(runtimePort),
    runtimeMatches: Number.isInteger(port) && runtimePort === port,
    runtimeOwnerPid,
    runtimeOwnerAlive: runtimeOwnerPid ? isProcessAliveFn(runtimeOwnerPid) : false,
    runtimeIdentityValid: !!(identity && identity.ok),
  };
}

const integrationSync = createIntegrationSyncRuntime({
  ctx,
  shouldSyncAgentIntegration,
});
const {
  syncIntegrationForAgent,
  repairIntegrationForAgent,
  uninstallIntegrationForAgent,
  syncEnabledStartupIntegrations,
} = integrationSync;

function repairRuntimeStatus() {
  const status = getRuntimeStatus();
  if (status && status.listening && Number.isInteger(status.port)) {
    const written = writeCurrentRuntimeConfig(status.port);
    return written
      ? { status: "ok" }
      : { status: "error", message: "Failed to write runtime config" };
  }
  if (!httpServer) {
    startHttpServer();
    return { status: "ok" };
  }
  return {
    status: "error",
    message: "Local server is not listening; restart omp-pet",
  };
}

function recordLocalHookTransportRejection(route, reason, status) {
  if (typeof ctx.debugLog !== "function") return;
  const key = `${route}:${reason}:${status}`;
  const now = nowFn();
  const previous = localHookRejectTelemetry.get(key);
  if (Number.isFinite(previous) && now - previous < LOCAL_HOOK_REJECT_LOG_INTERVAL_MS) return;
  if (!localHookRejectTelemetry.has(key) && localHookRejectTelemetry.size >= 32) {
    localHookRejectTelemetry.delete(localHookRejectTelemetry.keys().next().value);
  }
  localHookRejectTelemetry.set(key, now);
  try {
    ctx.debugLog(`local-hook-transport-reject route=${route} reason=${reason} status=${status}`);
  } catch {}
}

function rejectUnsafeLocalHookRequest(req, res, route) {
  // This endpoint is for the native extension, not browser UI. Loopback
  // binding and absent CORS headers alone do not stop simple cross-origin
  // POSTs. These checks do not authenticate processes of the same OS user.
  const headers = req.headers || {};
  const host = typeof headers.host === "string"
    ? /^(?:127\.0\.0\.1|localhost|\[::1\])(?::([0-9]{1,5}))?$/i.exec(headers.host)
    : null;
  let status = 0;
  let reason = "";
  if (Object.prototype.hasOwnProperty.call(headers, "origin")) {
    status = 403;
    reason = "origin-present";
  } else if (!host
    || (host[1] !== undefined && (Number(host[1]) < 1 || Number(host[1]) > 65535))) {
    status = 403;
    reason = "invalid-host";
  } else {
    // Node discards duplicate Host / Content-Type fields by default. Reject
    // ambiguous requests rather than validating only the retained first value.
    const seen = new Set();
    const raw = req.rawHeaders || [];
    for (let i = 0; i < raw.length; i += 2) {
      const name = String(raw[i] || "").toLowerCase();
      if (name !== "host" && name !== "content-type") continue;
      if (seen.has(name)) {
        status = 400;
        reason = name === "host" ? "duplicate-host" : "duplicate-content-type";
        break;
      }
      seen.add(name);
    }
    const type = typeof headers["content-type"] === "string"
      ? headers["content-type"].split(";", 1)[0].trim().toLowerCase()
      : "";
    if (!status && type !== "application/json") {
      status = 415;
      reason = "unsupported-media-type";
    }
  }
  if (!status) return false;
  recordLocalHookTransportRejection(route, reason, status);
  // Close without waiting for body bytes; the extension keeps its own fallback.
  res.writeHead(status, { "Connection": "close" });
  res.end();
  return true;
}

function routeHttpRequest(req, res) {
  if (req.method === "GET" && req.url === "/state") {
    sendStateHealthResponse(res, { getHookServerPort });
  } else if (req.method === "POST" && req.url === "/state") {
    if (rejectUnsafeLocalHookRequest(req, res, "/state")) return;
    handleStatePost(req, res, {
      ctx,
      createRequestHookRecorder,
      shouldDropForDnd,
    });
  } else {
    res.writeHead(404);
    res.end();
  }
}

function startHttpServer() {
  httpServer = createHttpServer((req, res) => {
    routeHttpRequest(req, res);
  });

  activeServerPort = null;
  bindAttempts = [];
  startupFailure = null;
  let hint = null;
  try { hint = normalizeLocalPort(readPortHint()); } catch {}
  if (hint < 1024 || SERVER_PORTS.includes(hint)) hint = null;
  // Port 0 is a server-only last resort, never a client scan candidate.
  const listenPorts = [...new Set([
    ...getPortCandidatesFn().map(normalizeLocalPort).filter(Boolean).slice(0, 8),
    ...(hint ? [hint] : []), 0,
  ])];
  let listenIndex = 0;
  // Callers must await the actual listener and, for a dynamic port,
  // successful runtime publication.
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const bindFailed = (err) => {
      if (settled) {
        console.error("HTTP server error:", err);
        return;
      }
      const failure = {
        stage: "bind", port: listenPorts[listenIndex],
        code: String(err && err.code || "UNKNOWN").slice(0, 48),
        message: String(err && err.message || "Bind failed").slice(0, 240),
      };
      bindAttempts.push(failure);
      if ((failure.code === "EADDRINUSE" || failure.code === "EACCES") && listenIndex < listenPorts.length - 1) {
        listenIndex++;
        listen();
        return;
      }
      startupFailure = failure;
      console.warn(`omp-pet local server failed (${failure.code}, port ${failure.port}): ${failure.message}`);
      settle(null);
    };
    const listen = () => {
      try { httpServer.listen(listenPorts[listenIndex], "127.0.0.1"); }
      catch (err) { bindFailed(err); }
    };
    httpServer.on("error", bindFailed);
    httpServer.on("listening", () => {
      if (settled) return;
      let port = null;
      try { port = normalizeLocalPort(httpServer.address().port); } catch {}
      if (!port) {
        try { httpServer.close(); } catch {}
        bindFailed(new Error("Listener has no valid address port"));
        return;
      }
      let runtimeWritten = false;
      try { runtimeWritten = writeCurrentRuntimeConfig(port) === true; }
      catch (err) { console.warn("Failed to write the omp-pet runtime file:", (err && err.message) || err); }
      if (!runtimeWritten) {
        const dynamic = !SERVER_PORTS.includes(port);
        console.warn(`omp-pet runtime file was not written (${runtimeConfigFilePath()}) - `
          + (dynamic ? "dynamic listener closed; check Doctor → Local server"
            : "the OMP extension falls back to scanning the fixed port range"));
        if (dynamic) {
          startupFailure = { stage: "runtime", port, code: "RUNTIME_WRITE_FAILED" };
          try { httpServer.close(); } catch {}
          settle(null);
          return;
        }
      }
      activeServerPort = port;
      if (runtimeWritten && !SERVER_PORTS.includes(port)) {
        let saved = false;
        try { saved = writePortHint(port) === true; } catch {}
        if (!saved) console.warn("omp-pet could not save its local server restart port hint");
      }
      console.log(`omp-pet state server listening on 127.0.0.1:${port}`);
      setImmediateFn(() => { syncEnabledStartupIntegrations(); });
      settle(port);
    });
    listen();
  });
}

function cleanup() {
  clearRuntimeConfigFn();
  localHookRejectTelemetry.clear();
  activeServerPort = null;
  if (httpServer) httpServer.close();
}

return {
  startHttpServer,
  getHookServerPort,
  getRuntimeStatus,
  getRecentHookEvents,
  clearRecentHookEvents,
  syncIntegrationForAgent,
  repairIntegrationForAgent,
  uninstallIntegrationForAgent,
  repairRuntimeStatus,
  cleanup,
};

};
