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

  it("should load auto-common flow spec", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    expect(flow.phases.map((p) => p.id)).toContain("verdict");
    expect(flow.phases.map((p) => p.id)).toContain("plan_revision");
    expect(flow.phases.map((p) => p.id)).toContain("design_review_repeat");
  });

  it("should load auto-simple flow spec", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-simple.json" });
    const phaseIds = flow.phases.map((p) => p.id);
    expect(phaseIds).toEqual(["plan", "implement", "review-loop"]);
  });

  it("should not have design_review gate in auto-simple", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-simple.json" });
    const hasDesignReview = flow.phases.some((p) => p.id === "design_review");
    expect(hasDesignReview).toBe(false);
  });

  it("auto-common should have plan_revision phase gated by needs_revision", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    const planRevisionPhase = flow.phases.find((p) => p.id === "plan_revision");
    expect(planRevisionPhase).toBeDefined();
    expect(planRevisionPhase!.when).toBeDefined();
    expect(planRevisionPhase!.when).toEqual(
      expect.objectContaining({
        equals: expect.arrayContaining([
          expect.objectContaining({ ref: "steps.verdict.check_design_review_verdict.value.needsRevision" }),
          { const: true },
        ]),
      }),
    );
  });

  it("auto-common should have second design review phase gated by needs_revision", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    const secondReviewPhase = flow.phases.find((p) => p.id === "design_review_repeat");
    expect(secondReviewPhase).toBeDefined();
    expect(secondReviewPhase!.when).toBeDefined();
  });

  it("auto-common should stop on repeated needs_revision via stopFlowIf", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    const verdictRepeatPhase = flow.phases.find((p) => p.id === "verdict_repeat");
    expect(verdictRepeatPhase).toBeDefined();
    const stopStep = verdictRepeatPhase!.steps.find((s) => s.stopFlowIf);
    expect(stopStep).toBeDefined();
    expect(stopStep!.stopFlowIf).toEqual(
      expect.objectContaining({
        equals: expect.arrayContaining([
          expect.objectContaining({ ref: "steps.verdict_repeat.check_second_verdict.value.needsRevision" }),
          { const: true },
        ]),
      }),
    );
  });

  it("auto-common verdict phase should use design-review-verdict node", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    const verdictPhase = flow.phases.find((p) => p.id === "verdict");
    const checkStep = verdictPhase!.steps.find((s) => s.id === "check_design_review_verdict");
    expect(checkStep).toBeDefined();
    expect(checkStep!.node).toBe("design-review-verdict");
  });
});

describe("auto-common flow branching", () => {
  it("should route to implement when verdict is approved", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    const implementPhase = flow.phases.find((p) => p.id === "implement");
    expect(implementPhase).toBeDefined();
    const hasNoWhen = implementPhase!.when === undefined;
    expect(hasNoWhen).toBe(true);
  });

  it("should route to implement when verdict is approved_with_warnings", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    const implementPhase = flow.phases.find((p) => p.id === "implement");
    expect(implementPhase).toBeDefined();
    expect(implementPhase!.when).toBeUndefined();
  });

  it("should have plan_revision phase when needs_revision", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    const planRevisionPhase = flow.phases.find((p) => p.id === "plan_revision");
    expect(planRevisionPhase).toBeDefined();
  });

  it("should have verdict_repeat phase to check second review", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    const verdictRepeatPhase = flow.phases.find((p) => p.id === "verdict_repeat");
    expect(verdictRepeatPhase).toBeDefined();
    const checkStep = verdictRepeatPhase!.steps.find((s) => s.id === "check_second_verdict");
    expect(checkStep).toBeDefined();
    expect(checkStep!.node).toBe("design-review-verdict");
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

  it("should route to plan_revision when verdict is needs_revision", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    const planRevisionPhase = flow.phases.find((p) => p.id === "plan_revision");
    expect(planRevisionPhase).toBeDefined();
    expect(planRevisionPhase!.when).toEqual(
      expect.objectContaining({
        equals: expect.arrayContaining([
          expect.objectContaining({ ref: "steps.verdict.check_design_review_verdict.value.needsRevision" }),
          { const: true },
        ]),
      }),
    );
  });

  it("should have second design review phase after plan_revision when needs_revision", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    const secondReviewPhase = flow.phases.find((p) => p.id === "design_review_repeat");
    expect(secondReviewPhase).toBeDefined();
    expect(secondReviewPhase!.when).toEqual(
      expect.objectContaining({
        equals: expect.arrayContaining([
          expect.objectContaining({ ref: "steps.verdict.check_design_review_verdict.value.needsRevision" }),
          { const: true },
        ]),
      }),
    );
  });

  it("should stop flow on repeated needs_revision via stopFlowIf", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    const verdictRepeatPhase = flow.phases.find((p) => p.id === "verdict_repeat");
    expect(verdictRepeatPhase).toBeDefined();
    const stopStep = verdictRepeatPhase!.steps.find((s) => s.stopFlowIf);
    expect(stopStep).toBeDefined();
    expect(stopStep!.stopFlowIf).toEqual(
      expect.objectContaining({
        equals: expect.arrayContaining([
          expect.objectContaining({ ref: "steps.verdict_repeat.check_second_verdict.value.needsRevision" }),
          { const: true },
        ]),
      }),
    );
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

  it("should have plan_revision phase that runs when first verdict needs_revision", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    const planRevisionPhase = flow.phases.find((p) => p.id === "plan_revision");
    expect(planRevisionPhase).toBeDefined();
    expect(planRevisionPhase!.when).toBeDefined();
    expect(planRevisionPhase!.when).toEqual(
      expect.objectContaining({
        equals: expect.arrayContaining([
          expect.objectContaining({ ref: "steps.verdict.check_design_review_verdict.value.needsRevision" }),
          { const: true },
        ]),
      }),
    );
  });
});