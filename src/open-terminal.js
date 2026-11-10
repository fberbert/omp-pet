"use strict";

const { spawn } = require("child_process");

// Spawn a detached terminal process. Resolves { ok: true } once the process
// itself starts (the "spawn" event), or { ok: false, error } if the OS refuses
// to launch it (e.g. the terminal binary is not installed). The terminal is
// detached with stdio ignored, so only the terminal launch is observable.
function tryLaunch(bin, args, opts) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, opts);
    } catch (err) {
      resolve({ ok: false, error: err });
      return;
    }
    let resolved = false;
    const onSpawn = () => {
      if (resolved) return;
      resolved = true;
      child.removeListener("error", onError);
      child.on("error", () => {});
      try { child.unref(); } catch {}
      resolve({ ok: true, child });
    };
    const onError = (err) => {
      if (resolved) return;
      resolved = true;
      child.removeListener("spawn", onSpawn);
      resolve({ ok: false, error: err });
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
}

// Linux terminals inherit the spawn cwd, so the command only needs to keep
// the shell alive. Tried in order until one spawns.
const TERMINAL_CANDIDATES = Object.freeze([
  { bin: "x-terminal-emulator", args: ["-e", "bash", "-c", "exec bash"] },
  { bin: "gnome-terminal", args: ["--", "bash", "-c", "exec bash"] },
  { bin: "konsole", args: ["-e", "bash", "-c", "exec bash"] },
  { bin: "alacritty", args: ["-e", "bash", "-c", "exec bash"] },
  { bin: "kitty", args: ["--", "bash", "-c", "exec bash"] },
  { bin: "xterm", args: ["-e", "bash", "-c", "exec bash"] },
]);

async function openTerminalAt(dir, deps = {}) {
  const _tryLaunch = deps.tryLaunch || tryLaunch;
  if (typeof dir !== "string" || !dir) {
    return { ok: false, message: "openTerminalAt: dir must be a non-empty string" };
  }
  const opts = { detached: true, stdio: "ignore", cwd: dir };
  let lastError = null;
  for (const candidate of TERMINAL_CANDIDATES) {
    const result = await _tryLaunch(candidate.bin, candidate.args, opts);
    if (result.ok) return { ok: true, terminal: candidate.bin };
    lastError = result.error;
  }
  return {
    ok: false,
    message: (lastError && lastError.message) || "could not spawn terminal",
  };
}

module.exports = {
  TERMINAL_CANDIDATES,
  openTerminalAt,
  tryLaunch,
};
