// OMP (oh-my-pi) agent configuration.
// Perception via the OMP extension: lifecycle event hook -> HTTP POST to the
// pet. OMP keeps its own execution model; the pet is state-only and never adds
// a permission layer on top of it.

module.exports = {
  id: "omp",
  name: "OMP",
  eventSource: "extension",
  // Pet-internal event names. hooks/omp-extension-core.js translates OMP's
  // native snake_case events to this PascalCase vocabulary.
  eventMap: {
    SessionStart: "idle",
    UserPromptSubmit: "thinking",
    PreToolUse: "working",
    PostToolUse: "working",
    PostToolUseFailure: "error",
    Stop: "attention",
    PreCompact: "sweeping",
    PostCompact: "attention",
    SessionEnd: "sleeping",
  },
  capabilities: {
    httpHook: false,
    permissionApproval: false,
    notificationHook: false,
    interactiveBubble: false,
    sessionEnd: true,
    subagent: false,
  },
  hookConfig: {
    configFormat: "omp-extension",
  },
};
