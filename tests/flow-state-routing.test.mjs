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

  it("regenerates the publication run id when preparing persisted state for resume", () => {
    const scopeKey = "ag-75@test";
    const flowId = "review";
    const state = flowStateModule.createFlowRunState(
      scopeKey,
      flowId,
      {
        runId: "run-1",
        publicationRunId: "attempt-1",
        flowKind: "review",
        flowVersion: 1,
        terminated: false,
        phases: [
          {
            id: "review",
            status: "running",
            repeatVars: {},
            steps: [
              {
                id: "write_review",
                status: "running",
              },
            ],
          },
        ],
      },
      null,
    );

    const resumed = flowStateModule.prepareFlowStateForResume(state);

    assert.equal(resumed.executionState.runId, "run-1");
    assert.notEqual(resumed.executionState.publicationRunId, "attempt-1");
    assert.equal(typeof resumed.executionState.publicationRunId, "string");
    assert.equal(resumed.executionState.phases[0].status, "pending");
    assert.equal(resumed.executionState.phases[0].steps[0].status, "pending");
  });

  it("preserves explicit flow-run resume payloads while resetting running steps to pending", () => {
    const scopeKey = "ag-76@test";
    const flowId = "auto-common";
    const state = flowStateModule.createFlowRunState(
      scopeKey,
      flowId,
      {
        runId: "run-2",
        publicationRunId: "attempt-2",
        flowKind: "auto-common",
        flowVersion: 1,
        terminated: false,
        phases: [
          {
            id: "review-loop",
            status: "running",
            repeatVars: {},
            steps: [
              {
                id: "run_review_loop",
                status: "running",
                value: {
                  resumeKind: "flow-run",
                  flowKind: "review-loop-flow",
                  flowVersion: 1,
                  executionState: {
                    flowKind: "review-loop-flow",
                    flowVersion: 1,
                    terminated: false,
                    phases: [
                      {
                        id: "review_iteration_1",
                        status: "done",
                        repeatVars: {},
                        steps: [
                          {
                            id: "run_review",
                            status: "done",
                          },
                        ],
                      },
                    ],
                  },
                  publishedArtifacts: [],
                },
              },
            ],
          },
        ],
      },
      null,
    );

    const resumed = flowStateModule.prepareFlowStateForResume(state);
    const step = resumed.executionState.phases[0].steps[0];

    assert.equal(step.status, "pending");
    assert.equal(step.value.resumeKind, "flow-run");
    assert.equal(step.value.executionState.flowKind, "review-loop-flow");
  });

  it("strips unrelated running-step payloads during resume normalization", () => {
    const scopeKey = "ag-77@test";
    const flowId = "auto-common";
    const state = flowStateModule.createFlowRunState(
      scopeKey,
      flowId,
      {
        runId: "run-3",
        publicationRunId: "attempt-3",
        flowKind: "auto-common",
        flowVersion: 1,
        terminated: false,
        phases: [
          {
            id: "review-loop",
            status: "running",
            repeatVars: {},
            steps: [
              {
                id: "run_review_loop",
                status: "running",
                value: {
                  transient: true,
                },
              },
            ],
          },
        ],
      },
      null,
    );

    const resumed = flowStateModule.prepareFlowStateForResume(state);
    const step = resumed.executionState.phases[0].steps[0];

    assert.equal(step.status, "pending");
    assert.equal("value" in step, false);
  });
});
