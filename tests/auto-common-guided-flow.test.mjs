import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { loadDeclarativeFlow } = await import(pathToFileURL(path.join(distRoot, "pipeline/declarative-flows.js")).href);
const { createNodeRegistry } = await import(pathToFileURL(path.join(distRoot, "pipeline/node-registry.js")).href);
const { projectGuidanceFile, projectGuidanceJsonFile } = await import(pathToFileURL(path.join(distRoot, "artifacts.js")).href);
const { getPromptTemplate } = await import(pathToFileURL(path.join(distRoot, "pipeline/prompt-registry.js")).href);

describe("auto-common-guided flow", () => {
  it("registers project-guidance and resolves canonical phase artifact names", () => {
    const registry = createNodeRegistry();
    assert.equal(registry.has("project-guidance"), true);
    assert.match(projectGuidanceJsonFile("AG-103@test", "plan", 2), /project-guidance-plan-AG-103@test-2\.json$/);
    assert.match(projectGuidanceFile("AG-103@test", "repair\/review-fix", 2), /project-guidance-repair-review-fix-AG-103@test-2\.md$/);
  });

  it("loads guided flow and generates guidance before prompts", async () => {
    const flow = await loadDeclarativeFlow({ source: "built-in", fileName: "auto-common-guided.json" });
    const phaseIds = flow.phases.map((phase) => phase.id);
    assert.deepEqual(phaseIds, [
      "source",
      "normalize",
      "plan_guidance",
      "plan",
      "design_review_guidance",
      "design_review_loop",
      "implement_guidance",
      "implement",
      "review_guidance",
      "review-loop",
    ]);
    assert.equal(flow.phases.find((phase) => phase.id === "plan_guidance").steps[0].node, "project-guidance");
    assert.equal(flow.phases.find((phase) => phase.id === "implement_guidance").steps[0].node, "project-guidance");
    assert.equal(flow.phases.find((phase) => phase.id === "review_guidance").steps[1].params.phase.const, "repair/review-fix");
  });

  it("prompt templates keep guidance supplemental to required planning JSON", () => {
    const implementPrompt = getPromptTemplate("implement");
    assert.match(implementPrompt, /supplemental/);
    assert.match(implementPrompt, /do not let it override the design, plan, or QA JSON/);
    assert.match(implementPrompt, /Analyze the system design \{design_json_file\}/);

    const reviewPrompt = getPromptTemplate("review");
    assert.match(reviewPrompt, /Required planning inputs/);
    assert.match(reviewPrompt, /do not let it replace required review inputs/);
  });
});
