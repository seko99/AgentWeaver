import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { projectGuidanceNode } = await import(pathToFileURL(path.join(distRoot, "pipeline/nodes/project-guidance-node.js")).href);

let tempDir;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), "agentweaver-guidance-node-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function context(mdLang = "ru") {
  return {
    issueKey: "AG-103@test",
    jiraRef: "AG-103",
    cwd: tempDir,
    env: {},
    ui: {},
    dryRun: false,
    verbose: false,
    mdLang,
    runtime: {},
    executors: {},
    nodes: {},
  };
}

function writeTaskContext() {
  const filePath = path.join(tempDir, "task-context.json");
  writeFileSync(filePath, JSON.stringify({ title: "Implement TypeScript API", source_type: "manual" }), "utf8");
  return filePath;
}

function writeManifest() {
  const base = path.join(tempDir, ".agentweaver", "playbook");
  mkdirSync(path.join(base, "practices"), { recursive: true });
  mkdirSync(path.join(base, "examples"), { recursive: true });
  writeFileSync(path.join(base, "project.md"), "# Project\n", "utf8");
  writeFileSync(path.join(base, "manifest.yaml"), `
version: 1
project:
  name: Test
practices:
  paths: ["practices/rule.md"]
  globs: []
examples:
  paths: ["examples/example.md"]
  globs: []
templates:
  paths: ["project.md"]
  globs: []
always_include: ["practices/rule.md"]
selection:
  include_examples: true
`, "utf8");
  writeFileSync(path.join(base, "practices", "rule.md"), `---
id: rule
title: Rule
phases: [implement]
priority: 1
severity: must
related_practices: []
related_examples: []
---
Use local conventions.
`, "utf8");
  writeFileSync(path.join(base, "examples", "example.md"), `---
id: example
title: Example
phases: [implement]
priority: 1
severity: info
related_practices: []
related_examples: []
---
${"Example content. ".repeat(80)}
`, "utf8");
}

describe("project-guidance node", () => {
  it("writes validated JSON before derivative localized markdown", async () => {
    writeManifest();
    const taskContextJsonFile = writeTaskContext();
    const outputJsonFile = path.join(tempDir, ".agentweaver", "scopes", "AG-103@test", ".artifacts", "project-guidance-implement-AG-103@test-1.json");
    const outputFile = path.join(tempDir, ".agentweaver", "scopes", "AG-103@test", "project-guidance-implement-AG-103@test-1.md");

    const result = await projectGuidanceNode.run(context("ru"), {
      taskContextJsonFile,
      phase: "implement",
      outputJsonFile,
      outputFile,
    });

    assert.equal(result.value.status, "available");
    assert.equal(existsSync(outputJsonFile), true);
    assert.equal(existsSync(outputFile), true);
    assert.equal(JSON.parse(readFileSync(outputJsonFile, "utf8")).summary.startsWith("Selected compact"), true);
    assert.match(readFileSync(outputFile, "utf8"), /Проектные рекомендации/);
    assert.equal(result.outputs.length, 2);
  });

  it("continues with explicit missing_playbook output when manifest is absent", async () => {
    const taskContextJsonFile = writeTaskContext();
    const outputJsonFile = path.join(tempDir, "guidance.json");
    const outputFile = path.join(tempDir, "guidance.md");

    await projectGuidanceNode.run(context("en"), {
      taskContextJsonFile,
      phase: "plan",
      outputJsonFile,
      outputFile,
    });

    const guidance = JSON.parse(readFileSync(outputJsonFile, "utf8"));
    assert.equal(guidance.status, "missing_playbook");
    assert.match(readFileSync(outputFile, "utf8"), /manifest\.yaml was not found/);
  });

  it("fails invalid manifest before writing markdown by default", async () => {
    const base = path.join(tempDir, ".agentweaver", "playbook");
    mkdirSync(base, { recursive: true });
    writeFileSync(path.join(base, "manifest.yaml"), "version: nope\n", "utf8");
    const taskContextJsonFile = writeTaskContext();
    const outputJsonFile = path.join(tempDir, "invalid.json");
    const outputFile = path.join(tempDir, "invalid.md");

    await assert.rejects(
      () => projectGuidanceNode.run(context("en"), { taskContextJsonFile, phase: "plan", outputJsonFile, outputFile }),
      /Invalid project playbook/,
    );
    assert.equal(existsSync(outputFile), false);
  });
});
