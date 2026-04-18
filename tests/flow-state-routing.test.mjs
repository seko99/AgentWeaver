import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");

let originalCwd;
let tempDir;
let flowStateModule;
let routingModule;

beforeEach(async () => {
  originalCwd = process.cwd();
  tempDir = mkdtempSync(path.join(os.tmpdir(), "agentweaver-flow-state-"));
  process.chdir(tempDir);
  flowStateModule = await import(
    `${pathToFileURL(path.join(distRoot, "flow-state.js")).href}?cwd=${Date.now()}`
  );
  routingModule = await import(
    `${pathToFileURL(path.join(distRoot, "runtime/execution-routing.js")).href}?cwd=${Date.now()}`
  );
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tempDir, { recursive: true, force: true });
});

describe("flow state routing persistence", () => {
  it("upgrades schema version 1 launch-profile state into schema version 2 execution routing", () => {
    const scopeKey = "ag-73@test";
    const flowId = "implement";
    const actualStateFile = path.join(
      tempDir,
      ".agentweaver",
      "scopes",
      scopeKey,
      ".artifacts",
      `.agentweaver-flow-state-${encodeURIComponent(flowId)}.json`,
    );
    mkdirSync(path.dirname(actualStateFile), { recursive: true });
    writeFileSync(actualStateFile, `${JSON.stringify({
      schemaVersion: 1,
      flowId,
      scopeKey,
      status: "running",
      currentStep: "implement:run_implement",
      updatedAt: "2026-04-18T00:00:00.000Z",
      launchProfile: {
        executor: "codex",
        model: "gpt-5.4",
        selectedExecutor: "codex",
        selectedModel: "gpt-5.4",
        fingerprint: "codex::gpt-5.4",
      },
      executionState: {
        flowKind: "implement",
        flowVersion: 1,
        terminated: false,
        phases: [],
      },
    }, null, 2)}\n`, "utf8");

    const state = flowStateModule.loadFlowRunState(scopeKey, flowId);

    assert.equal(state.schemaVersion, 2);
    assert.equal(state.executionRouting.defaultRoute.executor, "codex");
    assert.equal(state.executionRouting.defaultRoute.model, "gpt-5.4");
    assert.equal(state.routingFingerprint, state.executionRouting.fingerprint);
    assert.equal(state.selectedRoutingPreset.label, "Legacy launch profile");
  });

  it("persists execution routing and routing fingerprint in schema version 2 state", () => {
    const scopeKey = "ag-74@test";
    const flowId = "review";
    const routing = routingModule.resolveExecutionRouting({ presetId: "balanced" });
    const state = flowStateModule.createFlowRunState(
      scopeKey,
      flowId,
      {
        flowKind: "review",
        flowVersion: 1,
        terminated: false,
        phases: [],
      },
      null,
      routing.defaultRoute,
      routing,
      { kind: "built-in", presetId: "balanced", label: "Balanced" },
    );

    flowStateModule.saveFlowRunState(state);

    const saved = JSON.parse(
      readFileSync(
        path.join(
          tempDir,
          ".agentweaver",
          "scopes",
          scopeKey,
          ".artifacts",
          `.agentweaver-flow-state-${encodeURIComponent(flowId)}.json`,
        ),
        "utf8",
      ),
    );
    assert.equal(saved.schemaVersion, 2);
    assert.equal(saved.executionRouting.fingerprint, routing.fingerprint);
    assert.equal(saved.routingFingerprint, routing.fingerprint);
    assert.equal(saved.selectedRoutingPreset.label, "Balanced");
  });
});
