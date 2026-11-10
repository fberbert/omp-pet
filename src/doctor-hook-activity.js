"use strict";

const DEFAULT_CONNECTION_TEST_DURATION_MS = 10000;
const MAX_CONNECTION_TEST_DURATION_MS = 30000;

function clampDurationMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_CONNECTION_TEST_DURATION_MS;
  return Math.max(1000, Math.min(MAX_CONNECTION_TEST_DURATION_MS, Math.floor(n)));
}

function wait(ms, setTimeoutFn = setTimeout) {
  return new Promise((resolve) => setTimeoutFn(resolve, ms));
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function eventSummary(events, resolveAgentDisplayName) {
  const resolve = typeof resolveAgentDisplayName === "function" ? resolveAgentDisplayName : (agentId) => agentId;
  const agents = uniqueSorted(events.map((event) => resolve(event.agentId)));
  const outcomes = uniqueSorted(events.map((event) => event.outcome));
  return { agents, outcomes };
}

function evaluateConnectionTest(input = {}) {
  const events = Array.isArray(input.events) ? input.events : [];
  const accepted = events.filter((event) => event && event.outcome === "accepted");
  const dropped = events.filter((event) => event && typeof event.outcome === "string" && event.outcome.startsWith("dropped-"));

  if (accepted.length) {
    const summary = eventSummary(accepted, input.resolveAgentDisplayName);
    return {
      status: "http-verified",
      level: null,
      detail: `HTTP path verified (${accepted.length} accepted event${accepted.length === 1 ? "" : "s"}${summary.agents.length ? `: ${summary.agents.join(", ")}` : ""}).`,
    };
  }

  if (dropped.length) {
    const summary = eventSummary(dropped, input.resolveAgentDisplayName);
    return {
      status: "http-dropped",
      level: "warning",
      detail: `HTTP works but events were dropped (${summary.outcomes.join(", ")}${summary.agents.length ? `: ${summary.agents.join(", ")}` : ""}).`,
    };
  }

  return {
    status: "no-activity",
    level: "warning",
    detail: "No OMP extension event reached omp-pet during the test window. Use OMP while the test runs.",
  };
}

async function runConnectionTest(options = {}) {
  const nowFn = typeof options.now === "function" ? options.now : Date.now;
  const durationMs = clampDurationMs(options.durationMs);
  const startedAt = Number.isFinite(options.startedAt) ? options.startedAt : nowFn();
  await wait(durationMs, options.setTimeout || setTimeout);
  const endedAt = nowFn();
  const serverEvents = options.server && typeof options.server.getRecentHookEvents === "function"
    ? options.server.getRecentHookEvents({ since: startedAt })
    : [];
  const events = Array.isArray(options.events) ? options.events : serverEvents;
  const evaluated = evaluateConnectionTest({
    events,
    resolveAgentDisplayName: options.resolveAgentDisplayName,
  });
  return {
    id: "hook-event-waterline",
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    durationMs,
    ...evaluated,
    events: events.slice(-20).map((event) => ({ ...event })),
  };
}

function createConnectionTestDeduper(runTest = runConnectionTest, options = {}) {
  const onResult = typeof options.onResult === "function" ? options.onResult : null;
  let pending = null;
  return function runDedupedConnectionTest(input = {}) {
    // Single-flight: concurrent calls share the first invocation's result.
    if (pending) return pending;
    try {
      pending = Promise.resolve(runTest(input))
        .then((result) => {
          if (onResult) onResult(result);
          return result;
        })
        .finally(() => {
          pending = null;
        });
    } catch (err) {
      pending = Promise.reject(err)
        .finally(() => {
          pending = null;
        });
    }
    return pending;
  };
}

module.exports = {
  DEFAULT_CONNECTION_TEST_DURATION_MS,
  MAX_CONNECTION_TEST_DURATION_MS,
  clampDurationMs,
  createConnectionTestDeduper,
  evaluateConnectionTest,
  runConnectionTest,
};
