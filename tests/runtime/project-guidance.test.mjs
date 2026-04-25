import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const guidanceModule = await import(pathToFileURL(path.join(distRoot, "runtime/project-guidance.js")).href);
const artifactModule = await import(pathToFileURL(path.join(distRoot, "structured-artifacts.js")).href);

let tempDir;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), "agentweaver-guidance-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function writePlaybook(root) {
  const base = path.join(root, ".agentweaver", "playbook");
  mkdirSync(path.join(base, "practices"), { recursive: true });
  mkdirSync(path.join(base, "examples"), { recursive: true });
  writeFileSync(path.join(base, "project.md"), "# Project\n", "utf8");
  writeFileSync(path.join(base, "manifest.yaml"), `
version: 1
project:
  name: Test
  languages: [typescript]
  frameworks: [node:test]
context_budgets:
  plan: 40
  design_review: 40
  implement: 40
  review: 40
  repair: 40
practices:
  globs: ["practices/*.md"]
examples:
  globs: ["examples/*.md"]
templates:
  paths: ["project.md"]
always_include:
  - practices/always.md
selection:
  include_examples: true
  max_examples: 3
`, "utf8");
  writeFileSync(path.join(base, "practices", "always.md"), `---
id: always-rule
title: Always Rule
phases: [plan, implement]
priority: 1
severity: must
related_practices: []
related_examples: []
---
Always keep structured JSON as source of truth.
`, "utf8");
  writeFileSync(path.join(base, "practices", "api.md"), `---
id: api-rule
title: API Rule
phases: [implement]
priority: 9
severity: should
applies_to:
  keywords: [api, route]
  languages: [typescript]
related_practices: []
related_examples: []
---
Use the existing API route patterns.
`, "utf8");
  writeFileSync(path.join(base, "practices", "review.md"), `---
id: review-rule
title: Review Rule
phases: [review]
priority: 5
severity: must
related_practices: []
related_examples: []
---
Review against structured planning artifacts.
`, "utf8");
  writeFileSync(path.join(base, "examples", "long.md"), `---
id: long-example
title: Long Example
phases: [implement]
priority: 2
severity: info
applies_to:
  keywords: [api]
related_practices: []
related_examples: []
---
${"Long implementation example. ".repeat(120)}
`, "utf8");
}

describe("project guidance runtime", () => {
  it("selects phase-specific compact guidance from manifest.yaml", () => {
    writePlaybook(tempDir);
    const taskContext = {
      title: "Add TypeScript API route",
      source_type: "manual",
      acceptance_criteria: ["Update src/routes/api.ts"],
    };

    const guidance = guidanceModule.buildProjectGuidance({
      projectRoot: tempDir,
      taskContext,
      phase: "implement",
      budgetLimit: 80,
      inlineThreshold: 25,
    });

    assert.equal(guidance.status, "available");
    assert.equal(guidance.phase, "implement");
    assert.deepEqual(guidance.always_include, ["practices/always.md"]);
    assert.equal(guidance.selected_practices[0].id, "always-rule");
    assert.ok(guidance.selected_practices.some((item) => item.id === "api-rule"));
    assert.ok(guidance.selected_practices.every((item) => item.selection_reasons.length > 0));
    assert.equal(guidance.selected_examples[0].reference_only, true);
    assert.equal(guidance.selected_examples[0].inline_content, undefined);
    assert.equal(guidance.budget.estimator, "chars_div_4");
    artifactModule.validateStructuredArtifactValue(guidance, "project-guidance/v1", "$");
  });

  it("maps design_review and repair phases and filters incompatible entries", () => {
    writePlaybook(tempDir);
    assert.equal(guidanceModule.normalizeGuidancePhase("design_review"), "design-review");
    assert.equal(guidanceModule.normalizeGuidancePhase("repair"), "repair/review-fix");

    const reviewGuidance = guidanceModule.buildProjectGuidance({
      projectRoot: tempDir,
      taskContext: { title: "Review the implementation" },
      phase: "review",
    });
    assert.ok(reviewGuidance.selected_practices.some((item) => item.id === "review-rule"));
    assert.ok(!reviewGuidance.selected_practices.some((item) => item.id === "api-rule"));
  });

  it("does not fall back to older playbook artifacts when manifest.yaml is absent", () => {
    const base = path.join(tempDir, ".agentweaver", "playbook");
    mkdirSync(base, { recursive: true });
    writeFileSync(path.join(base, "playbook.json"), JSON.stringify({ status: "accepted" }), "utf8");
    writeFileSync(path.join(base, "playbook.md"), "# Old\n", "utf8");

    const guidance = guidanceModule.buildProjectGuidance({
      projectRoot: tempDir,
      taskContext: { title: "Implement API" },
      phase: "implement",
    });

    assert.equal(guidance.status, "missing_playbook");
    assert.equal(guidance.source_playbook.exists, false);
  });

  it("fails invalid manifest by default and writes diagnostic artifacts only when requested", () => {
    const base = path.join(tempDir, ".agentweaver", "playbook");
    mkdirSync(base, { recursive: true });
    writeFileSync(path.join(base, "manifest.yaml"), "version: nope\n", "utf8");

    assert.throws(
      () => guidanceModule.buildProjectGuidance({ projectRoot: tempDir, taskContext: {}, phase: "plan" }),
      /Invalid project playbook/,
    );

    const diagnostic = guidanceModule.buildProjectGuidance({
      projectRoot: tempDir,
      taskContext: {},
      phase: "plan",
      invalidPlaybookPolicy: "write_diagnostic_artifact",
    });
    assert.equal(diagnostic.status, "invalid_playbook");
  });

  it("renders localized derivative markdown without changing English JSON semantics", () => {
    writePlaybook(tempDir);
    const guidance = guidanceModule.buildProjectGuidance({
      projectRoot: tempDir,
      taskContext: { title: "Implement TypeScript API" },
      phase: "implement",
    });
    const markdown = guidanceModule.renderProjectGuidanceMarkdown(guidance, "ru");
    assert.match(markdown, /Проектные рекомендации/);
    assert.match(markdown, /Открывайте полные примеры/);
    assert.equal(guidance.summary.includes("Selected compact"), true);
  });

  it("rejects invalid schema values", () => {
    writePlaybook(tempDir);
    const guidance = guidanceModule.buildProjectGuidance({
      projectRoot: tempDir,
      taskContext: { title: "Implement TypeScript API" },
      phase: "implement",
    });
    assert.throws(
      () => artifactModule.validateStructuredArtifactValue({ ...guidance, status: "wrong" }, "project-guidance/v1", "$"),
      /status/,
    );
    assert.throws(
      () => artifactModule.validateStructuredArtifactValue({ ...guidance, budget: { ...guidance.budget, remaining: -1 } }, "project-guidance/v1", "$"),
      /remaining/,
    );
  });
});
