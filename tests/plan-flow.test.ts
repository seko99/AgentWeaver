import { describe, expect, it } from "vitest";

import { planArtifacts } from "../src/artifacts.js";
import { loadDeclarativeFlow } from "../src/pipeline/declarative-flows.js";

describe("plan flow structure", () => {
  it("notifies about planning questions only when the form has at least one question", async () => {
    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "plan.json" });
    const planPhase = flow.phases.find((phase) => phase.id === "plan");
    const notifyStep = planPhase?.steps.find((step) => step.id === "notify_questions_need_answering");

    expect(notifyStep).toBeDefined();
    expect(notifyStep?.when).toEqual({
      not: {
        equals: [
          { ref: "steps.plan.build_planning_questions_form.value.questionCount" },
          { const: 0 },
        ],
      },
    });
  });

  it("resolves plan artifact bundles against the explicit planning iteration", async () => {
    expect(planArtifacts("AG-91@test", 4)).toEqual([
      expect.stringContaining("design-AG-91@test-4.md"),
      expect.stringContaining("design-AG-91@test-4.json"),
      expect.stringContaining("plan-AG-91@test-4.md"),
      expect.stringContaining("plan-AG-91@test-4.json"),
      expect.stringContaining("qa-AG-91@test-4.md"),
      expect.stringContaining("qa-AG-91@test-4.json"),
    ]);

    const flow = loadDeclarativeFlow({ source: "built-in", fileName: "plan.json" });
    const planPhase = flow.phases.find((phase) => phase.id === "plan");
    const runPlanStep = planPhase?.steps.find((step) => step.id === "run_plan");

    expect(runPlanStep?.params?.requiredArtifacts).toEqual({
      artifactList: {
        kind: "plan-artifacts",
        taskKey: { ref: "params.taskKey" },
        iteration: { ref: "params.planIteration" },
      },
    });

    expect(runPlanStep?.expect?.find((entry) => entry.kind === "require-artifacts")).toEqual({
      kind: "require-artifacts",
      when: { not: { ref: "context.dryRun" } },
      paths: {
        artifactList: {
          kind: "plan-artifacts",
          taskKey: { ref: "params.taskKey" },
          iteration: { ref: "params.planIteration" },
        },
      },
      message: "Plan mode did not produce the required artifacts.",
    });
  });
});
