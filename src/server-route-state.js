"use strict";

const path = require("path");
const { resolveSessionIdentity } = require("./session-key");
const {
  CLAWD_SERVER_HEADER,
  CLAWD_SERVER_ID,
} = require("../hooks/server-config");
const { resolveHookAgentId } = require("./server-agent-id");

// /state POST body size cap. OMP payloads are a few hundred bytes; the cap
// only bounds what a misbehaving local client can make the server buffer.
const MAX_STATE_BODY_BYTES = 16 * 1024;

function positiveInt(value) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeTmuxSocket(value) {
  if (typeof value !== "string") return null;
  if (/^[\w.-]{1,64}$/.test(value)) return value;
  return value.startsWith("/") && value.length <= 4096 && !/[\0\r\n]/.test(value)
    ? value
    : null;
}

function normalizeTmuxClient(value) {
  return typeof value === "string"
    && value.length <= 256
    && !value.startsWith("-")
    && /^[\w./:-]+$/.test(value)
    ? value
    : null;
}

function reply(res, status, body) {
  res.writeHead(status, { [CLAWD_SERVER_HEADER]: CLAWD_SERVER_ID });
  res.end(body);
}

function sendStateHealthResponse(res, options) {
  const body = JSON.stringify({ ok: true, app: CLAWD_SERVER_ID, port: options.getHookServerPort() });
  res.writeHead(200, {
    "Content-Type": "application/json",
    [CLAWD_SERVER_HEADER]: CLAWD_SERVER_ID,
  });
  res.end(body);
}

function handleStatePost(req, res, options) {
  const {
    ctx,
    createRequestHookRecorder,
    shouldDropForDnd,
    pathApi = path,
  } = options;
  let body = "";
  let bodySize = 0;
  let tooLarge = false;
  req.on("data", (chunk) => {
    if (tooLarge) return;
    bodySize += chunk.length;
    if (bodySize > MAX_STATE_BODY_BYTES) { tooLarge = true; return; }
    body += chunk;
  });
  req.on("end", () => {
    if (tooLarge) {
      res.writeHead(413);
      res.end("state payload too large");
      return;
    }
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      res.writeHead(400);
      res.end("bad json");
      return;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      res.writeHead(400);
      res.end("bad json");
      return;
    }

    const agentIdentity = resolveHookAgentId(data);
    const recordRequestHookEvent = createRequestHookRecorder(agentIdentity, data, "state");
    if (agentIdentity.rejected) {
      recordRequestHookEvent.droppedInvalidAgent();
      reply(res, 204);
      return;
    }
    const agentId = agentIdentity.agentId;
    // Disabled agent: answer quickly so the extension never waits on us.
    if (typeof ctx.isAgentEnabled === "function" && !ctx.isAgentEnabled(agentId)) {
      recordRequestHookEvent.droppedByDisabled();
      reply(res, 204);
      return;
    }

    let { state } = data;
    const { svg, event } = data;
    // executing is a server-derived hint, never an inbound claim.
    if (state === "executing") state = "working";
    if (typeof state !== "string" || !ctx.STATE_SVGS[state]) {
      res.writeHead(400);
      res.end("unknown state");
      return;
    }
    if (state.startsWith("mini-") && !svg) {
      res.writeHead(400);
      res.end("mini states require svg override");
      return;
    }

    const rawSessionId = nonEmptyString(data.session_id) || `${agentId}:default`;
    const sessionIdentity = resolveSessionIdentity(rawSessionId, "local", "default");
    const sid = sessionIdentity.sessionId;

    let displayHint;
    if (data.display_svg === null) displayHint = null;
    else if (typeof data.display_svg === "string") displayHint = pathApi.basename(data.display_svg);
    else displayHint = undefined;

    recordRequestHookEvent.acceptedUnlessDnd(shouldDropForDnd());
    if (typeof svg === "string" && svg) {
      ctx.setState(state, pathApi.basename(svg), { notificationCue: state === "notification" });
    } else {
      ctx.updateSession(sid, state, event, {
        agentId,
        profileId: sessionIdentity.profileId,
        rawSessionId: sessionIdentity.rawSessionId,
        sourcePid: positiveInt(data.source_pid),
        agentPid: positiveInt(data.agent_pid),
        pidChain: Array.isArray(data.pid_chain)
          ? data.pid_chain.filter((n) => Number.isFinite(n) && n > 0).slice(0, 12)
          : null,
        cwd: typeof data.cwd === "string" ? data.cwd : "",
        tmuxSocket: normalizeTmuxSocket(data.tmux_socket),
        tmuxClient: normalizeTmuxClient(data.tmux_client),
        headless: data.headless === true,
        model: nonEmptyString(data.model),
        displayHint,
        sessionTitle: nonEmptyString(data.session_title),
        toolName: nonEmptyString(data.tool_name),
        toolUseId: nonEmptyString(data.tool_use_id),
        hookSource: nonEmptyString(data.hook_source),
        ...(agentIdentity.defaulted ? { agentIdDefaulted: true } : {}),
      });
    }
    reply(res, 200, "ok");
  });
}

module.exports = {
  MAX_STATE_BODY_BYTES,
  handleStatePost,
  sendStateHealthResponse,
};
