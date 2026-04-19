import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { builtInCommandFlowFile, flowRoutingGroups, isBuiltInCommandFlowId, loadInteractiveFlowCatalog } = await import(
  pathToFileURL(path.join(distRoot, "pipeline/flow-catalog.js")).href
);

const allowedGroups = new Set([
  "planning",
  "design-review",
  "implementation",
  "review",
  "repair-loop",
  "local-fix-loop",
]);

const targetedSpecs = [
  "plan.json",
  "implement.json",
  "auto-common.json",
  "auto-golang.json",
  "instant-task.json",
  "plan-instant.json",
  "review/review.json",
  "review/review-fix.json",
  "review/review-project.json",
  "design-review.json",
  "plan-revise.json",
  "go/run-go-linter-loop.json",
  "go/run-go-tests-loop.json",
  "task-describe.json",
  "bugz/bug-analyze.json",
  "bugz/bug-fix.json",
  "gitlab/gitlab-review.json",
  "gitlab/gitlab-diff-review.json",
  "gitlab/mr-description.json",
];

function collectLlmPromptSteps(node, acc = []) {
  if (Array.isArray(node)) {
    node.forEach((item) => collectLlmPromptSteps(item, acc));
    return acc;
  }
  if (!node || typeof node !== "object") {
    return acc;
  }
  if (node.node === "llm-prompt") {
    acc.push(node);
  }
  Object.values(node).forEach((value) => collectLlmPromptSteps(value, acc));
  return acc;
}

describe("flow spec routing groups", () => {
  it("annotates every targeted built-in llm-prompt step with an allowed routing group", () => {
    for (const relativePath of targetedSpecs) {
      const spec = JSON.parse(readFileSync(path.join(distRoot, "pipeline/flow-specs", relativePath), "utf8"));
      const steps = collectLlmPromptSteps(spec);
      assert.ok(steps.length > 0, `${relativePath} should contain llm-prompt steps`);
      for (const step of steps) {
        assert.equal(typeof step.routingGroup, "string", `${relativePath}:${step.id} is missing routingGroup`);
        assert.equal(allowedGroups.has(step.routingGroup), true, `${relativePath}:${step.id} has invalid routingGroup`);
      }
    }
  });

  it("collects the same routing groups the runtime preview needs for auto-golang", () => {
    const flowEntry = loadInteractiveFlowCatalog(process.cwd()).find((candidate) => candidate.id === "auto-golang");
    assert.ok(flowEntry, "auto-golang flow should exist");

    const groups = flowRoutingGroups(flowEntry, process.cwd()).sort();

    assert.deepEqual(groups, [
      "implementation",
      "local-fix-loop",
      "planning",
      "repair-loop",
      "review",
    ]);
  });

  it("keeps every routed built-in command addressable by its built-in spec path", () => {
    const routedEntries = loadInteractiveFlowCatalog(process.cwd()).filter(
      (entry) =>
        entry.source === "built-in"
        && isBuiltInCommandFlowId(entry.id)
        && flowRoutingGroups(entry, process.cwd()).length > 0,
    );

    assert.ok(routedEntries.length > 0, "expected routed built-in flows");
    for (const entry of routedEntries) {
      assert.equal(
        builtInCommandFlowFile(entry.id),
        entry.fileName,
        `missing built-in flow file mapping for ${entry.id}`,
      );
    }
  });
});
