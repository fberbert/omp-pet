"use strict";

const { canOfferLocalFolder, focusUnavailableReasonKey } = globalThis.ClawdSessionFocusUnavailable;

const AGENT_LABELS = {
  omp: "OMP",
};

let snapshot = { sessions: [], groups: [], orderedIds: [] };
let i18nPayload = { lang: "en", translations: {} };
let activeEdit = null;

const SESSION_FOLDER_FEEDBACK_MS = 4000;
const sessionFolderActionState = new Map();

const titleEl = document.getElementById("title");
const countEl = document.getElementById("count");
const contentEl = document.getElementById("content");

function t(key) {
  const dict = i18nPayload && i18nPayload.translations ? i18nPayload.translations : {};
  return dict[key] || key;
}

function formatElapsed(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 5) return t("sessionJustNow");
  if (sec < 60) return t("sessionHudElapsedSec").replace("{n}", sec);
  const min = Math.floor(sec / 60);
  if (min < 60) return t("sessionMinAgo").replace("{n}", min);
  const hr = Math.floor(min / 60);
  return t("sessionHrAgo").replace("{n}", hr);
}


function badgeLabel(badge) {
  const key = {
    running: "sessionBadgeRunning",
    done: "sessionBadgeDone",
    interrupted: "sessionBadgeInterrupted",
    idle: "sessionBadgeIdle",
  }[badge] || "sessionBadgeIdle";
  return t(key);
}

function agentLabel(agentId, agentName) {
  return AGENT_LABELS[agentId] || agentName || agentId || t("dashboardUnknownAgent");
}

function agentFallback(agentId, agentName) {
  const label = agentLabel(agentId, agentName).trim();
  return label ? label.slice(0, 2).toUpperCase() : "?";
}

function createText(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = text || "";
  return el;
}

function sessionTitleText(session) {
  return session.displayTitle || session.sessionTitle || session.id || "";
}

function snapshotHasSession(currentSnapshot, sessionId) {
  const sessions = Array.isArray(currentSnapshot && currentSnapshot.sessions)
    ? currentSnapshot.sessions
    : [];
  return sessions.some((session) => session && session.id === sessionId);
}

function beginTitleEdit(session) {
  if (!session || !session.id) return;
  activeEdit = {
    sessionId: session.id,
    rawSessionId: session.rawSessionId || session.id,
    profileId: session.profileId || "local",
    agentId: session.agentId || null,
    host: session.host || null,
    cwd: session.cwd || "",
    initialDraft: sessionTitleText(session),
    draft: sessionTitleText(session),
    committing: false,
  };
  render({ force: true });
}

function cancelTitleEdit() {
  if (!activeEdit) return;
  activeEdit = null;
  render({ force: true });
}

async function commitTitleEdit() {
  if (!activeEdit || activeEdit.committing) return;
  const edit = activeEdit;
  if (edit.draft === edit.initialDraft) {
    activeEdit = null;
    render({ force: true });
    return;
  }
  edit.committing = true;
  try {
    const result = await window.dashboardAPI.setSessionAlias({
      host: edit.host,
      agentId: edit.agentId,
      sessionId: edit.sessionId,
      rawSessionId: edit.rawSessionId,
      profileId: edit.profileId,
      cwd: edit.cwd,
      alias: edit.draft,
    });
    if (!result || result.status !== "ok") {
      edit.committing = false;
      console.warn("session alias update failed:", result && result.message);
      render({ force: true });
      return;
    }
    if (activeEdit === edit) activeEdit = null;
    render({ force: true });
  } catch (err) {
    if (activeEdit === edit) {
      edit.committing = false;
      render({ force: true });
    }
    console.warn("session alias update threw:", err);
  }
}

function createTitle(session) {
  const text = sessionTitleText(session);
  if (activeEdit && activeEdit.sessionId === session.id) {
    const input = document.createElement("input");
    input.className = "session-title-input";
    input.type = "text";
    input.value = activeEdit.draft;
    input.addEventListener("input", () => {
      if (activeEdit && activeEdit.sessionId === session.id) {
        activeEdit.draft = input.value;
      }
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitTitleEdit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancelTitleEdit();
      }
    });
    input.addEventListener("blur", () => {
      commitTitleEdit();
    });
    requestAnimationFrame(() => {
      if (activeEdit && activeEdit.sessionId === session.id && document.contains(input)) {
        input.focus();
        input.select();
      }
    });
    return input;
  }

  const title = createText("div", "session-title", text);
  title.title = text;
  title.addEventListener("dblclick", (event) => {
    event.stopPropagation();
    beginTitleEdit(session);
  });
  return title;
}

function appendMeta(main, session, now) {
  const meta = createText("div", "meta", "");
  const badge = document.createElement("span");
  badge.className = `badge badge-${session.badge || "idle"}`;
  const dot = document.createElement("span");
  dot.className = "dot";
  badge.appendChild(dot);
  badge.appendChild(document.createTextNode(badgeLabel(session.badge)));

  meta.appendChild(document.createTextNode(agentLabel(session.agentId, session.agentName)));
  // Claude profile chip ("work"), right after the agent so the clipped end of
  // this single-line row never hides it.
  if (session.claudeProfileLabel) {
    meta.appendChild(document.createTextNode(" "));
    const profileBadge = document.createElement("span");
    profileBadge.className = "profile-badge";
    profileBadge.textContent = session.claudeProfileLabel;
    profileBadge.title = session.claudeConfigDir
      ? `${t("sessionClaudeProfile")}: ${session.claudeConfigDir}`
      : t("sessionClaudeProfile");
    meta.appendChild(profileBadge);
  }
  meta.appendChild(document.createTextNode(" · "));
  meta.appendChild(badge);
  meta.appendChild(document.createTextNode(` · ${formatElapsed(now - session.updatedAt)}`));
  if (session.headless) {
    meta.appendChild(document.createTextNode(` · ${t("dashboardHeadless")}`));
  }
  if (session.startupRecovered) {
    meta.appendChild(document.createTextNode(" · "));
    const recoveryBadge = document.createElement("span");
    recoveryBadge.className = "recovery-badge";
    recoveryBadge.textContent = t("sessionRecovered");
    meta.appendChild(recoveryBadge);
  }
  // Source badge: show where this session runs (WSL, SSH)
  if (session.sourceType && session.sourceType !== "local") {
    meta.appendChild(document.createTextNode(" · "));
    const sourceBadge = document.createElement("span");
    sourceBadge.className = `source-badge source-${session.sourceType}`;
    sourceBadge.title = session.sourceDisplayLabel || session.sourceLabel || "";
    sourceBadge.textContent = session.sourceDisplayLabel || session.sourceLabel;
    meta.appendChild(sourceBadge);
  }
  main.appendChild(meta);
}

function appendPath(main, session) {
  const pathText = session.cwd || t("dashboardNoPath");
  const pathEl = createText("div", "path", pathText);
  if (session.cwd) pathEl.title = session.cwd;
  main.appendChild(pathEl);
}

function appendEvent(main, session, now) {
  if (!session.lastEvent) return;
  const eventLabel = session.lastEvent.labelKey
    ? t(session.lastEvent.labelKey)
    : (session.lastEvent.rawEvent || "");
  if (!eventLabel) return;
  const eventAt = Number(session.lastEvent.at) || session.updatedAt;
  main.appendChild(createText(
    "div",
    "event-row",
    `${t("dashboardLastEventPrefix")}: ${eventLabel} · ${formatElapsed(now - eventAt)}`
  ));
}

// Own row, not a chip in `.meta`: that row is a single clipped line, so at the
// default 480px width an appended chip is cut off before it can be read.
function appendModel(main, session) {
  if (!session.model) return;
  const row = createText("div", "model-row", `${t("dashboardModel")}: ${session.model}`);
  row.title = session.model;
  main.appendChild(row);
}

function createIcon(session) {
  if (session.iconUrl) {
    const img = document.createElement("img");
    img.className = "agent-icon";
    img.alt = "";
    img.src = session.iconUrl;
    img.addEventListener("error", () => {
      const fallback = createText("span", "agent-fallback", agentFallback(session.agentId, session.agentName));
      img.replaceWith(fallback);
    }, { once: true });
    return img;
  }
  return createText("span", "agent-fallback", agentFallback(session.agentId, session.agentName));
}

function createHideButton(session) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "hide-session-button";
  button.textContent = "\u00d7";
  button.title = t("dashboardHideSessionTitle");
  button.setAttribute("aria-label", t("dashboardHideSessionTitle"));
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (!session || !session.id || !window.dashboardAPI.hideSession) return;
    button.disabled = true;
    try {
      const result = await window.dashboardAPI.hideSession(session.id);
      if (!result || (result.status !== "ok" && result.status !== "not-found")) {
        button.disabled = false;
        console.warn("hide session failed:", result && result.message);
      }
    } catch (err) {
      button.disabled = false;
      console.warn("hide session threw:", err);
    }
  });
  return button;
}

function focusUnavailableText(session) {
  return t(focusUnavailableReasonKey(session));
}

function openFolderFailureText(result) {
  if (result && result.status === "error" && result.message) {
    return t("sessionOpenFolderFailed").replace("{reason}", result.message);
  }
  return t("sessionOpenFolderUnavailable");
}

function pruneSessionFolderActionState(sessions, now) {
  const currentIds = new Set(sessions.map((session) => session && session.id).filter(Boolean));
  for (const [sessionId, state] of sessionFolderActionState) {
    if (!currentIds.has(sessionId)
        || (!state.pending && (!state.feedbackText || state.feedbackUntil <= now))) {
      sessionFolderActionState.delete(sessionId);
    }
  }
}

function beginSessionFolderAction(sessionId) {
  const current = sessionFolderActionState.get(sessionId);
  if (current && current.pending) return false;
  sessionFolderActionState.set(sessionId, {
    pending: true,
    feedbackText: "",
    feedbackUntil: 0,
  });
  return true;
}

function finishSessionFolderAction(sessionId, feedbackText = "") {
  if (!feedbackText) {
    sessionFolderActionState.delete(sessionId);
    return;
  }
  sessionFolderActionState.set(sessionId, {
    pending: false,
    feedbackText,
    feedbackUntil: Date.now() + SESSION_FOLDER_FEEDBACK_MS,
  });
}

function createCard(session, now) {
  const card = document.createElement("article");
  card.className = session.canFocus === true ? "card" : "card card-unfocusable";

  if (session.id) {
    const idTail = String(session.id).slice(-3);
    card.appendChild(createText("span", "session-id-badge", `#${idTail}`));
    card.appendChild(createHideButton(session));
  }

  card.appendChild(createIcon(session));

  const main = document.createElement("div");
  main.className = "main";
  main.appendChild(createTitle(session));
  appendMeta(main, session, now);
  appendPath(main, session);
  appendModel(main, session);
  appendEvent(main, session, now);
  card.appendChild(main);

  const actions = document.createElement("div");
  actions.className = "actions";
  const hideRemoteFocusButton = session.canFocus !== true
    && focusUnavailableReasonKey(session) === "sessionFocusUnavailableRemote";
  if (!hideRemoteFocusButton) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = t("dashboardJumpTerminal");
    button.disabled = session.canFocus !== true;
    if (button.disabled) {
      button.title = focusUnavailableText(session);
    }
    button.addEventListener("click", () => {
      window.dashboardAPI.focusSession(session.id);
    });
    actions.appendChild(button);
  }

  if (session.canFocus !== true) {
    const reason = focusUnavailableText(session);
    actions.appendChild(createText("span", "focus-unavailable-reason", reason));
    const folderState = sessionFolderActionState.get(session.id) || null;
    const feedback = createText(
      "span",
      "session-action-feedback",
      folderState && folderState.feedbackUntil > now ? folderState.feedbackText : ""
    );
    feedback.setAttribute("aria-live", "polite");
    actions.appendChild(feedback);

    if (canOfferLocalFolder(session)) {
      const openFolder = document.createElement("button");
      openFolder.type = "button";
      openFolder.className = "open-folder-button";
      openFolder.textContent = t("dashboardOpenFolder");
      openFolder.disabled = !!(folderState && folderState.pending);
      openFolder.addEventListener("click", async () => {
        if (!beginSessionFolderAction(session.id)) return;
        openFolder.disabled = true;
        feedback.textContent = "";
        render();
        try {
          const result = await window.dashboardAPI.openSessionFolder(session.id);
          if (!result || result.status !== "ok") {
            const message = openFolderFailureText(result);
            finishSessionFolderAction(session.id, message);
            feedback.textContent = message;
          } else {
            finishSessionFolderAction(session.id);
          }
        } catch (err) {
          const message = t("sessionOpenFolderFailed")
            .replace("{reason}", err && err.message ? err.message : String(err));
          finishSessionFolderAction(session.id, message);
          feedback.textContent = message;
          console.warn("open session folder threw:", err);
        }
        openFolder.disabled = false;
        render();
      });
      actions.appendChild(openFolder);
    }
  }

  card.appendChild(actions);

  return card;
}

function deriveGroups(currentSnapshot) {
  return Array.isArray(currentSnapshot.groups) ? currentSnapshot.groups : [];
}

function renderEmpty() {
  const empty = document.createElement("div");
  empty.className = "empty";
  empty.appendChild(createText("div", "empty-title", t("dashboardEmpty")));
  empty.appendChild(createText("div", "empty-hint", t("dashboardEmptyHint")));
  contentEl.replaceChildren(empty);
}

function appendGroup(fragment, group, byId, now) {
  const ids = Array.isArray(group.ids) ? group.ids : [];
  const groupSessions = ids.map((id) => byId.get(id)).filter(Boolean);
  if (!groupSessions.length) return;

  const section = document.createElement("section");
  section.className = "group";
  const host = group.displayHost || group.host || "";
  section.appendChild(createText("h2", "group-title", host || t("sessionLocal")));

  const cards = document.createElement("div");
  cards.className = "cards";
  for (const session of groupSessions) cards.appendChild(createCard(session, now));
  section.appendChild(cards);
  fragment.appendChild(section);
}

function appendSessionGroups(fragment, byId, now) {
  for (const group of deriveGroups(snapshot)) {
    appendGroup(fragment, group, byId, now);
  }
}

function render(options = {}) {
  // The one-second elapsed-time tick rebuilds the entire card tree; an open
  // title edit blocks it unless the caller forces the render.
  if (activeEdit && !options.force) return;
  const sessions = Array.isArray(snapshot.sessions) ? snapshot.sessions : [];
  const count = sessions.length;
  const now = Date.now();
  pruneSessionFolderActionState(sessions, now);
  titleEl.textContent = t("dashboardWindowTitle");
  countEl.textContent = t("dashboardCount").replace("{n}", count);
  document.title = t("dashboardWindowTitle");

  if (count === 0) {
    renderEmpty();
    return;
  }

  const byId = new Map(sessions.map((session) => [session.id, session]));
  const fragment = document.createDocumentFragment();

  // While a round is on, the groups come from its frozen presentation; the
  // ordinary dynamic ordering resumes as soon as it ends.
  appendSessionGroups(fragment, byId, now);

  contentEl.replaceChildren(fragment);
}

async function init() {
  window.dashboardAPI.onLangChange((payload) => {
    i18nPayload = payload || i18nPayload;
    render();
  });
  window.dashboardAPI.onSessionSnapshot((nextSnapshot) => {
    snapshot = nextSnapshot || snapshot;
    if (activeEdit && !snapshotHasSession(snapshot, activeEdit.sessionId)) {
      activeEdit = null;
      render({ force: true });
      return;
    }
    render();
  });

  const [nextI18n, nextSnapshot] = await Promise.all([
    window.dashboardAPI.getI18n(),
    window.dashboardAPI.getSnapshot(),
  ]);
  i18nPayload = nextI18n || i18nPayload;
  snapshot = nextSnapshot || snapshot;
  render();

  setInterval(render, 1000);
}

init().catch((err) => {
  contentEl.textContent = err && err.message ? err.message : String(err);
});
