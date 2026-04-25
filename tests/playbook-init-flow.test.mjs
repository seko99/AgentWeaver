import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const flowCatalog = await import(pathToFileURL(path.join(distRoot, "pipeline/flow-catalog.js")).href);
const declarativeFlows = await import(pathToFileURL(path.join(distRoot, "pipeline/declarative-flows.js")).href);

describe("playbook-init flow", () => {
  it("is registered as a built-in command flow", () => {
    assert.equal(flowCatalog.isBuiltInCommandFlowId("playbook-init"), true);
    assert.equal(flowCatalog.builtInCommandFlowFile("playbook-init"), "playbook-init.json");
  });

  it("runs inventory before any LLM prompt and keeps convention scan folded into candidates", async () => {
    const flow = await declarativeFlows.loadDeclarativeFlow({ source: "built-in", fileName: "playbook-init.json" });
    const steps = flow.phases.flatMap((phase) => phase.steps);
    assert.equal(steps[0].id, "repo_inventory");
    assert.equal(steps[0].node, "playbook-inventory");
    const firstLlmIndex = steps.findIndex((step) => step.node === "llm-prompt");
    assert.ok(firstLlmIndex > 0);
    assert.equal(steps.some((step) => step.id.includes("convention_scan")), false);
    assert.deepEqual(
      steps.map((step) => step.id),
      [
        "repo_inventory",
        "practice_candidates",
        "clarification_questions",
        "user_answers",
        "playbook_draft",
        "acceptance_confirmation",
        "write_playbook",
      ],
    );
  });
});
