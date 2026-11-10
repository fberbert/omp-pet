"use strict";

// Builds the spawn config launch.js uses to start Electron in GUI mode.
// Tools that themselves run on Electron (and some agents) export
// ELECTRON_RUN_AS_NODE=1, which makes Electron behave as plain Node; it must
// not leak into the pet process. OMP_PET_DISABLE_SANDBOX=1 is an escape hatch for
// distributions whose unprivileged user namespaces block Chromium's sandbox.
function buildElectronLaunchConfig(projectDir, options = {}) {
  const env = { ...(options.env || process.env) };
  delete env.ELECTRON_RUN_AS_NODE;

  const disableSandbox = env.OMP_PET_DISABLE_SANDBOX === "1";
  if (disableSandbox) {
    env.ELECTRON_DISABLE_SANDBOX = "1";
    env.CHROME_DEVEL_SANDBOX = "";
  }

  const entry = typeof options.entry === "string" ? options.entry : ".";
  const forwardedArgs = Array.isArray(options.forwardedArgs) ? options.forwardedArgs : [];
  const args = disableSandbox
    ? [entry, "--no-sandbox", "--disable-setuid-sandbox", ...forwardedArgs]
    : [entry, ...forwardedArgs];

  return { args, env, cwd: projectDir };
}

module.exports = { buildElectronLaunchConfig };
