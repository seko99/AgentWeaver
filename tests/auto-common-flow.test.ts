import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { loadDeclarativeFlow } from "../src/pipeline/declarative-flows.js";
import { designReviewVerdictNode } from "../src/pipeline/nodes/design-review-verdict-node.js";

const TEMP_SCOPE = "test-scope-design-review-verdict";

function setupTestScope(): void {
  const dir = join(process.cwd(), ".agentweaver", "scopes", TEMP_SCOPE, ".artifacts");
  mkdirSync(dir, { recursive: true });
}

function cleanupTestScope(): void {
  const scopeDir = join(process.cwd(), ".agentweaver", "scopes", TEMP_SCOPE);
  if (existsSync(scopeDir)) {
    rmSync(scopeDir, { recursive: true, force: true });
  }
}

function writeDesignReviewJson(taskKey: string, iteration: number, status: string, summary: string): void {
  const artifactsDir = join(process.cwd(), ".agentweaver", "scopes", taskKey, ".artifacts");
  mkdirSync(artifactsDir, { recursive: true });
  const jsonPath = join(artifactsDir, `design-review-${taskKey}-${iteration}.json`);
  writeFileSync(jsonPath, JSON.stringify({ status, summary }, null, 2));
}

describe("design-review-verdict-node", () => {
  it("should be registered in node registry", async () => {
    const { createNodeRegistry } = await import("../src/pipeline/node-registry.js");
    const registry = createNodeRegistry();
    expect(registry.has("design-review-verdict")).toBe(true);
  });

  it("should load auto-common flow spec with design_review_loop phase", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    expect(flow.phases.map((p) => p.id)).toContain("design_review_loop");
    expect(flow.phases.map((p) => p.id)).toContain("plan");
    expect(flow.phases.map((p) => p.id)).toContain("implement");
    expect(flow.phases.map((p) => p.id)).toContain("review-loop");
  });

  it("should load auto-simple flow spec", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-simple.json" });
    const phaseIds = flow.phases.map((p) => p.id);
    expect(phaseIds).toEqual(["source", "normalize", "plan", "implement", "review-loop"]);
  });

  it("should not have design_review gate in auto-simple", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-simple.json" });
    const hasDesignReview = flow.phases.some((p) => p.id === "design_review");
    expect(hasDesignReview).toBe(false);
  });

  it("auto-common design_review_loop phase should run design-review-loop.json", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    const designReviewLoopPhase = flow.phases.find((p) => p.id === "design_review_loop");
    expect(designReviewLoopPhase).toBeDefined();
    const runStep = designReviewLoopPhase!.steps.find((s) => s.node === "flow-run");
    expect(runStep).toBeDefined();
    expect(runStep!.params?.fileName).toEqual({ const: "design-review-loop.json" });
  });

  it("auto-common plan phase should run plan.json", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    const planPhase = flow.phases.find((p) => p.id === "plan");
    expect(planPhase).toBeDefined();
    const runStep = planPhase!.steps.find((s) => s.id === "run_plan_flow");
    expect(runStep).toBeDefined();
    expect(runStep!.node).toBe("flow-run");
    expect(runStep!.params?.fileName).toEqual({ const: "plan.json" });
  });

  it("auto-common design_review_loop phase should stop flow if sub-flow is stopped", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    const designReviewLoopPhase = flow.phases.find((p) => p.id === "design_review_loop");
    expect(designReviewLoopPhase).toBeDefined();
    const runStep = designReviewLoopPhase!.steps.find((s) => s.id === "run_design_review_loop");
    expect(runStep).toBeDefined();
    expect(runStep!.stopFlowIf).toBeDefined();
    expect(runStep!.stopFlowIf).toEqual(
      expect.objectContaining({
        equals: expect.arrayContaining([
          expect.objectContaining({ ref: "steps.design_review_loop.run_design_review_loop.value.executionState.terminationOutcome" }),
          { const: "stopped" },
        ]),
      }),
    );
  });
});

describe("auto-common flow branching", () => {
  it("should route to implement when design review is approved", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    const implementPhase = flow.phases.find((p) => p.id === "implement");
    expect(implementPhase).toBeDefined();
    const hasNoWhen = implementPhase!.when === undefined;
    expect(hasNoWhen).toBe(true);
  });

  it("should route to implement when design review is approved_with_warnings", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    const implementPhase = flow.phases.find((p) => p.id === "implement");
    expect(implementPhase).toBeDefined();
    expect(implementPhase!.when).toBeUndefined();
  });

  it("should have design_review_loop phase that runs sub-flow", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    const designReviewLoopPhase = flow.phases.find((p) => p.id === "design_review_loop");
    expect(designReviewLoopPhase).toBeDefined();
  });

  it("should have review-loop phase that runs sub-flow", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    const reviewLoopPhase = flow.phases.find((p) => p.id === "review-loop");
    expect(reviewLoopPhase).toBeDefined();
  });
});

describe("auto-common runtime branches", () => {
  const TEST_TASK_KEY = "AUTO-COMMON-TEST-1";

  beforeEach(() => {
    const artifactsDir = join(process.cwd(), ".agentweaver", "scopes", TEST_TASK_KEY, ".artifacts");
    mkdirSync(artifactsDir, { recursive: true });
  });

  afterEach(() => {
    const scopeDir = join(process.cwd(), ".agentweaver", "scopes", TEST_TASK_KEY);
    if (existsSync(scopeDir)) {
      rmSync(scopeDir, { recursive: true, force: true });
    }
  });

  function writeDesignReviewJson(iteration: number, status: string, summary: string): void {
    const artifactsDir = join(process.cwd(), ".agentweaver", "scopes", TEST_TASK_KEY, ".artifacts");
    const jsonPath = join(artifactsDir, `design-review-${TEST_TASK_KEY}-${iteration}.json`);
    writeFileSync(jsonPath, JSON.stringify({
      status,
      summary,
      blocking_findings: [],
      major_findings: [],
      warnings: [],
      missing_information: [],
      consistency_checks: [],
      qa_coverage_gaps: [],
      recommended_actions: [],
    }, null, 2));
  }

  it("should return approved status and canProceed=true from design-review-verdict", async () => {
    writeDesignReviewJson(1, "approved", "Design is ready");
    const result = await designReviewVerdictNode.run(
      {} as never,
      { taskKey: TEST_TASK_KEY, iteration: 1 },
    );
    expect(result.value.status).toBe("approved");
    expect(result.value.canProceed).toBe(true);
    expect(result.value.needsRevision).toBe(false);
  });

  it("should return approved_with_warnings status and canProceed=true from design-review-verdict", async () => {
    writeDesignReviewJson(1, "approved_with_warnings", "Design acceptable with warnings");
    const result = await designReviewVerdictNode.run(
      {} as never,
      { taskKey: TEST_TASK_KEY, iteration: 1 },
    );
    expect(result.value.status).toBe("approved_with_warnings");
    expect(result.value.canProceed).toBe(true);
    expect(result.value.needsRevision).toBe(false);
  });

  it("should return needs_revision status and canProceed=false from design-review-verdict", async () => {
    writeDesignReviewJson(1, "needs_revision", "Design requires changes");
    const result = await designReviewVerdictNode.run(
      {} as never,
      { taskKey: TEST_TASK_KEY, iteration: 1 },
    );
    expect(result.value.status).toBe("needs_revision");
    expect(result.value.canProceed).toBe(false);
    expect(result.value.needsRevision).toBe(true);
  });

  it("should route to implement phase when verdict is approved (no when condition)", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    const implementPhase = flow.phases.find((p) => p.id === "implement");
    expect(implementPhase).toBeDefined();
    expect(implementPhase!.when).toBeUndefined();
  });

it("should use iteration 1 by default when not specified in design-review-verdict", async () => {
    writeDesignReviewJson(1, "approved", "Default iteration test");
    const result = await designReviewVerdictNode.run(
      {} as never,
      { taskKey: TEST_TASK_KEY },
    );
    expect(result.value.status).toBe("approved");
  });

  it("should read from specific iteration when specified in design-review-verdict", async () => {
    writeDesignReviewJson(2, "needs_revision", "Second iteration verdict");
    writeDesignReviewJson(1, "approved", "First iteration verdict");
    const result = await designReviewVerdictNode.run(
      {} as never,
      { taskKey: TEST_TASK_KEY, iteration: 2 },
    );
    expect(result.value.status).toBe("needs_revision");
    expect(result.value.verdict).toBe("Second iteration verdict");
  });

  it("should have implement phase without when condition (always runs after gated phases)", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    const implementPhase = flow.phases.find((p) => p.id === "implement");
    expect(implementPhase).toBeDefined();
    expect(implementPhase!.when).toBeUndefined();
  });

  it("auto-common review-loop phase should run review-loop.json", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    const reviewLoopPhase = flow.phases.find((p) => p.id === "review-loop");
    expect(reviewLoopPhase).toBeDefined();
    const runStep = reviewLoopPhase!.steps.find((s) => s.node === "flow-run");
    expect(runStep).toBeDefined();
    expect(runStep!.params?.fileName).toEqual({ const: "review-loop.json" });
  });

  it("auto-common should have notify_task_complete after review-loop phase", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    const reviewLoopPhase = flow.phases.find((p) => p.id === "review-loop");
    expect(reviewLoopPhase).toBeDefined();
    const notifyStep = reviewLoopPhase!.steps.find((s) => s.id === "notify_task_complete");
    expect(notifyStep).toBeDefined();
  });

  it("auto-common review-loop run_review_loop should stop flow when termination outcome is not success", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    const reviewLoopPhase = flow.phases.find((p) => p.id === "review-loop");
    expect(reviewLoopPhase).toBeDefined();
    const runStep = reviewLoopPhase!.steps.find((s) => s.id === "run_review_loop");
    expect(runStep).toBeDefined();
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

  it("auto-common notify_task_complete should not have stopFlowIf after the fix", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    const reviewLoopPhase = flow.phases.find((p) => p.id === "review-loop");
    expect(reviewLoopPhase).toBeDefined();
    const notifyStep = reviewLoopPhase!.steps.find((s) => s.id === "notify_task_complete");
    expect(notifyStep).toBeDefined();
    expect(notifyStep!.stopFlowIf).toBeUndefined();
  });

  it("auto-common should stop before notify_task_complete when review-loop reports non-success", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    const reviewLoopPhase = flow.phases.find((p) => p.id === "review-loop");
    expect(reviewLoopPhase).toBeDefined();
    const runStep = reviewLoopPhase!.steps.find((s) => s.id === "run_review_loop");
    const notifyStep = reviewLoopPhase!.steps.find((s) => s.id === "notify_task_complete");
    expect(runStep).toBeDefined();
    expect(notifyStep).toBeDefined();
    const stepIds = reviewLoopPhase!.steps.map((s) => s.id);
    const runIndex = stepIds.indexOf("run_review_loop");
    const notifyIndex = stepIds.indexOf("notify_task_complete");
    expect(runIndex).toBeLessThan(notifyIndex);
    expect(runStep!.stopFlowIf).toBeDefined();
    expect(notifyStep!.stopFlowIf).toBeUndefined();
  });
});
