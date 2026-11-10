// src/state.js — State machine + session management + DND + wake poll

let screen;
try { ({ screen } = require("electron")); } catch { screen = null; }
const {
  createStatePriorityConstants,
  getStatePriority,
  resolveDisplayStateFromSessions,
} = require("./state-priority");
const {
  buildStateBindings,
  createStableVisualPicker,
  getVisualState,
  hasOwnVisualFiles: hasOwnVisualFilesWithBindings,
  resolveVisualBinding: resolveVisualBindingWithBindings,
  getSvgOverride: getSvgOverrideWithDeps,
} = require("./state-visual-resolver");
const { getStaleSessionDecision } = require("./state-stale-cleanup");
const {
  createHitboxRuntime,
  resolveHitBoxForSvg: resolveHitBoxForSvgWithRuntime,
} = require("./state-hitbox-resolver");
const {
  pickDisplayHint: pickDisplayHintWithMap,
  pushRecentEvent,
} = require("./state-session-events");
const {
  deriveSessionBadge,
  isDoneEvent,
  normalizeTitle,
  shouldAutoClearDetachedSession: shouldAutoClearDetachedSessionWithDeps,
  buildSessionSnapshot: buildSessionSnapshotFromSessions,
  getActiveSessionAliasKeys: getActiveSessionAliasKeysFromSessions,
  sessionSnapshotSignature,
} = require("./state-session-snapshot");
const { getAgentIconUrl } = require("./state-agent-icons");
const { getAgent } = require("../agents/registry");
const { hasReusableDefaultIdentity, mapRecapMetrics } = require("./recap-metrics");
const {
  NOOP_RECAP_SINK,
  recordCanonicalRecapEvent,
} = require("./recap-sink");

// The OMP CLI runs as `omp`, but a bare process name is ambiguous on Linux, so
// startup recovery matches the scoped package path instead.
const OMP_CLI_COMMAND_LINE_MARKER = "@oh-my-pi/pi-coding-agent";

module.exports = function initState(ctx) {

const recapSink = ctx.recapSink && typeof ctx.recapSink.record === "function"
  ? ctx.recapSink
  : NOOP_RECAP_SINK;

const _getCursor = ctx.getCursorScreenPoint || (screen ? () => screen.getCursorScreenPoint() : null);
const _kill = ctx.processKill || process.kill.bind(process);

// ── Theme-driven state (refreshed on hot theme switch) ──
let theme = null;
let SVG_IDLE_FOLLOW = null;
let STATE_SVGS = {};
let STATE_BINDINGS = {};
// One pick per long-running state (thinking / working / juggling) when the
// theme lists several files; see createStableVisualPicker.
const stableVisualPicker = createStableVisualPicker();
let MIN_DISPLAY_MS = {};
let AUTO_RETURN_MS = {};
let DEEP_SLEEP_TIMEOUT = 0;
let YAWN_DURATION = 0;
let WAKE_DURATION = 0;
let DND_SKIP_YAWN = false;
let DND_SLEEP_TRANSITION_SVG = null;
let DND_SLEEP_TRANSITION_DURATION = 0;
let COLLAPSE_DURATION = 0;
let SLEEP_MODE = "full";
const { SLEEP_SEQUENCE, STATE_PRIORITY, ONESHOT_STATES } = createStatePriorityConstants();

// Session display hints — validated against theme.displayHintMap keys
let DISPLAY_HINT_MAP = {};

// ── Session tracking ──
const sessions = new Map();
const MAX_SESSIONS = 20;
// Events that do not prove forward progress: they keep a completion tail.
const COMPLETION_HOUSEKEEPING_EVENTS = new Set(["stale-cleanup"]);
let lastSessionSnapshotSignature = null;
let lastSessionSnapshot = null;
let startupRecoveryActive = false;
let startupRecoveryTimer = null;
const STARTUP_RECOVERY_MAX_MS = 300000;

function normalizeToolName(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > 160 || /[\0\r\n]/.test(text)) return null;
  return text;
}

// ── Hit-test bounding boxes (from theme) ──
let HIT_BOXES = {};
let FILE_HIT_BOXES = {};
let WIDE_SVGS = new Set();
let SLEEPING_SVGS = new Set();
let hitboxRuntime = { hitBoxes: HIT_BOXES, fileHitBoxes: FILE_HIT_BOXES, wideSvgs: WIDE_SVGS, sleepingSvgs: SLEEPING_SVGS };
let currentHitBox = HIT_BOXES.default;

// ── State machine internal ──
let currentState = "idle";
// Bumped by every applyState that actually lands, so an owner can tell "the
// visual I put up is still the current one" from "something applied a state
// since" — including a real event that re-applies the same state name.
let displayRevision = 0;
let previousState = "idle";
let currentSvg = null;
// Where the currently displayed visual came from. A Settings animation preview
// temporarily owns the pet's visual even though it reuses a logical state name.
// A real event landing on that same name must still be able to take the visual
// back, so setState has to know the difference between "the pet is really in
// this state" and "a preview is holding this visual". Any applyState that is
// not itself a preview clears it — the last landed applyState is the owner.
const VISUAL_SOURCE_SETTINGS_PREVIEW = "settings-preview";
let currentVisualSource = null;
let stateChangedAt = Date.now();
let pendingTimer = null;
let autoReturnTimer = null;
let pendingState = null;
let eyeResendTimer = null;

// ── Wake poll ──
const WAKE_POLL_START_DELAY_MS = 500;
// Cursor-sample cadence while dozing/collapsing/sleeping.
const WAKE_POLL_MS = 200;
let wakePollStartTimer = null;
let wakePollStartState = null;
let wakePollTimer = null;
let lastWakeCursorX = null, lastWakeCursorY = null;

function isWakePollState(state) {
  return state === "dozing" || state === "collapsing" || state === "sleeping";
}

function resolveAwaitingInputSinceStop(existing, event) {
  if (isDoneEvent(event)) return true;
  if (!event || COMPLETION_HOUSEKEEPING_EVENTS.has(event)) return !!(existing && existing.awaitingInputSinceStop === true);
  return false;
}

function getCompletionTailWithoutProgress(session) {
  const events = Array.isArray(session && session.recentEvents) ? session.recentEvents : [];
  for (let i = events.length - 1; i >= 0; i--) {
    const entry = events[i];
    const event = entry && entry.event;
    if (isDoneEvent(event)) return entry;
    if (event == null || COMPLETION_HOUSEKEEPING_EVENTS.has(event)) continue;
    return null;
  }
  return null;
}

function markCompletionTailPresented(recentEvents) {
  const copy = recentEvents.slice();
  for (let i = copy.length - 1; i >= 0; i--) {
    const entry = copy[i];
    const event = entry && entry.event;
    if (isDoneEvent(event)) {
      copy[i] = { ...entry, state: "attention" };
      break;
    }
    if (event == null || COMPLETION_HOUSEKEEPING_EVENTS.has(event)) continue;
    break;
  }
  return copy;
}

// A second Stop for a turn that already celebrated must not celebrate again.
function shouldSuppressDuplicateCompletionVisual(existing, state, event) {
  if (state !== "attention" || !isDoneEvent(event)) return false;
  if (!existing || (existing.state !== "idle" && existing.state !== "sleeping")) return false;
  const completionTail = getCompletionTailWithoutProgress(existing);
  if (completionTail) return completionTail.state === "attention";
  return existing.awaitingInputSinceStop === true;
}

function shouldKeepExistingCompletionEventTail(existing, state, event) {
  return state === "attention"
    && existing
    && (existing.state === "idle" || existing.state === "sleeping")
    && isDoneEvent(event)
    && !!getCompletionTailWithoutProgress(existing);
}

// ── Stale cleanup ──
let staleCleanupTimer = null;
let _detectInFlight = false;

function resolveHitBoxForSvg(svg) {
  return resolveHitBoxForSvgWithRuntime(svg, hitboxRuntime);
}

function refreshTheme() {
  theme = ctx.theme;
  SVG_IDLE_FOLLOW = theme.states.idle[0];
  STATE_SVGS = { ...theme.states };
  STATE_BINDINGS = buildStateBindings(theme);
  stableVisualPicker.clear();
  // Sync back so settings-animation-overrides can resolve roam/fallback states
  theme._stateBindings = STATE_BINDINGS;
  if (theme.miniMode && theme.miniMode.states) {
    Object.assign(STATE_SVGS, theme.miniMode.states);
  }
  MIN_DISPLAY_MS = { ...theme.timings.minDisplay,
    executing: theme.timings.minDisplay.executing ?? theme.timings.minDisplay.working ?? 0 };
  AUTO_RETURN_MS = theme.timings.autoReturn;
  DEEP_SLEEP_TIMEOUT = theme.timings.deepSleepTimeout;
  YAWN_DURATION = theme.timings.yawnDuration;
  WAKE_DURATION = theme.timings.wakeDuration;
  DND_SKIP_YAWN = !!theme.timings.dndSkipYawn;
  DND_SLEEP_TRANSITION_SVG = typeof theme.timings.dndSleepTransitionSvg === "string" && theme.timings.dndSleepTransitionSvg
    ? theme.timings.dndSleepTransitionSvg.split(/[\\/]/).pop()
    : null;
  DND_SLEEP_TRANSITION_DURATION = Number.isFinite(theme.timings.dndSleepTransitionDuration) && theme.timings.dndSleepTransitionDuration > 0
    ? Math.floor(theme.timings.dndSleepTransitionDuration)
    : 0;
  COLLAPSE_DURATION = theme.timings.collapseDuration || 0;
  SLEEP_MODE = theme.sleepSequence && theme.sleepSequence.mode === "direct" ? "direct" : "full";
  DISPLAY_HINT_MAP = theme.displayHintMap || {};
  hitboxRuntime = createHitboxRuntime(theme);
  HIT_BOXES = hitboxRuntime.hitBoxes;
  FILE_HIT_BOXES = hitboxRuntime.fileHitBoxes;
  WIDE_SVGS = hitboxRuntime.wideSvgs;
  SLEEPING_SVGS = hitboxRuntime.sleepingSvgs;

  currentHitBox = resolveHitBoxForSvg(currentSvg);
}

refreshTheme();

function shouldDropForDnd() {
  return !!ctx.doNotDisturb;
}

function scheduleAutoReturn(state) {
  autoReturnTimer = setTimeout(() => {
    autoReturnTimer = null;
    if (ctx.miniMode) {
      if (ctx.mouseOverPet && !ctx.doNotDisturb) {
        if (state === "mini-peek") {
          // Peek animation done — stay peeked but show idle (don't re-trigger peek)
          ctx.miniPeeked = true;
          applyState(hasOwnVisualFiles("mini-peek-hold") ? "mini-peek-hold" : "mini-idle");
        } else {
          ctx.miniPeekIn();
          applyState("mini-peek");
        }
      } else {
        applyState(ctx.doNotDisturb ? "mini-sleep" : "mini-idle");
      }
    } else {
      applyResolvedDisplayState();
    }
  }, AUTO_RETURN_MS[state]);
}

function clearPendingStateTimer() {
  if (!pendingTimer) return;
  clearTimeout(pendingTimer);
  pendingTimer = null;
  pendingState = null;
}

function setState(newState, svgOverride, options = {}) {
  if (shouldDropForDnd()) return;

  if (newState === "yawning" && SLEEP_SEQUENCE.has(currentState)) return;

  const sameMiniAlert = ctx.miniMode && logicalReminderState(newState) === "notification"
    && logicalReminderState(currentState) === "notification";
  const sameState = newState === currentState || sameMiniAlert;
  const sameSvg = sameMiniAlert || !svgOverride || svgOverride === currentSvg;
  // A Settings animation preview can hold the current visual under the same
  // state name a real event wants. Let the real event through once so it takes
  // the visual back and re-establishes everything from now. Repeated real
  // events still dedupe below.
  const realEventTakingOverPreview = currentVisualSource === VISUAL_SOURCE_SETTINGS_PREVIEW
    && options.settingsPreview !== true;
  if (sameState && sameSvg && !realEventTakingOverPreview) {
    if (options.restartAnimation === true) {
      if (pendingState && getStatePriority(newState, STATE_PRIORITY) < getStatePriority(pendingState, STATE_PRIORITY)) {
        return;
      }
      clearPendingStateTimer();
      applyState(newState, svgOverride, options);
      return;
    }
    if (AUTO_RETURN_MS[newState] && !autoReturnTimer && !pendingTimer) {
      scheduleAutoReturn(newState);
    }
    return;
  }

  // A preview is not a real display of this state, so its min-display hold must
  // not delay (or let the preview timer beat) the real event taking over.
  if (realEventTakingOverPreview) {
    options = { ...options, bypassMinDisplay: true };
  }

  if (pendingTimer) {
    if (pendingState && getStatePriority(newState, STATE_PRIORITY) < getStatePriority(pendingState, STATE_PRIORITY)) {
      return;
    }
    clearPendingStateTimer();
  }

  // Internal movement states such as free roam must be interruptible by direct
  // user interaction. Callers may bypass only the current state's display
  // hold; DND and pending-state priority checks above still apply unchanged.
  const minTime = options.bypassMinDisplay === true
    ? 0
    : (MIN_DISPLAY_MS[currentState] || 0);
  const elapsed = Date.now() - stateChangedAt;
  const remaining = minTime - elapsed;

  if (remaining > 0) {
    if (autoReturnTimer) { clearTimeout(autoReturnTimer); autoReturnTimer = null; }
    pendingState = newState;
    const pendingSvgOverride = svgOverride;
    const pendingOptions = options;
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      const queued = pendingState;
      const queuedSvg = pendingSvgOverride;
      const queuedOptions = pendingOptions || {};
      pendingState = null;
      if (ONESHOT_STATES.has(queued)) {
        applyState(queued, queuedSvg, queuedOptions);
      } else {
        const resolved = resolveDisplayState();
        applyState(resolved, getSvgOverride(resolved), queuedOptions);
      }
    }, remaining);
  } else {
    applyState(newState, svgOverride, options);
  }
}

function isOneshotDisabled(logicalState) {
  if (!ONESHOT_STATES.has(logicalState)) return false;
  if (typeof ctx.isOneshotDisabled !== "function") return false;
  try { return ctx.isOneshotDisabled(logicalState) === true; }
  catch { return false; }
}

function hasOwnVisualFiles(state) {
  return hasOwnVisualFilesWithBindings(STATE_BINDINGS, state);
}

function resolveVisualBinding(state) {
  if (state === "executing") return getSvgOverride(state);
  return resolveVisualBindingWithBindings(state, STATE_BINDINGS);
}

function applyResolvedDisplayState(options) {
  const resolved = resolveDisplayState();
  applyState(resolved, getSvgOverride(resolved), options || {});
}

function playWakeTransitionOrResolve() {
  if (SLEEP_MODE === "direct" && !hasOwnVisualFiles("waking")) {
    applyResolvedDisplayState();
    return;
  }
  applyState("waking");
}

function applyDndSleepState() {
  if (SLEEP_MODE === "direct") {
    applyState("sleeping");
    return;
  }
  if (DND_SLEEP_TRANSITION_SVG) {
    applyState("collapsing", DND_SLEEP_TRANSITION_SVG);
    return;
  }
  applyState(DND_SKIP_YAWN ? "collapsing" : "yawning");
}

function logicalReminderState(state) {
  return state === "mini-alert" ? "notification" : state;
}

function applyState(state, svgOverride, options = {}) {
  const applyOptions = options || {};
  // User-disabled oneshot state - skip visual + sound, fall back to whatever
  // resolveDisplayState picks (usually working/idle). Runs before the mini-mode
  // remap below so disabling a one-shot silences both normal and mini visuals.
  if (isOneshotDisabled(state)) {
    const resolved = resolveDisplayState();
    if (resolved !== state) {
      setState(resolved, getSvgOverride(resolved));
    }
    return;
  }

  if (ctx.miniTransitioning && !state.startsWith("mini-")) {
    return;
  }

  if (ctx.miniMode && !state.startsWith("mini-")) {
    // Every mini remap that actually lands must forward applyOptions so a
    // Settings preview keeps ownership of the visual it just put up.
    if (state === "notification") return applyState("mini-alert", undefined, applyOptions);
    if (state === "attention") return applyState("mini-happy", undefined, applyOptions);
    if (state === "working" || state === "executing" || state === "thinking" || state === "juggling") {
      if (hasOwnVisualFiles("mini-working")) return applyState("mini-working", undefined, applyOptions);
      return;
    }
    if ((AUTO_RETURN_MS[currentState] || currentState === "mini-working") && !autoReturnTimer) {
      return applyState(ctx.mouseOverPet ? "mini-peek" : "mini-idle", undefined, applyOptions);
    }
    return;
  }

  previousState = currentState;
  currentState = state;
  stableVisualPicker.retainOnly(getVisualState(state, STATE_SVGS));
  displayRevision += 1;
  currentVisualSource = applyOptions.settingsPreview === true
    ? VISUAL_SOURCE_SETTINGS_PREVIEW
    : null;
  stateChangedAt = Date.now();
  ctx.idlePaused = false;

  // Sound triggers. muteStateSounds is for re-applying a state the pet is
  // already in — handing an animation preview back — where the cue already
  // played when that state first arrived.
  if (!applyOptions.muteStateSounds) {
    if (state === "attention" || state === "mini-happy") {
      ctx.playSound("complete");
      if (ctx.flashTaskbar) ctx.flashTaskbar();
    } else if (state === "notification" || state === "mini-alert") {
      if (!applyOptions.muteNotificationSound) ctx.playSound("confirm");
    }
  }

  // No-override idle entries (e.g. roam ending) rest on the user-selected
  // idle visual instead of a random states.idle pick.
  const userIdle = (state === "idle" && !svgOverride && typeof ctx.getIdleVisualChoice === "function")
    ? ctx.getIdleVisualChoice()
    : null;
  const svg = svgOverride || userIdle || resolveVisualBinding(state);
  currentSvg = svg;

  // Force eye resend after SVG load completes (~300ms)
  // After sweeping → idle, pause eye tracking briefly so eyes stay centered before resuming
  if (eyeResendTimer) { clearTimeout(eyeResendTimer); eyeResendTimer = null; }
  if (state === "idle" || state === "mini-idle") {
    const afterSweep = previousState === "sweeping";
    const delay = afterSweep ? 800 : 300;
    if (afterSweep) ctx.eyePauseUntil = Date.now() + delay;
    eyeResendTimer = setTimeout(() => { eyeResendTimer = null; ctx.forceEyeResend = true; }, delay);
  }

  currentHitBox = resolveHitBoxForSvg(svg);

  if (applyOptions.restartAnimation === true) {
    ctx.sendToRenderer("state-change", state, svg, { restartAnimation: true });
  } else {
    ctx.sendToRenderer("state-change", state, svg);
  }
  ctx.syncHitWin();
  ctx.sendToHitWin("hit-state-sync", { currentState: state });
  ctx.sendToHitWin("hit-cancel-reaction");

  if (state !== "idle" && state !== "mini-idle") {
    ctx.sendToRenderer("eye-move", 0, 0);
  }

  if (isWakePollState(state) && !ctx.doNotDisturb) {
    scheduleWakePollStart(state);
  } else {
    stopWakePoll();
  }

  if (autoReturnTimer) clearTimeout(autoReturnTimer);
  if (state === "yawning") {
    autoReturnTimer = setTimeout(() => {
      autoReturnTimer = null;
      applyState(ctx.doNotDisturb ? "collapsing" : "dozing");
    }, YAWN_DURATION);
  } else if (state === "collapsing") {
    const dndCollapseDuration = (
      ctx.doNotDisturb
      && DND_SLEEP_TRANSITION_SVG
      && svg === DND_SLEEP_TRANSITION_SVG
      && DND_SLEEP_TRANSITION_DURATION > 0
    )
      ? DND_SLEEP_TRANSITION_DURATION
      : 0;
    const collapseDuration = dndCollapseDuration || COLLAPSE_DURATION;
    if (collapseDuration > 0) {
      autoReturnTimer = setTimeout(() => {
        autoReturnTimer = null;
        applyState("sleeping");
      }, collapseDuration);
    }
  } else if (state === "waking") {
    autoReturnTimer = setTimeout(() => {
      autoReturnTimer = null;
      applyResolvedDisplayState();
    }, WAKE_DURATION);
  } else if (state !== "mini-peek-hold" && state !== "mini-sleep-peek" && AUTO_RETURN_MS[state]) {
    scheduleAutoReturn(state);
  }
}

// ── Wake poll ──
function clearWakePollStartTimer() {
  if (!wakePollStartTimer) return;
  clearTimeout(wakePollStartTimer);
  wakePollStartTimer = null;
  wakePollStartState = null;
}

function scheduleWakePollStart(state) {
  if (wakePollTimer) return;
  if (wakePollStartTimer && wakePollStartState === state) return;
  clearWakePollStartTimer();
  wakePollStartState = state;
  wakePollStartTimer = setTimeout(() => {
    wakePollStartTimer = null;
    wakePollStartState = null;
    if (currentState === state) startWakePoll();
  }, WAKE_POLL_START_DELAY_MS);
}

function startWakePoll() {
  if (!_getCursor || wakePollTimer) return;
  if (!isWakePollState(currentState) || ctx.doNotDisturb) return;
  const cursor = _getCursor();
  lastWakeCursorX = cursor.x;
  lastWakeCursorY = cursor.y;
  scheduleWakePollTick();
}

function scheduleWakePollTick(delay = WAKE_POLL_MS) {
  if (!_getCursor || wakePollTimer) return;
  clearWakePollStartTimer();
  wakePollTimer = setTimeout(runWakePollTick, delay);
}

function runWakePollTick() {
  wakePollTimer = null;
  if (!_getCursor || !isWakePollState(currentState) || ctx.doNotDisturb) return;
  const cursor = _getCursor();
  const moved = cursor.x !== lastWakeCursorX || cursor.y !== lastWakeCursorY;

  if (moved) {
    stopWakePoll();
    wakeFromDoze();
    return;
  }

  if (currentState === "dozing" && Date.now() - ctx.mouseStillSince >= DEEP_SLEEP_TIMEOUT) {
    applyState("collapsing");
    scheduleWakePollTick();
    return;
  }

  scheduleWakePollTick();
}

function stopWakePoll() {
  clearWakePollStartTimer();
  if (wakePollTimer) { clearTimeout(wakePollTimer); wakePollTimer = null; }
}

function wakeFromDoze() {
  if (currentState === "sleeping" || currentState === "collapsing") {
    playWakeTransitionOrResolve();
    return;
  }
  ctx.sendToRenderer("wake-from-doze");
  setTimeout(() => {
    if (currentState === "dozing") {
      applyState("idle", getSvgOverride("idle"));
    }
  }, 350);
}

function pickDisplayHint(state, existing, incoming) {
  return pickDisplayHintWithMap(state, existing, incoming, DISPLAY_HINT_MAP);
}

function debugSession(msg) {
  if (typeof ctx.debugLog !== "function") return;
  try { ctx.debugLog(msg); } catch {}
}

function shouldAutoClearDetachedSession(session, badge) {
  return shouldAutoClearDetachedSessionWithDeps(session, badge, {
    sessionHudCleanupDetached: ctx.sessionHudCleanupDetached === true,
    isProcessAlive,
  });
}

function getSessionAliases() {
  if (typeof ctx.getSessionAliases !== "function") return {};
  const aliases = ctx.getSessionAliases();
  return aliases && typeof aliases === "object" && !Array.isArray(aliases)
    ? aliases
    : {};
}

function resolveAgentDisplayName(agentId) {
  const agent = agentId ? getAgent(agentId) : null;
  return agent ? agent.name : "";
}

function buildSessionSnapshot() {
  return buildSessionSnapshotFromSessions(sessions, {
    sessionAliases: getSessionAliases(),
    getAgentIconUrl,
    resolveAgentDisplayName,
    statePriority: STATE_PRIORITY,
    sessionHudCleanupDetached: ctx.sessionHudCleanupDetached === true,
    isProcessAlive,
  });
}

function getActiveSessionAliasKeys() {
  return getActiveSessionAliasKeysFromSessions(sessions);
}

function broadcastSessionSnapshot(snapshot) {
  if (typeof ctx.broadcastSessionSnapshot !== "function") return;
  try { ctx.broadcastSessionSnapshot(snapshot); } catch {}
}

function emitSessionSnapshot(options = {}) {
  const force = !!options.force;
  const snapshot = buildSessionSnapshot();
  const signature = sessionSnapshotSignature(snapshot);
  const changed = force || signature !== lastSessionSnapshotSignature;
  lastSessionSnapshot = snapshot;
  if (changed) {
    lastSessionSnapshotSignature = signature;
    broadcastSessionSnapshot(snapshot);
  }
  return { changed, snapshot };
}

function getLastSessionSnapshot() {
  if (!lastSessionSnapshot) lastSessionSnapshot = buildSessionSnapshot();
  return lastSessionSnapshot;
}

// ── Recap ──
function findSnapshotSession(snapshot, sessionId) {
  const entries = snapshot && Array.isArray(snapshot.sessions) ? snapshot.sessions : [];
  return entries.find((entry) => entry && entry.id === sessionId) || null;
}

function persistRecapMetrics(input, metrics) {
  let dedupeId = null;
  if (metrics.includes("session-start")) {
    dedupeId = `session-start:${input.rawSessionId}`;
  } else if (metrics.includes("tool-call") && input.toolUseId) {
    dedupeId = `tool-call:${input.toolUseId}`;
  }
  return recordCanonicalRecapEvent(recapSink, {
    occurredAt: input.occurredAt,
    agentId: input.agentId,
    scope: "local",
    metrics,
  }, {
    scopeId: "local",
    sessionId: input.rawSessionId || input.sessionId,
    dedupeId,
    sessionStartPartial: hasReusableDefaultIdentity(input.rawSessionId),
  });
}

// Record an accepted lifecycle event. A completion counts only when the
// snapshot it produced shows the session as done for that exact event.
function recordAcceptedRecapEvent(input, snapshot) {
  if (!input || !input.agentId || !input.event) return false;
  if (typeof ctx.isAgentEnabled === "function" && !ctx.isAgentEnabled(input.agentId)) return false;
  let completionAccepted = false;
  if (input.completionCandidate === true) {
    const entry = findSnapshotSession(snapshot, input.sessionId);
    const lastEvent = entry && entry.lastEvent;
    completionAccepted = !!(
      entry
      && entry.badge === "done"
      && lastEvent
      && lastEvent.rawEvent === input.event
      && Number.isSafeInteger(input.snapshotEventAt)
      && lastEvent.at === input.snapshotEventAt
    );
  }
  const metrics = mapRecapMetrics({ ...input, completionAccepted });
  if (!metrics) return false;
  try {
    return persistRecapMetrics(input, metrics);
  } catch (err) {
    console.warn("recap event rejected:", err && err.message ? err.message : "invalid event");
    return false;
  }
}

function describeSession(sessionId, session) {
  if (!session) return `sid=${sessionId} <deleted>`;
  return [
    `sid=${sessionId}`,
    `state=${session.state || "-"}`,
    `agent=${session.agentId || "-"}`,
    `agentPid=${session.agentPid || "-"}`,
    `sourcePid=${session.sourcePid || "-"}`,
    `pidReachable=${session.pidReachable ? 1 : 0}`,
    `headless=${session.headless ? 1 : 0}`,
  ].join(" ");
}

function resolvePidReachable(existing, agentPid, sourcePid) {
  if (agentPid && isProcessAlive(agentPid)) return true;
  if (sourcePid && isProcessAlive(sourcePid)) return true;
  return existing ? !!existing.pidReachable : false;
}

function deleteSession(sessionId) {
  return sessions.delete(sessionId);
}

function evictOldestSessionIfNeeded(sessionId) {
  if (sessions.has(sessionId) || sessions.size < MAX_SESSIONS) return;
  let oldestId = null;
  let oldestTime = Infinity;
  for (const [id, s] of sessions) {
    if (s.updatedAt < oldestTime) {
      oldestTime = s.updatedAt;
      oldestId = id;
    }
  }
  if (oldestId) deleteSession(oldestId);
}

function updateSessionMetadata(sessionId, opts = {}) {
  const id = typeof sessionId === "string" ? sessionId : "";
  if (!id) return false;
  const session = sessions.get(id);
  if (!session) {
    debugSession(`metadata-only drop sid=${id} reason=no-session`);
    return false;
  }
  const incomingTitle = typeof opts.sessionTitle === "string" ? normalizeTitle(opts.sessionTitle) : null;
  const incomingModel = typeof opts.model === "string" ? opts.model.trim() : "";
  if (!incomingTitle && !incomingModel) return false;
  let applied = false;
  if (incomingTitle && incomingTitle !== session.sessionTitle) {
    session.sessionTitle = incomingTitle;
    applied = true;
  }
  if (incomingModel && incomingModel !== session.model) {
    session.model = incomingModel;
    applied = true;
  }
  if (applied) emitSessionSnapshot();
  return true;
}

function updateSession(sessionId, state, event, opts = {}) {
  const recapOccurredAt = Date.now();
  let recapPendingInput = null;
  try {
    const {
      sourcePid = null,
      cwd = null,
      pidChain = null,
      tmuxSocket = null,
      tmuxClient = null,
      agentPid = null,
      agentId = null,
      profileId = "local",
      rawSessionId = null,
      headless = false,
      model = null,
      displayHint = undefined,
      sessionTitle = null,
      toolName = null,
      toolUseId = null,
      hookSource = null,
    } = opts;
    if (startupRecoveryActive) {
      startupRecoveryActive = false;
      if (startupRecoveryTimer) { clearTimeout(startupRecoveryTimer); startupRecoveryTimer = null; }
    }

    const existing = sessions.get(sessionId);
    const srcAgentId = agentId || (existing && existing.agentId) || null;
    const srcPid = sourcePid || (existing && existing.sourcePid) || null;
    const srcAgentPid = agentPid || (existing && existing.agentPid) || null;
    const srcPidChain = Array.isArray(pidChain) && pidChain.length
      ? pidChain.slice()
      : (existing && existing.pidChain) || null;
    const srcHeadless = headless || (existing && existing.headless) || false;
    // Sticky: an event without a title does not clear an existing one.
    const srcSessionTitle = normalizeTitle(sessionTitle) || (existing && existing.sessionTitle) || null;
    const srcToolName = normalizeToolName(toolName) || (existing && existing.lastToolName) || null;
    const duplicateCompletion = shouldSuppressDuplicateCompletionVisual(existing, state, event);

    debugSession(`event ${describeSession(sessionId, existing)} -> incoming=${state}/${event || "-"} hint=${displayHint || "-"} source=${hookSource || "-"}`);

    const recentEvents = shouldKeepExistingCompletionEventTail(existing, state, event)
      && Array.isArray(existing.recentEvents)
      ? (duplicateCompletion
        ? existing.recentEvents.slice()
        : markCompletionTailPresented(existing.recentEvents))
      : pushRecentEvent(existing, state, event);
    const recapSnapshotEvent = event && recentEvents.length > 0
      ? recentEvents[recentEvents.length - 1]
      : null;
    if (event && !(duplicateCompletion && isDoneEvent(event))) {
      recapPendingInput = {
        occurredAt: recapOccurredAt,
        sessionId,
        rawSessionId: (existing && existing.rawSessionId) || rawSessionId || sessionId,
        agentId: srcAgentId,
        event,
        snapshotEventAt: recapSnapshotEvent && recapSnapshotEvent.at,
        toolUseId,
        completionCandidate: !duplicateCompletion && isDoneEvent(event),
      };
    }

    const base = {
      sourcePid: srcPid,
      cwd: cwd || (existing && existing.cwd) || "",
      pidChain: srcPidChain,
      tmuxSocket: tmuxSocket || (existing && existing.tmuxSocket) || null,
      tmuxClient: tmuxClient || (existing && existing.tmuxClient) || null,
      agentPid: srcAgentPid,
      agentId: srcAgentId,
      profileId: (existing && existing.profileId) || profileId || "local",
      rawSessionId: (existing && existing.rawSessionId) || rawSessionId || sessionId,
      headless: srcHeadless,
      model: model || (existing && existing.model) || null,
      sessionTitle: srcSessionTitle,
      lastToolName: srcToolName,
      recentEvents,
      pidReachable: resolvePidReachable(existing, srcAgentPid, srcPid),
      awaitingInputSinceStop: resolveAwaitingInputSinceStop(existing, event),
    };

    evictOldestSessionIfNeeded(sessionId);

    if (event === "SessionEnd") {
      deleteSession(sessionId);
      debugSession(`session-end delete ${describeSession(sessionId, existing)}`);
      cleanStaleSessions();
      // /clear sends sweeping - play it even if other sessions are active
      // (sweeping is ONESHOT and auto-returns, so it won't interfere)
      if ((!existing || !existing.headless) && state === "sweeping") {
        setState("sweeping");
        return;
      }
      const displayState = resolveDisplayState();
      setState(displayState, getSvgOverride(displayState));
      return;
    }

    if (state === "attention" || state === "notification" || SLEEP_SEQUENCE.has(state) || ONESHOT_STATES.has(state)) {
      // One-shot visuals are presented once; the stored session rests idle.
      sessions.set(sessionId, { state: "idle", updatedAt: Date.now(), displayHint: null, ...base });
    } else {
      const dh = state === "idle" ? null : pickDisplayHint(state, existing, displayHint);
      sessions.set(sessionId, { state, updatedAt: Date.now(), displayHint: dh, ...base });
    }
    cleanStaleSessions();

    if (ONESHOT_STATES.has(state)) {
      if (duplicateCompletion || shouldSuppressDuplicateCompletionVisual(existing, state, event)) {
        const displayState = resolveDisplayState();
        setState(displayState, getSvgOverride(displayState));
        return;
      }
      setState(state, null, { notificationCue: state === "notification" });
      return;
    }

    const displayState = resolveDisplayState();
    setState(displayState, getSvgOverride(displayState));
  } finally {
    const recapSnapshot = emitSessionSnapshot().snapshot;
    if (recapPendingInput) recordAcceptedRecapEvent(recapPendingInput, recapSnapshot);
  }
}

function isProcessAlive(pid) {
  try { _kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

function cleanStaleSessions() {
  const now = Date.now();
  let changed = false;
  let snapshotRefreshNeeded = false;
  const staleConfig = typeof ctx.getStaleConfig === "function" ? ctx.getStaleConfig() : null;
  for (const [id, s] of sessions) {
    const decision = getStaleSessionDecision(s, {
      now,
      isProcessAlive,
      deriveSessionBadge,
      shouldAutoClearDetachedSession,
      staleConfig,
    });

    if (decision.snapshotRefreshNeeded) snapshotRefreshNeeded = true;

    if (decision.action === "delete") {
      const badgeSuffix = decision.reason === "detached-ended" ? ` badge=${decision.badge}` : "";
      debugSession(`stale-delete ${decision.reason} ${describeSession(id, s)}${badgeSuffix}`);
      deleteSession(id);
      changed = true;
      continue;
    }

    if (decision.action === "idle") {
      debugSession(`stale-idle ${decision.reason} ${describeSession(id, s)}`);
      s.state = "idle";
      s.displayHint = null;
      if (decision.updateTimestamp) s.updatedAt = now;
      changed = true;
    }
  }
  if (changed && sessions.size === 0) {
    setState("idle", getSvgOverride("idle"));
  } else if (changed) {
    const resolved = resolveDisplayState();
    setState(resolved, getSvgOverride(resolved));
  }
  if (changed || snapshotRefreshNeeded) emitSessionSnapshot();

  if (startupRecoveryActive && sessions.size === 0) {
    detectRunningAgentProcesses((found) => {
      if (!found) {
        startupRecoveryActive = false;
        if (startupRecoveryTimer) { clearTimeout(startupRecoveryTimer); startupRecoveryTimer = null; }
      }
    });
  }
}

function dismissSession(sessionId) {
  const id = typeof sessionId === "string" ? sessionId : "";
  if (!id) return false;
  if (!sessions.has(id)) return false;
  deleteSession(id);
  const resolved = resolveDisplayState();
  setState(resolved, getSvgOverride(resolved));
  emitSessionSnapshot({ force: true });
  return true;
}

function clearSessionsByAgent(agentId) {
  if (!agentId) return 0;
  let removed = 0;
  for (const [id, s] of sessions) {
    if (s && s.agentId === agentId) {
      deleteSession(id);
      removed++;
    }
  }
  if (removed > 0) {
    const resolved = resolveDisplayState();
    setState(resolved, getSvgOverride(resolved));
    emitSessionSnapshot();
  }
  return removed;
}

// Startup keep-awake fallback: an OMP CLI that was already running when the
// pet started has no session yet. A match only keeps startup recovery active;
// it never creates a session.
function detectRunningAgentProcesses(callback) {
  if (_detectInFlight) return;
  _detectInFlight = true;
  const done = (result) => { _detectInFlight = false; callback(result); };
  if (typeof ctx.isAgentEnabled === "function" && !ctx.isAgentEnabled("omp")) {
    done(false);
    return;
  }
  const { execFile } = require("child_process");
  execFile("pgrep", ["-f", OMP_CLI_COMMAND_LINE_MARKER], { timeout: 3000 }, (err) => done(!err));
}

function startStaleCleanup() {
  if (staleCleanupTimer) return;
  staleCleanupTimer = setInterval(cleanStaleSessions, 10000);
}

function stopStaleCleanup() {
  if (staleCleanupTimer) { clearInterval(staleCleanupTimer); staleCleanupTimer = null; }
}

function isPassivePetPresentation() {
  return SLEEP_SEQUENCE.has(currentState)
    || ["mini-idle", "mini-sleep", "mini-peek", "mini-peek-hold", "mini-sleep-peek"].includes(currentState);
}

function refreshPetPresentation() {
  const resolved = resolveDisplayState();
  if (resolved === "idle" && isPassivePetPresentation()) return;
  setState(resolved, getSvgOverride(resolved));
}

function resolveDisplayState() {
  return resolveDisplayStateFromSessions(sessions, { statePriority: STATE_PRIORITY });
}

function getSvgOverride(state) {
  return getSvgOverrideWithDeps(state, {
    idleFollowSvg: SVG_IDLE_FOLLOW,
    idleDefaultVisual: typeof ctx.getIdleVisualChoice === "function" ? ctx.getIdleVisualChoice() : null,
    sessions,
    displayHintMap: DISPLAY_HINT_MAP,
    theme,
    stateSvgs: STATE_SVGS,
    pickVisualFile: stableVisualPicker.pick,
  });
}

// ── Do Not Disturb ──
function enableDoNotDisturb() {
  if (ctx.doNotDisturb) return;
  ctx.doNotDisturb = true;
  ctx.sendToRenderer("dnd-change", true);
  ctx.sendToHitWin("hit-state-sync", { dndEnabled: true });
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; pendingState = null; }
  if (autoReturnTimer) { clearTimeout(autoReturnTimer); autoReturnTimer = null; }
  stopWakePoll();
  if (ctx.miniMode) {
    if (typeof ctx.cancelPendingMiniPeek === "function") ctx.cancelPendingMiniPeek(true);
    applyState("mini-sleep");
  } else {
    applyDndSleepState();
  }
  ctx.buildContextMenu();
  ctx.buildTrayMenu();
}

function disableDoNotDisturb() {
  if (!ctx.doNotDisturb) return;
  ctx.doNotDisturb = false;
  ctx.sendToRenderer("dnd-change", false);
  ctx.sendToHitWin("hit-state-sync", { dndEnabled: false });
  if (ctx.miniMode) {
    if (ctx.miniSleepPeeked) { ctx.miniPeekOut(); ctx.miniSleepPeeked = false; }
    ctx.miniPeeked = false;
    applyState("mini-idle");
  } else {
    playWakeTransitionOrResolve();
  }
  ctx.buildContextMenu();
  ctx.buildTrayMenu();
}

function startStartupRecovery() {
  startupRecoveryActive = true;
  startupRecoveryTimer = setTimeout(() => {
    startupRecoveryActive = false;
    startupRecoveryTimer = null;
  }, STARTUP_RECOVERY_MAX_MS);
}

function getCurrentState() { return currentState; }
function getDisplayRevision() { return displayRevision; }
function getCurrentSvg() { return currentSvg; }
// True while the last landed applyState was a Settings animation preview. The
// Settings runtime uses this to confirm its preview actually took the visual
// (an early return — mini transition, disabled one-shot — leaves it false) and
// so never records an owner it would later fail to release.
function isSettingsPreviewVisual() { return currentVisualSource === VISUAL_SOURCE_SETTINGS_PREVIEW; }
function getCurrentHitBox() { return currentHitBox; }
function getStartupRecoveryActive() { return startupRecoveryActive; }

function cleanup() {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingState = null;
  if (autoReturnTimer) clearTimeout(autoReturnTimer);
  if (eyeResendTimer) clearTimeout(eyeResendTimer);
  if (startupRecoveryTimer) clearTimeout(startupRecoveryTimer);
  stopWakePoll();
  stopStaleCleanup();
}

return {
  setState, applyState, updateSession, resolveDisplayState, resolveVisualBinding,
  shouldDropForDnd,
  enableDoNotDisturb, disableDoNotDisturb,
  startStaleCleanup, stopStaleCleanup, startWakePoll, stopWakePoll,
  getSvgOverride, refreshPetPresentation, cleanStaleSessions, startStartupRecovery, refreshTheme,
  detectRunningAgentProcesses, buildSessionSnapshot,
  emitSessionSnapshot, broadcastSessionSnapshot, getLastSessionSnapshot,
  getActiveSessionAliasKeys,
  dismissSession,
  updateSessionMetadata,
  clearSessionsByAgent,
  deriveSessionBadge,
  getCurrentState, getDisplayRevision, getCurrentSvg, getCurrentHitBox, resolveHitBoxForSvg, getStartupRecoveryActive, isSettingsPreviewVisual,
  sessions, STATE_PRIORITY, ONESHOT_STATES, SLEEP_SEQUENCE,
  get STATE_SVGS() { return STATE_SVGS; },
  get HIT_BOXES() { return HIT_BOXES; },
  get FILE_HIT_BOXES() { return FILE_HIT_BOXES; },
  get WIDE_SVGS() { return WIDE_SVGS; },
  get SLEEPING_SVGS() { return SLEEPING_SVGS; },
  cleanup,
};

};
