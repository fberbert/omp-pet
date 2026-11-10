"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const src = path.join(__dirname, "..", "src");

test("Settings choice semantics are owned by the shared primitives", () => {
  const files = fs.readdirSync(src).filter((name) => /^settings.*\.(js|html)$/.test(name));
  const offenders = [];
  for (const name of files) {
    if (name === "settings-ui-core.js") continue;
    let source = fs.readFileSync(path.join(src, name), "utf8");
    // Theme Card is an intentional radio-like surface, not a segmented enum.
    if (name === "settings-tab-theme.js") {
      assert.equal(source.match(/card\.setAttribute\("role", "radio"\);/g)?.length, 1);
      source = source.replace('card.setAttribute("role", "radio");', "");
    }
    const handwrittenRole = /setAttribute\(\s*["']role["']\s*,\s*["'](?:tablist|tab|tabpanel|radiogroup|radio)["']/;
    const templateRole = /role\s*=\s*["'](?:tablist|tab|tabpanel|radiogroup|radio)["']/;
    const handwrittenSegment = /className\s*=\s*["'`][^"'`\n]*\bsegmented\b|classList\.add\(\s*["']segmented["']/;
    if (handwrittenRole.test(source) || templateRole.test(source) || handwrittenSegment.test(source)) offenders.push(name);
  }
  assert.deepEqual(offenders, [], "new Settings tabs/segmented controls must use shared primitives");
});

