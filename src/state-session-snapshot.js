"use strict";

const crypto = require("crypto");
const path = require("path");
const { sessionAliasKey } = require("./session-alias");
const { getSessionFocusTarget } = require("./session-focus");

const EVENT_LABEL_KEYS = {
  SessionStart: "eventLabelSessionStart",
  SessionEnd: "eventLabelSessionEnd",
  UserPromptSubmit: "eventLabelUserPromptSubmit",
  PreToolUse: "eventLabelPreToolUse",
  PostToolUse: "eventLabelPostToolUse",
  PostToolUseFailure: "eventLabelPostToolUseFailure",
  Stop: "eventLabelStop",
  PreCompact: "eventLabelPreCompact",
  PostCompact: "eventLabelPostCompact",
  "stale-cleanup": "eventLabelStaleCleanup",
};

// PostCompact intentionally excluded: compaction finishing is not turn
// completion, so it must not raise the "done" badge.
const DONE_EVENTS = new Set(["Stop"]);

function isDoneEvent(event) {
  return DONE_EVENTS.has(event);
}

// Defense in depth for every title that reaches shared UI snapshots. Bidi
// formatting marks are not HTML injection, but can visually reorder and
// disguise filenames or commands even when renderers use textContent.
const SESSION_TITLE_CONTROL_RE = /[\u0000-\u001F\u007F-\u009F\u061C\u200E-\u200F\u202A-\u202E\u2066-\u2069]+/g;
const SESSION_TITLE_MAX = 80;

function replaceUnpairedSurrogates(value) {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) {
        result += value[index] + value[index + 1];
        index += 1;
      } else {
        result += "\uFFFD";
      }
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      result += "\uFFFD";
    } else {
      result += value[index];
    }
  }
  return result;
}

function normalizeTitle(value) {
  if (typeof value !== "string") return null;
  const collapsed = replaceUnpairedSurrogates(value)
    .replace(SESSION_TITLE_CONTROL_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!collapsed) return null;
  const characters = Array.from(collapsed);
  return characters.length > SESSION_TITLE_MAX
    ? `${characters.slice(0, SESSION_TITLE_MAX - 1).join("")}\u2026`
    : collapsed;
}

function sessionUpdatedAt(session) {
  const updatedAt = Number(session && session.updatedAt);
  return Number.isFinite(updatedAt) ? updatedAt : 0;
}

// A session counts as "in progress" when it is non-headless and its stored
// state is anything other than idle/sleeping (mirrors deriveSessionBadge's
// "running" semantics). One-shot visuals like attention are stored as idle.
function isSessionInProgress(session) {
  if (!session || session.headless) return false;
  if (session.state === "idle" || session.state === "sleeping") return false;
  return true;
}

function deriveSessionBadge(session) {
  if (!session) return "idle";
  if (session.state !== "idle" && session.state !== "sleeping") return "running";
  if (session.state === "sleeping") return "idle";
  const events = Array.isArray(session.recentEvents) ? session.recentEvents : [];
  const latest = events.length ? events[events.length - 1] : null;
  const latestEvent = latest && latest.event;
  if (latestEvent === "PostToolUseFailure") return "interrupted";
  if (isDoneEvent(latestEvent)) return "done";
  return "idle";
}

function isEndedSessionBadge(badge) {
  return badge === "done" || badge === "interrupted";
}

function shouldAutoClearDetachedSession(session, badge, options = {}) {
  if (options.sessionHudCleanupDetached !== true) return false;
  if (!session || session.headless || session.state !== "idle" || session.agentPid) return false;
  if (!session.pidReachable || !session.sourcePid) return false;
  if (!isEndedSessionBadge(badge)) return false;
  const isProcessAlive = typeof options.isProcessAlive === "function"
    ? options.isProcessAlive
    : () => true;
  return !isProcessAlive(session.sourcePid);
}

function getSessionAliasEntry(id, sessionLike, sessionAliases = {}) {
  const rawSessionId = (sessionLike && sessionLike.rawSessionId) || id;
  const key = sessionAliasKey(
    null,
    sessionLike && sessionLike.agentId,
    rawSessionId,
    {
      cwd: sessionLike && sessionLike.cwd,
      profileId: sessionLike && sessionLike.profileId,
    }
  );
  return key ? (sessionAliases[key] || null) : null;
}

function getEffectiveSessionTitle(id, sessionLike) {
  return normalizeTitle(sessionLike && sessionLike.sessionTitle);
}

// Display-only folder label shared by every snapshot consumer. The raw cwd
// stays on the snapshot for focus/open-folder actions.
function sessionDisplayFolder(id, sessionLike) {
  const cwd = sessionLike && sessionLike.cwd;
  if (!cwd || typeof cwd !== "string") return "";
  return path.posix.basename(cwd) || "";
}

function shortenSessionIdForDisplay(value) {
  if (value === null || value === undefined) return value;
  let displayId = String(value);
  if (displayId.startsWith("omp:") && displayId.slice(4).trim()) displayId = displayId.slice(4);
  return displayId.length > 6 ? `${displayId.slice(0, 6)}..` : displayId;
}

function buildDisplaySessionTag(canonicalSessionId) {
  if (typeof canonicalSessionId !== "string") return "";
  const trimmed = canonicalSessionId.trim();
  if (!trimmed) return "";
  return crypto.createHash("sha256").update(trimmed).digest("hex").slice(0, 10);
}

function getEntryDisplaySessionTag(entry) {
  if (entry && typeof entry.displaySessionTag === "string" && entry.displaySessionTag) {
    return entry.displaySessionTag;
  }
  return buildDisplaySessionTag(entry && entry.id);
}

function sessionDisplayTitle(id, sessionLike, sessionAliases = {}) {
  const alias = getSessionAliasEntry(id, sessionLike, sessionAliases);
  if (alias && typeof alias.title === "string" && alias.title) return alias.title;
  const title = getEffectiveSessionTitle(id, sessionLike);
  if (title) return title;
  const folder = sessionDisplayFolder(id, sessionLike);
  if (folder) return folder;
  const rawSessionId = (sessionLike && sessionLike.rawSessionId) || id;
  return shortenSessionIdForDisplay(rawSessionId);
}

function sessionMenuComparator(a, b, statePriority = {}) {
  const pa = statePriority[a.state] || 0;
  const pb = statePriority[b.state] || 0;
  if (pb !== pa) return pb - pa;
  return sessionUpdatedAt(b) - sessionUpdatedAt(a);
}

function sessionUpdatedAtComparator(a, b) {
  const byTime = sessionUpdatedAt(b) - sessionUpdatedAt(a);
  if (byTime !== 0) return byTime;
  return String(a.id).localeCompare(String(b.id));
}

function buildSessionSnapshotEntry(id, session, sessionAliases = {}, options = {}) {
  const alias = getSessionAliasEntry(id, session, sessionAliases);
  const recentEvents = Array.isArray(session && session.recentEvents)
    ? session.recentEvents
    : [];
  const latestEvent = recentEvents.length ? recentEvents[recentEvents.length - 1] : null;
  const rawEvent = latestEvent && latestEvent.event ? latestEvent.event : null;
  const eventAt = Number(latestEvent && latestEvent.at);
  const badge = deriveSessionBadge(session);
  const getAgentIconUrl = typeof options.getAgentIconUrl === "function"
    ? options.getAgentIconUrl
    : () => null;
  const resolveAgentDisplayName = typeof options.resolveAgentDisplayName === "function"
    ? options.resolveAgentDisplayName
    : () => "";
  const agentId = (session && session.agentId) || null;
  const state = (session && session.state) || "idle";
  // A detached ended session is hidden from the HUD and has nothing to jump to.
  const hiddenFromHud = shouldAutoClearDetachedSession(session, badge, options);
  const focusTarget = session && !session.headless && state !== "sleeping" && !hiddenFromHud
    ? getSessionFocusTarget({ ...(session || {}), id })
    : { canFocus: false, type: null, url: null };
  return {
    id,
    profileId: (session && session.profileId) || "local",
    rawSessionId: (session && session.rawSessionId) || id,
    displaySessionTag: buildDisplaySessionTag(id),
    agentId,
    agentName: resolveAgentDisplayName(agentId),
    iconUrl: getAgentIconUrl(agentId),
    state,
    badge,
    hiddenFromHud,
    hasAlias: !!(alias && typeof alias.title === "string" && alias.title),
    sessionTitle: getEffectiveSessionTitle(id, session),
    displayTitle: sessionDisplayTitle(id, session, sessionAliases),
    displayFolder: sessionDisplayFolder(id, session),
    cwd: (session && session.cwd) || "",
    updatedAt: sessionUpdatedAt(session),
    sourcePid: (session && session.sourcePid) || null,
    canFocus: focusTarget.canFocus === true,
    focusTarget: focusTarget.type ? { type: focusTarget.type, url: focusTarget.url || null } : null,
    host: null,
    sourceType: "local",
    sourceLabel: "",
    sourceDisplayLabel: "",
    headless: !!(session && session.headless),
    model: (session && session.model) || null,
    lastEvent: latestEvent ? {
      labelKey: rawEvent ? (EVENT_LABEL_KEYS[rawEvent] || null) : null,
      rawEvent,
      at: Number.isFinite(eventAt) ? eventAt : 0,
    } : null,
  };
}

function normalizeSessionsIterable(sessions) {
  if (!sessions) return [];
  if (sessions instanceof Map) return sessions.entries();
  if (typeof sessions[Symbol.iterator] === "function") return sessions;
  return [];
}

function buildSessionSnapshot(sessions, options = {}) {
  const entries = [];
  const sessionAliases = options.sessionAliases && typeof options.sessionAliases === "object"
    ? options.sessionAliases
    : {};
  for (const [id, session] of normalizeSessionsIterable(sessions)) {
    entries.push(buildSessionSnapshotEntry(id, session, sessionAliases, options));
  }

  const dashboardEntries = entries.slice().sort(sessionUpdatedAtComparator);
  const menuEntries = entries.slice().sort((a, b) => sessionMenuComparator(a, b, options.statePriority));
  const orderedIds = dashboardEntries.map((entry) => entry.id);
  const menuOrderedIds = menuEntries.map((entry) => entry.id);
  const hudEntries = dashboardEntries.filter((entry) =>
    !entry.headless && entry.state !== "sleeping" && !entry.hiddenFromHud
  );

  const lastSession = dashboardEntries[0] || null;
  return {
    sessions: entries,
    // All sessions are local; one group keeps the renderers' grouping contract.
    groups: orderedIds.length ? [{ host: "", ids: orderedIds, displayHost: "" }] : [],
    orderedIds,
    menuOrderedIds,
    hudTotalNonIdle: hudEntries.length,
    hudLastSessionId: hudEntries.length ? hudEntries[0].id : null,
    hudLastTitle: hudEntries.length ? hudEntries[0].displayTitle : null,
    lastSessionId: lastSession ? lastSession.id : null,
    lastTitle: lastSession ? lastSession.displayTitle : null,
  };
}

function getActiveSessionAliasKeys(sessions) {
  const keys = new Set();
  for (const [id, session] of normalizeSessionsIterable(sessions)) {
    const key = sessionAliasKey(
      null,
      session && session.agentId,
      (session && session.rawSessionId) || id,
      {
        cwd: session && session.cwd,
        profileId: session && session.profileId,
      }
    );
    if (key) keys.add(key);
  }
  return keys;
}

function sessionSnapshotSignature(snapshot) {
  return JSON.stringify({
    orderedIds: snapshot.orderedIds,
    menuOrderedIds: snapshot.menuOrderedIds,
    hudTotalNonIdle: snapshot.hudTotalNonIdle,
    hudLastSessionId: snapshot.hudLastSessionId,
    hudLastTitle: snapshot.hudLastTitle,
    lastSessionId: snapshot.lastSessionId,
    lastTitle: snapshot.lastTitle,
    sessions: snapshot.sessions.map((entry) => ({
      id: entry.id,
      rawSessionId: entry.rawSessionId,
      state: entry.state,
      badge: entry.badge,
      hasAlias: entry.hasAlias,
      sessionTitle: entry.sessionTitle,
      displayTitle: entry.displayTitle,
      displayFolder: entry.displayFolder,
      cwd: entry.cwd,
      agentId: entry.agentId,
      agentName: entry.agentName,
      sourcePid: entry.sourcePid,
      canFocus: entry.canFocus,
      focusTarget: entry.focusTarget,
      headless: entry.headless,
      hiddenFromHud: !!entry.hiddenFromHud,
      model: entry.model,
      lastEventLabelKey: entry.lastEvent ? entry.lastEvent.labelKey : null,
      lastEventRawEvent: entry.lastEvent ? entry.lastEvent.rawEvent : null,
      lastEventAt: entry.lastEvent ? entry.lastEvent.at : null,
    })),
  });
}

module.exports = {
  EVENT_LABEL_KEYS,
  SESSION_TITLE_MAX,
  isDoneEvent,
  normalizeTitle,
  sessionUpdatedAt,
  isSessionInProgress,
  deriveSessionBadge,
  shouldAutoClearDetachedSession,
  getSessionAliasEntry,
  getEffectiveSessionTitle,
  sessionDisplayFolder,
  sessionDisplayTitle,
  buildDisplaySessionTag,
  getEntryDisplaySessionTag,
  sessionMenuComparator,
  sessionUpdatedAtComparator,
  buildSessionSnapshotEntry,
  buildSessionSnapshot,
  getActiveSessionAliasKeys,
  sessionSnapshotSignature,
};
