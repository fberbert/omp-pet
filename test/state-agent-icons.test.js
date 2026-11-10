"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { fileURLToPath } = require("url");

const { getAllAgents } = require("../agents/registry");
const {
  AGENT_ICON_DIR,
  getAgentIcon,
  getAgentIconPath,
  getAgentIconUrl,
} = require("../src/state-agent-icons");

function readPngSize(filePath) {
  const buffer = fs.readFileSync(filePath);
  assert.strictEqual(buffer.toString("ascii", 1, 4), "PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe("state agent icons", () => {
  it("returns undefined for menu icons when nativeImage is unavailable", () => {
    assert.strictEqual(getAgentIcon("omp"), undefined);
  });

  it("returns null for missing agent ids and path traversal", () => {
    assert.strictEqual(getAgentIconUrl(null), null);
    assert.strictEqual(getAgentIconUrl(""), null);
    assert.strictEqual(getAgentIconUrl("missing-agent"), null);
    assert.strictEqual(getAgentIconUrl("../omp"), null);
  });

  it("returns a file URL for the bundled OMP icon", () => {
    const iconUrl = getAgentIconUrl("omp");
    assert.strictEqual(new URL(iconUrl).protocol, "file:");
    assert.strictEqual(path.normalize(fileURLToPath(iconUrl)), path.join(AGENT_ICON_DIR, "omp.png"));
    assert.strictEqual(getAgentIconPath("omp"), path.join(AGENT_ICON_DIR, "omp.png"));
  });

  it("ships exactly one 64x64 runtime PNG per registered agent", () => {
    const files = fs.readdirSync(AGENT_ICON_DIR).filter((name) => !name.startsWith(".")).sort();
    assert.deepStrictEqual(files, getAllAgents().map((agent) => `${agent.id}.png`).sort());
    for (const name of files) {
      assert.deepStrictEqual(readPngSize(path.join(AGENT_ICON_DIR, name)), { width: 64, height: 64 }, name);
    }
  });
});
