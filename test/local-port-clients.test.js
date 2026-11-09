"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { stripTypeScriptTypes } = require("node:module");
const { pathToFileURL } = require("node:url");
const config = require("../hooks/server-config");
const values = require("./fixtures/local-port-values.json");
const root = path.join(__dirname, "..");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-local-port-clients-"));
const runtimePath = path.join(home, ".omp-pet", "runtime.json");
const envBefore = { ...process.env };
let omp;

// Load the actual deployed modules with extra test exports. Type stripping
// removes only types; all discovery and network behavior below is production.
async function instrument(relative, exports, ts = false) {
  let source = fs.readFileSync(path.join(root, relative), "utf8");
  if (ts) {
    source = stripTypeScriptTypes(source);
    source = source.replace(/from "(\.\/[^"\n]+)"/g, (_all, file) =>
      `from ${JSON.stringify(pathToFileURL(path.resolve(root, path.dirname(relative), file)).href)}`);
  }
  return import(`data:text/javascript;base64,${Buffer.from(source + `\nexport { ${exports} };`).toString("base64")}`);
}

before(async () => {
  for (const key of Object.keys(process.env)) {
    if (/^(CLAWD_|PI_|OMP_)/.test(key)) delete process.env[key];
  }
  Object.assign(process.env, { HOME:home, USERPROFILE:home, APPDATA:home, LOCALAPPDATA:home,
    HOMEDRIVE:path.parse(home).root.replace(/[\\/]$/, ""), HOMEPATH:home.slice(path.parse(home).root.length - 1),
    PYTHONDONTWRITEBYTECODE:"1" });
  assert.equal(os.homedir(), home, "isolation must be effective before any module loads");
  fs.mkdirSync(path.dirname(runtimePath), { recursive:true });
  omp = await instrument("hooks/omp-extension.ts", "readRuntimePort, postState", true);
});
after(async () => {
  for (const key of Object.keys(process.env)) if (!(key in envBefore)) delete process.env[key];
  Object.assign(process.env, envBefore);
  await fs.promises.rm(home, { recursive:true, force:true, maxRetries:3 });
});
function runtime(value, overrides = {}) {
  fs.writeFileSync(runtimePath, JSON.stringify({ app:"omp-pet", port:value, ownerPid:process.pid, ...overrides }), { mode:0o600 });
}
async function listener() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      requests.push({ path:req.url, method:req.method, body:body ? JSON.parse(body) : null });
      res.writeHead(200, { "x-omp-pet-server":"omp-pet", "content-type":"application/json" });
      res.end(JSON.stringify(req.method === "GET" ? {app:"omp-pet",ok:true} : {decision:"allow"}));
    });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0,"127.0.0.1",resolve); });
  return { server, requests, port:server.address().port, async close() {
    if (!server.listening) return;
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  } };
}
async function until(predicate) {
  const end = Date.now()+3000;
  while (!predicate()) {
    assert.ok(Date.now()<end, "expected state delivery did not arrive");
    await new Promise(resolve => setTimeout(resolve,10));
  }
}

test("the CJS config reader and the OMP extension share local-port semantics and app validation", async () => {
  const readers = [() => config.readRuntimePort({runtimeConfigPath:runtimePath}), omp.readRuntimePort];
  for (const {value,port} of values) {
    runtime(value);
    for (const read of readers) assert.equal(await read(),port,JSON.stringify(value));
  }
  runtime(45000,{app:"foreign"});
  for (const read of readers) assert.equal(await read(),null);
});

test("CJS dynamic runtime round-trips; CLI installers reject stale owners and remote stays fixed", () => {
  assert.equal(config.writeRuntimeConfig(45000,{runtimeConfigPath:runtimePath}),true);
  assert.equal(config.readRuntimePort({runtimeConfigPath:runtimePath}),45000);
  assert.equal(config.resolveInstallServerPort(undefined,{runtimeConfigPath:runtimePath,isProcessAlive:()=>true}),45000);
  assert.equal(config.resolveInstallServerPort(undefined,{runtimeConfigPath:runtimePath,isProcessAlive:()=>false}),23533);
  assert.equal(config.resolveInstallServerPort(45002,{runtimeConfigPath:runtimePath,isProcessAlive:()=>false}),45002);
  assert.deepEqual(config.getPortCandidates(undefined,{runtimePort:"45000",sshSecure:false}),[45000,...config.SERVER_PORTS]);
  assert.deepEqual(config.getPortCandidates(undefined,{runtimePort:[],sshSecure:false}),config.SERVER_PORTS);
  const remote = {version:2,layoutVersion:1,runtimeKey:"a",profileId:"b",installId:"a".repeat(64),remotePort:45000,routingNonce:"b".repeat(32),deployedAt:123};
  assert.equal(config.readRemoteIdentity({readFileSync:()=>JSON.stringify(remote)}).ok,false);
});

test("restart hints persist independently, reject corrupt content, and never become client targets", () => {
  const hints = require("../src/local-server-port-hint");
  const options = {homeDir:home};
  const file = path.join(home,".omp-pet","local-server-port.json");
  assert.equal(hints.writeLocalServerPortHint(45000,options),true);
  runtime(45000);
  config.clearRuntimeConfig(runtimePath);
  assert.equal(hints.readLocalServerPortHint(options),45000);
  assert.equal(config.readRuntimePort({runtimeConfigPath:runtimePath}),null);
  assert.equal(config.resolveInstallServerPort(undefined,{runtimeConfigPath:runtimePath}),23533);
  for (const body of ["bad",JSON.stringify({app:"foreign",port:45000}),JSON.stringify({app:"omp-pet",port:23533})," ".repeat(1025)]) {
    fs.writeFileSync(file,body);
    assert.equal(hints.readLocalServerPortHint(options),null);
  }
  for (const port of [0,80,23533,65536]) assert.equal(hints.writeLocalServerPortHint(port,options),false);
});

test("each client sends to the dynamic runtime port and follows it after a restart", async (t) => {
  const senders = [
    ["CJS", body => new Promise(resolve => config.postStateToRunningServer(body,{runtimePort:config.readRuntimePort({runtimeConfigPath:runtimePath}),sshSecure:false},resolve))],
    ["OMP",body => omp.postState(body)],
  ];
  for (const [name,send] of senders) {
    const old = await listener(), next = await listener();
    t.after(() => old.close()); t.after(() => next.close());
    runtime(old.port);
    const body = {agent_id:"omp",session_id:`test-${name}`,state:"working",event:"PreToolUse"};
    await send(body); await until(() => old.requests.some(r=>r.method==="POST"));
    runtime(next.port);
    await old.close();
    await send({...body,event:"PostToolUseFailure",state:"error"});
    await until(() => next.requests.some(r=>r.method==="POST"));
    assert.equal(next.requests.filter(r=>r.method==="POST").length,1,name);
    await next.close();
  }
});
