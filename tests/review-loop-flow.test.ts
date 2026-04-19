import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { loadDeclarativeFlow } from "../src/pipeline/declarative-flows.js";
import { createNodeRegistry } from "../src/pipeline/node-registry.js";
import { readyToMergeFile } from "../src/artifacts.js";
import { evaluateCondition } from "../src/pipeline/value-resolver.js";
import { resolveReviewLoopBaseIteration } from "../src/pipeline/review-iteration.js";

const TEST_TASK_KEY = "REVIEW-LOOP-TEST-1";
const REPEATED_ACTUAL_ITERATION_SPEC = {
  add: [
    { ref: "params.baseIteration" },
    { ref: "repeat.iteration" },
    { const: -1 },
  ],
};
const TERMINAL_ACTUAL_ITERATION_SPEC = {
  add: [
    { ref: "params.baseIteration" },
    { const: 5 },
  ],
};

function setupTestScope(): void {
  const artifactsDir = join(process.cwd(), ".agentweaver", "scopes", TEST_TASK_KEY, ".artifacts");
  mkdirSync(artifactsDir, { recursive: true });
}

function cleanupTestScope(): void {
  const scopeDir = join(process.cwd(), ".agentweaver", "scopes", TEST_TASK_KEY);
  if (existsSync(scopeDir)) {
    rmSync(scopeDir, { recursive: true, force: true });
  }
}

describe("clear-ready-to-merge node", () => {
  it("should be registered in node registry", async () => {
    const registry = createNodeRegistry();
    expect(registry.has("clear-ready-to-merge")).toBe(true);
  });

  it("should remove ready-to-merge file and return cleared true when file exists", async () => {
    const registry = createNodeRegistry();
    const node = registry.get<{ taskKey: string }, { cleared: boolean }>("clear-ready-to-merge");

    const taskKey = "CLEAR-TEST-EXISTS";
    const scopeDir = join(process.cwd(), ".agentweaver", "scopes", taskKey);
    mkdirSync(scopeDir, { recursive: true });

    const filePath = readyToMergeFile(taskKey);
    writeFileSync(filePath, "# Ready to Merge\n\nContent");

    expect(existsSync(filePath)).toBe(true);

    const result = await node.run({} as never, { taskKey });

    expect(result.value.cleared).toBe(true);
    expect(existsSync(filePath)).toBe(false);

    rmSync(scopeDir, { recursive: true, force: true });
  });

  it("should return cleared false when ready-to-merge file does not exist", async () => {
    const registry = createNodeRegistry();
    const node = registry.get<{ taskKey: string }, { cleared: boolean }>("clear-ready-to-merge");

    const taskKey = "CLEAR-TEST-NOT-EXISTS";
    const scopeDir = join(process.cwd(), ".agentweaver", "scopes", taskKey);
    mkdirSync(scopeDir, { recursive: true });

    const filePath = readyToMergeFile(taskKey);
    expect(existsSync(filePath)).toBe(false);

    const result = await node.run({} as never, { taskKey });

    expect(result.value.cleared).toBe(false);

    rmSync(scopeDir, { recursive: true, force: true });
  });

  it("should register review-verdict node", async () => {
    const registry = createNodeRegistry();
    expect(registry.has("review-verdict")).toBe(true);
  });
});

describe("review-loop flow structure", () => {
  beforeEach(() => {
    setupTestScope();
  });

  afterEach(() => {
    cleanupTestScope();
  });

  it("should load review-loop flow", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "review/review-loop.json" });
    expect(flow).toBeDefined();
    expect(flow.phases).toBeDefined();
    expect(flow.phases.length).toBeGreaterThan(0);
  });

  it("should publish both review-fix artifacts from the review-fix flow", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "review/review-fix.json" });
    const reviewFixPhase = flow.phases.find((p) => p.id === "review-fix");
    const runStep = reviewFixPhase?.steps.find((s) => s.id === "run_review_fix");

    expect(runStep).toBeDefined();
    expect(runStep?.params?.requiredArtifacts).toEqual({
      list: [
        {
          artifact: {
            kind: "review-fix-file",
            taskKey: { ref: "params.taskKey" },
            iteration: { ref: "params.latestIteration" },
          },
        },
        {
          artifact: {
            kind: "review-fix-json-file",
            taskKey: { ref: "params.taskKey" },
            iteration: { ref: "params.latestIteration" },
          },
        },
      ],
    });
  });

  it("should have entry_cleanup phase as first phase", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "review/review-loop.json" });
    expect(flow.phases[0].id).toBe("entry_cleanup");
  });

  it("should have clear-ready-to-merge node in entry_cleanup phase", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "review/review-loop.json" });
    const entryCleanupPhase = flow.phases.find((p) => p.id === "entry_cleanup");
    expect(entryCleanupPhase).toBeDefined();
    const clearStep = entryCleanupPhase!.steps.find((s) => s.node === "clear-ready-to-merge");
    expect(clearStep).toBeDefined();
  });

  it("should run review-verdict inside review.json", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "review/review.json" });
    const reviewPhase = flow.phases.find((p) => p.id === "review");
    expect(reviewPhase).toBeDefined();
    const verdictStep = reviewPhase!.steps.find((s) => s.id === "review_verdict");
    expect(verdictStep).toBeDefined();
    expect(verdictStep!.node).toBe("review-verdict");
    expect(verdictStep!.params?.blockingSeverities).toEqual({ ref: "params.reviewBlockingSeverities" });
  });

  it("should have review_iteration_1 phase", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "review/review-loop.json" });
    const iteration1Phase = flow.phases.find((p) => p.id === "review_iteration_1");
    expect(iteration1Phase).toBeDefined();
  });

  it("should have review_iteration_2 through review_iteration_5 via repeat", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "review/review-loop.json" });
    const phaseIds = flow.phases.map((p) => p.id);
    expect(phaseIds).toContain("review_iteration_2");
    expect(phaseIds).toContain("review_iteration_3");
    expect(phaseIds).toContain("review_iteration_4");
    expect(phaseIds).toContain("review_iteration_5");
  });

  it("should have terminal_verification phase", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "review/review-loop.json" });
    const terminalPhase = flow.phases.find((p) => p.id === "terminal_verification");
    expect(terminalPhase).toBeDefined();
  });

  it("should have clear-ready-to-merge node in terminal_verification phase", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "review/review-loop.json" });
    const terminalPhase = flow.phases.find((p) => p.id === "terminal_verification");
    expect(terminalPhase).toBeDefined();
    const clearStep = terminalPhase!.steps.find((s) => s.node === "clear-ready-to-merge");
    expect(clearStep).toBeDefined();
  });

  it("should map terminal verification to baseIteration + 5", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "review/review-loop.json" });
    const terminalPhase = flow.phases.find((p) => p.id === "terminal_verification");
    expect(terminalPhase).toBeDefined();
    const terminalReviewStep = terminalPhase!.steps.find(
      (s) => s.node === "flow-run" && s.params?.fileName && "const" in s.params.fileName && s.params.fileName.const === "review.json",
    );
    expect(terminalReviewStep).toBeDefined();
    expect(terminalReviewStep!.params?.iteration).toEqual(TERMINAL_ACTUAL_ITERATION_SPEC);
  });

  it("should have file-check assertion in terminal_verification phase", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "review/review-loop.json" });
    const terminalPhase = flow.phases.find((p) => p.id === "terminal_verification");
    expect(terminalPhase).toBeDefined();
    const assertStep = terminalPhase!.steps.find((s) => s.id === "assert_terminal_success");
    expect(assertStep).toBeDefined();
    expect(assertStep!.expect).toBeDefined();
    expect(assertStep!.expect!.length).toBeGreaterThan(0);
  });

  it("should derive actual review and review-fix iterations from baseIteration", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "review/review-loop.json" });
    const firstPhase = flow.phases.find((phase) => phase.id === "review_iteration_1");
    const repeatedPhase = flow.phases.find((phase) => phase.id === "review_iteration_2");
    expect(firstPhase).toBeDefined();
    expect(repeatedPhase).toBeDefined();

    const firstReviewStep = firstPhase!.steps.find((step) => step.id === "run_review");
    const firstReviewFixStep = firstPhase!.steps.find((step) => step.id === "run_review_fix");
    const repeatedReviewStep = repeatedPhase!.steps.find((step) => step.id === "run_review");
    const repeatedReviewFixStep = repeatedPhase!.steps.find((step) => step.id === "run_review_fix");
    expect(firstReviewStep?.params?.iteration).toEqual({ ref: "params.baseIteration" });
    expect(firstReviewFixStep?.params?.latestIteration).toEqual({ ref: "params.baseIteration" });
    expect(repeatedReviewStep?.params?.iteration).toEqual(REPEATED_ACTUAL_ITERATION_SPEC);
    expect(repeatedReviewFixStep?.params?.latestIteration).toEqual(REPEATED_ACTUAL_ITERATION_SPEC);
  });

  it("should stop early when review iteration produces ready-to-merge", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "review/review-loop.json" });
    for (const phase of flow.phases) {
      if (phase.id === "review_iteration_1") {
        const checkStep = phase.steps.find((s) => s.id === "check_ready_to_merge");
        expect(checkStep).toBeDefined();
        expect(checkStep!.stopFlowIf).toBeDefined();
      }
    }
  });
});

describe("review-loop flow callers", () => {
  it("should resolve legacy iteration compatibility with baseIteration precedence", () => {
    expect(resolveReviewLoopBaseIteration({ iteration: 4 })).toBe(4);
    expect(resolveReviewLoopBaseIteration({ baseIteration: 7 })).toBe(7);
    expect(resolveReviewLoopBaseIteration({ baseIteration: 7, iteration: 4 })).toBe(7);
  });

  it("auto-simple should route through plan.json", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-simple.json" });
    const planPhase = flow.phases.find((p) => p.id === "plan");
    expect(planPhase).toBeDefined();
    const runStep = planPhase!.steps.find((s) => s.node === "flow-run");
    expect(runStep).toBeDefined();
    expect(runStep!.params?.fileName).toEqual({ const: "plan.json" });
  });

  it("auto-golang should route through plan.json", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-golang.json" });
    let foundPlanFlowRun = false;
    for (const phase of flow.phases) {
      for (const step of phase.steps) {
        if (step.node === "flow-run" && step.params?.fileName && "const" in step.params.fileName && step.params.fileName.const === "plan.json") {
          foundPlanFlowRun = true;
        }
      }
    }
    expect(foundPlanFlowRun).toBe(true);
  });

  it("auto-simple should route through review-loop.json", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-simple.json" });
    const reviewLoopPhase = flow.phases.find((p) => p.id === "review-loop");
    expect(reviewLoopPhase).toBeDefined();
    const runStep = reviewLoopPhase!.steps.find((s) => s.node === "flow-run");
    expect(runStep).toBeDefined();
    expect(runStep!.params?.fileName).toEqual({ const: "review-loop.json" });
    expect(runStep!.params?.baseIteration).toEqual({ ref: "params.baseIteration" });
  });

  it("auto-golang should route through review-loop.json", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-golang.json" });
    let foundReviewLoopFlowRun = false;
    for (const phase of flow.phases) {
      for (const step of phase.steps) {
        if (step.node === "flow-run" && step.params?.fileName && "const" in step.params.fileName && step.params.fileName.const === "review-loop.json") {
          foundReviewLoopFlowRun = true;
          expect(step.params.baseIteration).toEqual({ ref: "params.baseIteration" });
        }
      }
    }
    expect(foundReviewLoopFlowRun).toBe(true);
  });

  it("auto-common should pass baseIteration into review-loop", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    const reviewLoopPhase = flow.phases.find((phase) => phase.id === "review-loop");
    const runStep = reviewLoopPhase?.steps.find((step) => step.id === "run_review_loop");
    expect(runStep?.params?.baseIteration).toEqual({ ref: "params.baseIteration" });
  });

  it("instant-task should pass baseIteration into review-loop", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "instant-task.json" });
    const reviewLoopPhase = flow.phases.find((phase) => phase.id === "review-loop");
    const runStep = reviewLoopPhase?.steps.find((step) => step.id === "run_review_loop");
    expect(runStep?.params?.baseIteration).toEqual({ ref: "params.baseIteration" });
  });

  it("project review-loop should use the same baseIteration arithmetic", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "review/review-project-loop.json" });
    const firstPhase = flow.phases.find((phase) => phase.id === "review_iteration_1");
    const repeatedPhase = flow.phases.find((phase) => phase.id === "review_iteration_2");
    const terminalPhase = flow.phases.find((phase) => phase.id === "terminal_verification");
    expect(firstPhase?.steps.find((step) => step.id === "run_review")?.params?.iteration).toEqual({ ref: "params.baseIteration" });
    expect(firstPhase?.steps.find((step) => step.id === "run_review_fix")?.params?.latestIteration).toEqual({ ref: "params.baseIteration" });
    expect(repeatedPhase?.steps.find((step) => step.id === "run_review")?.params?.iteration).toEqual(REPEATED_ACTUAL_ITERATION_SPEC);
    expect(repeatedPhase?.steps.find((step) => step.id === "run_review_fix")?.params?.latestIteration).toEqual(REPEATED_ACTUAL_ITERATION_SPEC);
    expect(terminalPhase?.steps.find((step) => step.id === "run_terminal_review")?.params?.iteration).toEqual(TERMINAL_ACTUAL_ITERATION_SPEC);
  });
});

describe("review-loop dry-run safety", () => {
  it("clear-ready-to-merge in entry_cleanup should have dry-run guard", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "review/review-loop.json" });
    const entryCleanupPhase = flow.phases.find((p) => p.id === "entry_cleanup");
    expect(entryCleanupPhase).toBeDefined();
    const clearStep = entryCleanupPhase!.steps.find((s) => s.node === "clear-ready-to-merge");
    expect(clearStep).toBeDefined();
    expect(clearStep!.when).toBeDefined();
    expect(clearStep!.when).toEqual(
      expect.objectContaining({
        not: expect.objectContaining({ ref: "context.dryRun" }),
      }),
    );
  });

  it("clear-ready-to-merge in terminal_verification should have dry-run guard", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "review/review-loop.json" });
    const terminalPhase = flow.phases.find((p) => p.id === "terminal_verification");
    expect(terminalPhase).toBeDefined();
    const clearStep = terminalPhase!.steps.find((s) => s.node === "clear-ready-to-merge");
    expect(clearStep).toBeDefined();
    expect(clearStep!.when).toBeDefined();
    expect(clearStep!.when).toEqual(
      expect.objectContaining({
        not: expect.objectContaining({ ref: "context.dryRun" }),
      }),
    );
  });

  it("terminal_verification phase should be skipped during dry-run", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "review/review-loop.json" });
    const terminalPhase = flow.phases.find((p) => p.id === "terminal_verification");
    expect(terminalPhase).toBeDefined();
    expect(terminalPhase!.when).toBeDefined();
    expect(terminalPhase!.when).toEqual(
      expect.objectContaining({
        not: expect.objectContaining({ ref: "context.dryRun" }),
      }),
    );
  });

  it("nested review-loop failure should suppress notify_task_complete via stopFlowIf", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    const reviewLoopPhase = flow.phases.find((p) => p.id === "review-loop");
    expect(reviewLoopPhase).toBeDefined();
    const runStep = reviewLoopPhase!.steps.find((s) => s.id === "run_review_loop");
    const notifyStep = reviewLoopPhase!.steps.find((s) => s.id === "notify_task_complete");
    expect(runStep).toBeDefined();
    expect(notifyStep).toBeDefined();
    expect(runStep!.stopFlowIf).toBeDefined();
    expect(notifyStep!.stopFlowIf).toBeUndefined();
    expect(runStep!.stopFlowOutcome).toBe("stopped");
  });

  it("review-loop flow-run step should set termination outcome on non-success", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    const reviewLoopPhase = flow.phases.find((p) => p.id === "review-loop");
    const runStep = reviewLoopPhase!.steps.find((s) => s.id === "run_review_loop");
    expect(runStep!.stopFlowIf).toBeDefined();
    expect(runStep!.stopFlowIf).toEqual(
      expect.objectContaining({
        not: expect.objectContaining({
          equals: expect.arrayContaining([
            expect.objectContaining({ ref: "steps.review-loop.run_review_loop.value.executionState.terminationOutcome" }),
            { const: "success" },
          ]),
        }),
      }),
    );
  });

  it("stopFlowIf condition evaluates correctly for success termination outcome", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    const reviewLoopPhase = flow.phases.find((p) => p.id === "review-loop");
    const runStep = reviewLoopPhase!.steps.find((s) => s.id === "run_review_loop");
    expect(runStep!.stopFlowIf).toBeDefined();

    const mockContext = {
      flowParams: {},
      flowConstants: {},
      pipelineContext: {},
      repeatVars: {},
      executionState: {
        flowKind: "review-loop-flow",
        flowVersion: 1,
        terminated: false,
        terminationOutcome: "success",
        phases: [
          {
            id: "review-loop",
            steps: [
              {
                id: "run_review_loop",
                status: "completed",
                outputs: {},
                value: {
                  executionState: {
                    flowKind: "review-loop-flow",
                    flowVersion: 1,
                    terminated: false,
                    terminationOutcome: "success",
                    phases: [],
                  },
                },
              },
            ],
          },
        ],
      },
    };

    const result = evaluateCondition(runStep!.stopFlowIf, mockContext);
    expect(result).toBe(false);
  });

  it("stopFlowIf condition evaluates correctly for stopped termination outcome", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    const reviewLoopPhase = flow.phases.find((p) => p.id === "review-loop");
    const runStep = reviewLoopPhase!.steps.find((s) => s.id === "run_review_loop");
    expect(runStep!.stopFlowIf).toBeDefined();

    const mockContext = {
      flowParams: {},
      flowConstants: {},
      pipelineContext: {},
      repeatVars: {},
      executionState: {
        flowKind: "review-loop-flow",
        flowVersion: 1,
        terminated: false,
        terminationOutcome: "success",
        phases: [
          {
            id: "review-loop",
            steps: [
              {
                id: "run_review_loop",
                status: "completed",
                outputs: {},
                value: {
                  executionState: {
                    flowKind: "review-loop-flow",
                    flowVersion: 1,
                    terminated: true,
                    terminationOutcome: "stopped",
                    phases: [],
                  },
                },
              },
            ],
          },
        ],
      },
    };

    const result = evaluateCondition(runStep!.stopFlowIf, mockContext);
    expect(result).toBe(true);
  });
});
