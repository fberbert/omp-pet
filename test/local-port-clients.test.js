"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
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

test("the CJS config reader and the OMP extension share local-port semantics and app validation", async () => {
  const readers = [() => config.readRuntimePort({runtimeConfigPath:runtimePath}), omp.readRuntimePort];
  for (const {value,port} of values) {
    runtime(value);
    for (const read of readers) assert.equal(await read(),port,JSON.stringify(value));
  }
  runtime(45000,{app:"foreign"});
  for (const read of readers) assert.equal(await read(),null);
});

