import { describe, expect, it } from "vitest";

import { loadDeclarativeFlow } from "../src/pipeline/declarative-flows.js";

describe("plan-revise flow structure", () => {
  it("publishes revised markdown and JSON artifacts from the revision step", () => {
    const flow = await loadDeclarativeFlow({ source: "built-in", fileName: "plan-revise.json" });
    const revisePhase = flow.phases.find((phase) => phase.id === "phase_2_revise");
    const runStep = revisePhase?.steps.find((step) => step.id === "run_plan_revise");

    expect(runStep).toBeDefined();
    expect(runStep?.params?.requiredArtifacts).toEqual({
      list: [
        { ref: "params.revisedDesignFile" },
        { ref: "params.revisedDesignJsonFile" },
        { ref: "params.revisedPlanFile" },
        { ref: "params.revisedPlanJsonFile" },
        { ref: "params.revisedQaFile" },
        { ref: "params.revisedQaJsonFile" },
      ],
    });
  });
});
