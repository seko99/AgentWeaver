import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const distIndex = path.resolve(process.cwd(), "dist/index.js");

let tempDir;
let originalCwd;

function scopeHash(projectRoot) {
  return crypto.createHash("sha1").update(projectRoot).digest("hex").slice(0, 8);
}

function scopeKeyForIssue(issueKey) {
  return `${issueKey.toLowerCase()}@${scopeHash(tempDir)}`;
}

beforeEach(() => {
  originalCwd = process.cwd();
  tempDir = mkdtempSync(path.join(os.tmpdir(), "agentweaver-flow-launch-modes-"));
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tempDir, { recursive: true, force: true });
});

describe("CLI launch mode selection", () => {
  it("requires an explicit action in non-interactive mode when continue and restart are both valid", () => {
    const issueKey = "AG-90";
    const scopeKey = scopeKeyForIssue(issueKey);
    const stateFile = path.join(
      tempDir,
      ".agentweaver",
      "scopes",
      scopeKey,
      ".artifacts",
      ".agentweaver-flow-state-review-loop.json",
    );
    mkdirSync(path.dirname(stateFile), { recursive: true });
    writeFileSync(stateFile, `${JSON.stringify({
      schemaVersion: 3,
      flowId: "review-loop",
      scopeKey,
      jiraRef: issueKey,
      status: "completed",
      currentStep: null,
      updatedAt: "2026-04-22T00:00:00.000Z",
      continuation: {
        continueEligible: true,
        stopPhaseId: "terminal_verification",
        stopStepId: "assert_terminal_success",
      },
      executionState: {
        flowKind: "review-loop-flow",
        flowVersion: 1,
        terminated: true,
        terminationOutcome: "stopped",
        terminationReason: "Stopped by terminal_verification:assert_terminal_success",
        phases: [],
      },
    }, null, 2)}\n`, "utf8");

    const result = spawnSync("node", [distIndex, "review-loop", "--dry", issueKey], {
      cwd: tempDir,
      encoding: "utf8",
      timeout: 15000,
      env: {
        ...process.env,
        CODEX_BIN: "/bin/echo",
      },
    });

    assert.notEqual(result.status, 0);
  });
});
