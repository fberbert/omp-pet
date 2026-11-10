"use strict";

// Shared by the Dashboard and the Session HUD renderers (loaded as a plain
// script) and by main-side tests (CommonJS).
(function exposeSessionFocusUnavailable(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ClawdSessionFocusUnavailable = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildSessionFocusUnavailable() {
  // Every session is local; the only reason a session cannot be focused is a
  // missing terminal PID.
  function focusUnavailableReasonKey() {
    return "sessionFocusUnavailableMissingTerminalInfo";
  }

  function canOfferLocalFolder(session) {
    return !!session
      && typeof session.cwd === "string"
      && session.cwd.length > 0;
  }

  return { canOfferLocalFolder, focusUnavailableReasonKey };
});
