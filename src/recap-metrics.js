"use strict";

const { getAllAgents } = require("../agents/registry");

const STANDARD_TOOL_START = Object.freeze(["PreToolUse"]);
const STANDARD_COMPLETION = Object.freeze(["Stop"]);

// Metric capability is intentionally separate from agents/registry.js
// capabilities: an integration must choose a proven boundary or opt out
// instead of inheriting a guess.
const AGENT_METRIC_POLICIES = Object.freeze({
  // OMP records a main-session completion candidate at session_stop and emits
  // Stop only after the following agent_end proves willContinue !== true, so
  // an accepted Stop is a completed-turn boundary. SessionStart carries no
  // fresh-start source, so sessions-started stays unsupported.
  omp: policy(null, STANDARD_COMPLETION, STANDARD_TOOL_START),
});

function policy(sessionStart, turnCompleteEvents, toolCallEvents) {
  return Object.freeze({
    sessionStart,
    turnCompleteEvents: turnCompleteEvents ? Object.freeze([...turnCompleteEvents]) : null,
    toolCallEvents: toolCallEvents ? Object.freeze([...toolCallEvents]) : null,
  });
}

function hasEvent(events, event) {
  return Array.isArray(events) && events.includes(event);
}

function hasReusableDefaultIdentity(value) {
  if (value === null || value === undefined) return true;
  const normalized = String(value).trim().toLowerCase();
  return !normalized || normalized === "default" || normalized.endsWith(":default");
}

function getMetricSupport(agentId) {
  const entry = AGENT_METRIC_POLICIES[agentId];
  if (!entry) return null;
  return Object.freeze({
    sessionsStarted: entry.sessionStart !== null && entry.sessionStart !== undefined,
    turnsCompleted: Array.isArray(entry.turnCompleteEvents),
    toolCalls: Array.isArray(entry.toolCallEvents),
  });
}

function mapRecapMetrics(input) {
  if (!input || typeof input !== "object") return null;
  const policyEntry = AGENT_METRIC_POLICIES[input.agentId];
  if (!policyEntry || typeof input.event !== "string" || !input.event) return null;

  const metrics = ["activity"];
  if (
    policyEntry.sessionStart === "fresh-session-source"
    && input.event === "SessionStart"
    && (input.sessionStartSource === "startup" || input.sessionStartSource === "clear")
    && !hasReusableDefaultIdentity(input.rawSessionId)
  ) {
    metrics.push("session-start");
  }
  if (input.completionAccepted === true && hasEvent(policyEntry.turnCompleteEvents, input.event)) {
    metrics.push("turn-complete");
  }
  if (hasEvent(policyEntry.toolCallEvents, input.event)) {
    metrics.push("tool-call");
  }
  return metrics;
}

function assertRegistryCoverage() {
  const registryIds = getAllAgents().map((agent) => agent.id).sort();
  const policyIds = Object.keys(AGENT_METRIC_POLICIES).sort();
  if (JSON.stringify(registryIds) !== JSON.stringify(policyIds)) {
    throw new Error("recap metric policies must explicitly cover every registry agent");
  }
  return true;
}

assertRegistryCoverage();

module.exports = {
  AGENT_METRIC_POLICIES,
  assertRegistryCoverage,
  getMetricSupport,
  hasReusableDefaultIdentity,
  mapRecapMetrics,
};
