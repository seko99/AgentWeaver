import { describe, expect, it } from "vitest";

import { loadDeclarativeFlow } from "../src/pipeline/declarative-flows.js";

describe("design-review-loop flow", () => {
  it("derives design-review artifact iterations from baseIteration", async () => {
    const flow = await loadDeclarativeFlow({ source: "built-in", fileName: "design-review/design-review-loop.json" });

    const firstPhase = flow.phases.find((phase) => phase.id === "design_review_iteration_1");
    const secondPhase = flow.phases.find((phase) => phase.id === "design_review_iteration_2");

    const firstReviewStep = firstPhase?.steps.find((step) => step.id === "run_design_review");
    const secondReviewStep = secondPhase?.steps.find((step) => step.id === "run_design_review");
    const secondVerdictStep = secondPhase?.steps.find((step) => step.id === "check_design_review_verdict");

    expect(firstReviewStep?.params?.iteration).toEqual({
      add: [
        { ref: "params.baseIteration" },
        { add: [{ ref: "repeat.iteration" }, { const: -1 }] },
      ],
    });
    expect(secondReviewStep?.params?.iteration).toEqual({
      add: [
        { ref: "params.baseIteration" },
        { add: [{ ref: "repeat.iteration" }, { const: -1 }] },
      ],
    });
    expect(secondVerdictStep?.params?.iteration).toEqual({
      add: [
        { ref: "params.baseIteration" },
        { add: [{ ref: "repeat.iteration" }, { const: -1 }] },
      ],
    });
  });
});
