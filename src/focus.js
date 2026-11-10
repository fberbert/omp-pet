// Terminal focus for local OMP sessions on Linux.
//
// The window raise goes through wmctrl (lookup by PID) with an xdotool
// fallback. Terminal multiplexers keep panes on a detached server, so after
// the raise tmux and herdr are asked to select the session's own pane.
// Missing tools fail quietly so a click never blocks the app.

const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const path = require("path");
const { execFile } = require("child_process");

const HERDR_CLI_TIMEOUT_MS = 3000;
const TMUX_SWITCH_DELAY_MS = 400;

function normalizePid(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function normalizePidChain(value) {
  if (!Array.isArray(value)) return null;
  const out = value
    .map(normalizePid)
    .filter((pid, index, arr) => pid && arr.indexOf(pid) === index);
  return out.length ? out : null;
}

function normalizeTmuxSocket(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 4096 || /[\0\r\n]/.test(trimmed)) return null;
  if (trimmed.startsWith("/")) return trimmed;
  return trimmed !== "default" && /^[\w.-]{1,64}$/.test(trimmed) ? trimmed : null;
}

function normalizeTmuxClient(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 256 || trimmed.startsWith("-")) return null;
  return /^[\w./:-]+$/.test(trimmed) ? trimmed : null;
}

// "w5:p4" from $HERDR_PANE_ID (#1139). It becomes a CLI argument, so a leading
// "-" is rejected as well.
function normalizeHerdrPaneId(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 256 || trimmed.startsWith("-")) return null;
  return /^[\w-]+:[\w-]+$/.test(trimmed) ? trimmed : null;
}

function normalizeHerdrSocket(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 4096 || !trimmed.startsWith("/")) return null;
  return /[\0\r\n]/.test(trimmed) ? null : trimmed;
}

function normalizeFocusRequest(sourcePidOrRequest, cwd, pidChain, meta = {}) {
  const fromObject = sourcePidOrRequest && typeof sourcePidOrRequest === "object"
    && !Array.isArray(sourcePidOrRequest);
  const source = fromObject ? sourcePidOrRequest : { ...(meta || {}), cwd, pidChain };
  return {
    sourcePid: normalizePid(fromObject ? (source.sourcePid ?? source.source_pid) : sourcePidOrRequest),
    cwd: typeof source.cwd === "string" ? source.cwd : "",
    pidChain: normalizePidChain(source.pidChain ?? source.pid_chain),
    sessionId: typeof source.sessionId === "string" ? source.sessionId : null,
    agentId: typeof source.agentId === "string" ? source.agentId : null,
    requestSource: typeof source.requestSource === "string" ? source.requestSource : null,
    tmuxSocket: normalizeTmuxSocket(source.tmuxSocket ?? source.tmux_socket),
    tmuxClient: normalizeTmuxClient(source.tmuxClient ?? source.tmux_client),
    herdrPaneId: normalizeHerdrPaneId(source.herdrPaneId ?? source.herdr_pane_id),
    herdrSocket: normalizeHerdrSocket(source.herdrSocket ?? source.herdr_socket),
  };
}

function safeLogValue(value) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value).replace(/[\r\n\t]+/g, " ").trim() || "-";
}

function summarizeCwd(cwd) {
  if (typeof cwd !== "string" || !cwd) return { tail: "-", hash: "-" };
  const parts = cwd.split("/").filter(Boolean);
  const tail = parts.length ? `.../${parts[parts.length - 1]}` : "-";
  const hash = crypto.createHash("sha1").update(cwd).digest("hex").slice(0, 8);
  return { tail, hash };
}

function summarizeOpaqueId(value) {
  if (!value) return "-";
  return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 8);
}

module.exports = function initFocus(ctx) {

  function focusLog(msg) {
    if (!ctx || typeof ctx.focusLog !== "function") return;
    try { ctx.focusLog(msg); } catch {}
  }

  function logFocusRequest(request) {
    const cwd = summarizeCwd(request.cwd);
    focusLog([
      "focus request",
      `source=${safeLogValue(request.requestSource)}`,
      `sid=${safeLogValue(request.sessionId)}`,
      `agent=${safeLogValue(request.agentId)}`,
      `sourcePid=${request.sourcePid || "-"}`,
      `cwdTail=${safeLogValue(cwd.tail)}`,
      `cwdHash=${safeLogValue(cwd.hash)}`,
      `chain=${request.pidChain ? `[${request.pidChain.join(">")}]` : "[]"}`,
      `herdrPane=${summarizeOpaqueId(request.herdrPaneId)}`,
    ].join(" "));
  }

  function logFocusResult(reason) {
    focusLog(`focus result ${reason}`);
  }

  // wmctrl first (lookup by PID), then xdotool.
  function raiseWindow(sourcePid) {
    const tryXdoTool = () => {
      execFile("xdotool", ["search", "--pid", String(sourcePid), "windowactivate", "--sync"], {
        timeout: 1200,
      }, () => {});
    };
    execFile("wmctrl", ["-lp"], { timeout: 1000 }, (err, stdout) => {
      if (err || !stdout) return tryXdoTool();
      const match = String(stdout).split(/\r?\n/).find((line) => {
        const parts = line.trim().split(/\s+/);
        return parts.length >= 3 && Number(parts[2]) === Number(sourcePid);
      });
      const winId = match ? match.trim().split(/\s+/)[0] : null;
      if (!winId) return tryXdoTool();
      execFile("wmctrl", ["-i", "-a", winId], { timeout: 1000 }, (activateErr) => {
        if (activateErr) tryXdoTool();
      });
    });
  }

  let resolvedTmuxBin = null;
  let tmuxBinOverride = null;
  function setTmuxBin(p) { tmuxBinOverride = (typeof p === "string") ? p : null; resolvedTmuxBin = null; }

  function resolveTmuxBin() {
    if (tmuxBinOverride !== null) return tmuxBinOverride;
    if (resolvedTmuxBin !== null) return resolvedTmuxBin;
    const home = process.env.HOME || os.homedir() || "";
    const candidates = [
      "/usr/bin/tmux",
      "/usr/local/bin/tmux",
      "/bin/tmux",
      "/run/current-system/sw/bin/tmux",
      home ? path.join(home, ".nix-profile/bin/tmux") : "",
    ];
    for (const p of candidates) {
      if (!p) continue;
      try { if (fs.statSync(p).isFile()) { resolvedTmuxBin = p; return p; } } catch {}
    }
    resolvedTmuxBin = "";
    return "";
  }

  function buildTmuxSocketArgs(tmuxSocket) {
    const socket = normalizeTmuxSocket(tmuxSocket);
    if (!socket) return [];
    return socket.startsWith("/") ? ["-S", socket] : ["-L", socket];
  }

  function scheduleTmuxPaneFocus(pidChain, tmuxSocket, tmuxClient) {
    if (!Array.isArray(pidChain) || pidChain.length < 2) return;
    const tmuxBin = resolveTmuxBin();
    if (!tmuxBin) return;
    const candidates = pidChain.filter((p) => Number.isFinite(p) && p > 0);
    if (candidates.length < 2) return;

    const socketArgs = buildTmuxSocketArgs(tmuxSocket);
    const tmuxClientTarget = normalizeTmuxClient(tmuxClient);
    const clientArgs = tmuxClientTarget ? ["-c", tmuxClientTarget] : [];

    const pidsArg = candidates.slice(0, 8).join(",");
    execFile("ps", ["-o", "pid=,comm=", "-p", pidsArg], { encoding: "utf8", timeout: 500 }, (err, stdout) => {
      if (err || !stdout) return;
      const tmuxPids = new Set();
      for (const line of stdout.trim().split("\n")) {
        const match = line.trim().match(/^(\d+)\s+(.+)$/);
        if (!match) continue;
        // Linux comm is "tmux: server", so keep the whole comm instead of its last word.
        const comm = match[2];
        if (path.basename(comm).toLowerCase() === "tmux" || comm.startsWith("tmux: ")) {
          tmuxPids.add(parseInt(match[1], 10));
        }
      }
      if (!tmuxPids.size) return;

      // The pane shell is the PID immediately before the tmux server in the chain.
      const paneCandidates = [];
      for (let i = 1; i < candidates.length; i++) {
        if (tmuxPids.has(candidates[i]) && !tmuxPids.has(candidates[i - 1])) {
          paneCandidates.push(candidates[i - 1]);
        }
      }
      if (!paneCandidates.length) return;

      execFile(tmuxBin, [...socketArgs, "list-panes", "-a", "-F",
        "#{pane_pid} #{window_id} #{pane_id} #{session_name}"],
      { encoding: "utf8", timeout: 500 }, (tmuxErr, tmuxOut) => {
        if (tmuxErr || !tmuxOut) return;
        for (const panePid of paneCandidates) {
          for (const line of tmuxOut.trim().split("\n")) {
            const parts = line.split(/\s+/);
            if (parts.length < 4 || parseInt(parts[0], 10) !== panePid) continue;
            const windowId = parts[1];
            const paneId = parts[2];
            const session = parts.slice(3).join(" ");
            setTimeout(() => {
              execFile(tmuxBin, [...socketArgs, "switch-client", ...clientArgs, "-t", session], { timeout: 500 }, () => {
                execFile(tmuxBin, [...socketArgs, "select-window", "-t", windowId], { timeout: 500 }, () => {
                  execFile(tmuxBin, [...socketArgs, "select-pane", "-t", paneId], { timeout: 500 }, () => {});
                });
              });
            }, TMUX_SWITCH_DELAY_MS);
            return;
          }
        }
      });
    });
  }

  function herdrCliCandidates() {
    // The binary path a hook could report (HERDR_BIN_PATH) is deliberately
    // never used: it would let a /state body choose which executable runs.
    const candidates = ["herdr"];
    const home = typeof os.homedir === "function" ? os.homedir() : "";
    if (home) {
      candidates.push(
        path.posix.join(home, ".cargo", "bin", "herdr"),
        path.posix.join(home, ".local", "bin", "herdr"),
      );
    }
    return candidates;
  }

  // herdr (#1139) keeps its panes on a detached server; `herdr agent focus`
  // selects the pane on the server side, which every attached client then
  // shows. Resolves - never rejects - with { ok, reason }.
  function scheduleHerdrPaneFocus(herdrPaneId, herdrSocket) {
    const paneId = normalizeHerdrPaneId(herdrPaneId);
    if (!paneId) return Promise.resolve({ ok: false, reason: "no-pane-id" });
    const socket = normalizeHerdrSocket(herdrSocket);
    const env = socket ? { ...process.env, HERDR_SOCKET_PATH: socket } : process.env;
    const candidates = herdrCliCandidates();
    return new Promise((resolve) => {
      const done = (ok, reason, detail = "") => {
        logFocusResult(`branch=herdr reason=${reason}${detail}`);
        resolve({ ok, reason });
      };
      const tryNext = (idx) => {
        if (idx >= candidates.length) return done(false, "herdr-cli-not-found");
        execFile(candidates[idx], ["agent", "focus", paneId], {
          timeout: HERDR_CLI_TIMEOUT_MS,
          encoding: "utf8",
          env,
        }, (err, _stdout, stderr) => {
          if (err && (err.code === "ENOENT" || err.code === 127)) return tryNext(idx + 1);
          if (!err) return done(true, "herdr-pane-focused");
          if (err.killed) return done(false, "herdr-cli-timeout");
          const detail = String(stderr || "").split("\n")[0].slice(0, 160);
          return done(false, "herdr-focus-failed", ` code=${safeLogValue(err.code)} detail=${safeLogValue(detail)}`);
        });
      };
      tryNext(0);
    });
  }

  function focusTerminalWindow(sourcePidOrRequest, cwd, pidChain, meta) {
    const request = normalizeFocusRequest(sourcePidOrRequest, cwd, pidChain, meta);
    logFocusRequest(request);
    if (!request.sourcePid) {
      logFocusResult("branch=none reason=no-source-pid");
      return { reason: "no-source-pid" };
    }
    raiseWindow(request.sourcePid);
    scheduleTmuxPaneFocus(request.pidChain, request.tmuxSocket, request.tmuxClient);
    scheduleHerdrPaneFocus(request.herdrPaneId, request.herdrSocket);
    logFocusResult("branch=linux-command-submitted");
    return { reason: "linux-command-submitted" };
  }

  return {
    focusTerminalWindow,
    __test: {
      normalizeFocusRequest,
      summarizeCwd,
      scheduleTmuxPaneFocus,
      scheduleHerdrPaneFocus,
      normalizeHerdrPaneId,
      herdrCliCandidates,
      setTmuxBin,
      resolveTmuxBin,
    },
  };
};
