"use strict";

// Whether a session can be focused from the HUD/Dashboard, and how. Every
// session is local, so a terminal source PID is the only focus target.

function getSessionFocusTarget(entry) {
  if (!entry || !entry.id) return { canFocus: false, type: null, url: null };
  if (entry.sourcePid) return { canFocus: true, type: "terminal", url: null };
  return { canFocus: false, type: null, url: null };
}

function isFocusableLocalHudSession(entry) {
  return !!entry
    && getSessionFocusTarget(entry).canFocus
    && !entry.headless
    && entry.state !== "sleeping"
    && !entry.hiddenFromHud;
}

function getFocusableLocalHudSessionIds(snapshot) {
  const sessions = Array.isArray(snapshot && snapshot.sessions) ? snapshot.sessions : [];
  return sessions
    .filter((entry) => isFocusableLocalHudSession(entry))
    .map((entry) => entry.id);
}

function mergeSessionFocusEntry(session, fallback, id) {
  return { ...(session || {}), ...(fallback || {}), id };
}

module.exports = {
  getFocusableLocalHudSessionIds,
  getSessionFocusTarget,
  isFocusableLocalHudSession,
  mergeSessionFocusEntry,
};
