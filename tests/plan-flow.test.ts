import { describe, expect, it } from "vitest";

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
});
