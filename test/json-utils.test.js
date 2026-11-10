const { describe, it } = require("node:test");
const assert = require("node:assert");
const { asarUnpackedPath } = require("../hooks/json-utils");

// Hook command format depends on real-environment WSL signals; clear them so
// assertions stay deterministic when the suite itself runs inside WSL.
delete process.env.CLAWD_WSL_DISTRO;
delete process.env.WSL_DISTRO_NAME;

describe("asarUnpackedPath", () => {
  it("rewrites an app.asar path segment to app.asar.unpacked", () => {
    assert.strictEqual(
      asarUnpackedPath("/Applications/Clawd.app/Contents/Resources/app.asar/hooks/clawd-hook.js"),
      "/Applications/Clawd.app/Contents/Resources/app.asar.unpacked/hooks/clawd-hook.js"
    );
    assert.strictEqual(
      asarUnpackedPath("C:/Program Files/Clawd on Desk/resources/app.asar/hooks/clawd-hook.js"),
      "C:/Program Files/Clawd on Desk/resources/app.asar.unpacked/hooks/clawd-hook.js"
    );
  });

  it("is a no-op for source-tree paths with no app.asar segment", () => {
    const sourcePath = "/home/dev/clawd-on-desk/hooks/clawd-hook.js";
    assert.strictEqual(asarUnpackedPath(sourcePath), sourcePath);
  });

  it("only rewrites the first app.asar/ occurrence", () => {
    assert.strictEqual(
      asarUnpackedPath("/a/app.asar/nested/app.asar/hooks/clawd-hook.js"),
      "/a/app.asar.unpacked/nested/app.asar/hooks/clawd-hook.js"
    );
  });
});

// statusLine settings have no `shell` field, so unlike hook commands the
// string must parse under Git Bash AND PowerShell (Claude Code picks per
// machine) and ideally cmd (Antigravity). The load-bearing property: the
// command token is never quoted and never prefixed with `&`.

