"use strict";

const SESSION_STALE_MS = 600000;
const WORKING_STALE_MS = 300000;
const DETACHED_IDLE_STALE_MS = 30000;

function isWorkingLikeState(state) {
  return state === "working" || state === "executing" || state === "juggling" || state === "thinking";
}

// Decide what the periodic sweep does with one session: delete it (its process
// is gone or it went quiet too long), settle it to idle (a working state with
// no events for workingStaleMs), or leave it alone.
function getStaleSessionDecision(session, options = {}) {
  const now = options.now;
  const config = options.staleConfig || {};
  const sessionStaleMs = Number.isFinite(config.sessionStaleMs)
    ? config.sessionStaleMs
    : SESSION_STALE_MS;
  const workingStaleMs = Number.isFinite(config.workingStaleMs)
    ? config.workingStaleMs
    : WORKING_STALE_MS;
  const detachedIdleStaleMs = Number.isFinite(config.detachedIdleStaleMs)
    ? config.detachedIdleStaleMs
    : DETACHED_IDLE_STALE_MS;

  const isProcessAlive = options.isProcessAlive;
  const pidReachable = !!session.pidReachable;
  const livenessByPid = new Map();
  const isProcessAliveOnce = (pid) => {
    if (livenessByPid.has(pid)) return livenessByPid.get(pid);
    const alive = isProcessAlive(pid);
    livenessByPid.set(pid, alive);
    return alive;
  };
  const hasReachableAgentPid = !!(pidReachable && session.agentPid);
  const agentAlive = hasReachableAgentPid ? isProcessAliveOnce(session.agentPid) : null;

  if (hasReachableAgentPid && !agentAlive) {
    return { action: "delete", reason: "agent-exit" };
  }

  const age = now - (Number(session.updatedAt) || 0);

  const badge = options.deriveSessionBadge(session);
  if (options.shouldAutoClearDetachedSession(session, badge)) {
    if (age > detachedIdleStaleMs) {
      return { action: "delete", reason: "detached-ended", badge };
    }
    return { action: null, snapshotRefreshNeeded: true };
  }

  if (isWorkingLikeState(session.state)) {
    const workingWindowElapsed = workingStaleMs > 0 && age > workingStaleMs;
    if (
      (workingStaleMs === 0 || workingWindowElapsed)
      && pidReachable && session.sourcePid
      && !agentAlive
      && !isProcessAliveOnce(session.sourcePid)
    ) {
      return { action: "delete", reason: "working-source-exit" };
    }
    if (workingWindowElapsed) {
      return { action: "idle", reason: "working-timeout", updateTimestamp: true };
    }
    return { action: null };
  }

  if (sessionStaleMs > 0 && age > sessionStaleMs) {
    if (pidReachable && session.sourcePid) {
      if (!agentAlive && !isProcessAliveOnce(session.sourcePid)) {
        return { action: "delete", reason: "source-exit" };
      }
      if (session.state !== "idle") {
        return { action: "idle", reason: "session-timeout", updateTimestamp: false };
      }
    } else if (!pidReachable) {
      return { action: "delete", reason: "unreachable" };
    } else {
      return { action: "delete", reason: "no-source" };
    }
  }

  return { action: null };
}

module.exports = {
  DETACHED_IDLE_STALE_MS,
  SESSION_STALE_MS,
  WORKING_STALE_MS,
  getStaleSessionDecision,
  isWorkingLikeState,
};
