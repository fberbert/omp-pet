const { describe, it } = require("node:test");
const assert = require("node:assert");
const { computeOverall, runDoctorChecks } = require("../src/doctor");

describe("doctor aggregate checks", () => {
  it("computes red overall when any check is critical", () => {
    assert.deepStrictEqual(
      computeOverall([
        { status: "pass" },
        { status: "fail", level: "critical" },
        { status: "fail", level: "warning" },
      ]),
      { status: "critical", level: "critical", issueCount: 2 }
    );
  });

  it("computes yellow overall when warnings exist without critical failures", () => {
    assert.deepStrictEqual(
      computeOverall([
        { status: "pass" },
        { status: "fail", level: "warning" },
      ]),
      { status: "warning", level: "warning", issueCount: 1 }
    );
  });

  it("computes green overall when all checks pass or info", () => {
    assert.deepStrictEqual(
      computeOverall([
        { status: "pass" },
        { status: "suppressed-by-dnd", level: "info" },
      ]),
      { status: "pass", level: null, issueCount: 0 }
    );
  });

  it("surfaces a recovered malformed prefs snapshot as non-authoritative", () => {
    const result = runDoctorChecks({
      prefsRecovered: true,
      checkLocalServer: () => ({ id: "local-server", status: "pass" }),
      checkAgentIntegrations: () => ({ id: "agent-integrations", status: "pass" }),
      checkPermissionBubblePolicy: () => ({ id: "permission-bubble-policy", status: "pass" }),
      checkFeishuApproval: () => ({ id: "feishu-approval", status: "pass" }),
      checkThemeHealth: () => ({ id: "theme-health", status: "pass" }),
    });
    const prefs = result.checks.find((check) => check.id === "prefs-readability");
    assert.strictEqual(prefs.status, "critical");
    assert.strictEqual(prefs.reason, "prefs-recovered");
    assert.match(prefs.detail, /clawd-prefs\.json\.bak/);
    assert.match(prefs.detail, /paused for this launch/i);
  });

  it("does not claim an invalid prefs backup exists when backup creation failed", () => {
    const result = runDoctorChecks({
      prefsReadFailure: true,
      prefsRecoveryBackupFailed: true,
      checkLocalServer: () => ({ id: "local-server", status: "pass" }),
      checkAgentIntegrations: () => ({ id: "agent-integrations", status: "pass" }),
      checkPermissionBubblePolicy: () => ({ id: "permission-bubble-policy", status: "pass" }),
      checkFeishuApproval: () => ({ id: "feishu-approval", status: "pass" }),
      checkThemeHealth: () => ({ id: "theme-health", status: "pass" }),
    });
    const prefs = result.checks.find((check) => check.id === "prefs-readability");
    assert.strictEqual(prefs.reason, "prefs-recovery-backup-failed");
    assert.match(prefs.detail, /kept unchanged/i);
    assert.doesNotMatch(prefs.detail, /backed up as/i);
  });
});
