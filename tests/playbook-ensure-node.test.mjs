import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { playbookEnsureNode } = await import(pathToFileURL(path.join(distRoot, "pipeline/nodes/playbook-ensure-node.js")).href);
const { createArtifactRegistry } = await import(pathToFileURL(path.join(distRoot, "runtime/artifact-registry.js")).href);

let repoDir;

function context(dryRun = false) {
  return {
    issueKey: "playbook-ensure-test",
    jiraRef: "playbook-ensure-test",
    cwd: repoDir,
    env: {},
    dryRun,
    verbose: false,
    runtime: { artifactRegistry: createArtifactRegistry(), resolveCmd: () => "noop", runCommand: async () => "" },
    executors: {},
    nodes: {},
    ui: {},
  };
}

function resultFile() {
  return path.join(repoDir, ".agentweaver/scopes/playbook-ensure-test/.artifacts/playbook-write-result-playbook-ensure-test.json");
}

function readResult() {
  return JSON.parse(readFileSync(resultFile(), "utf8"));
}

function writeValidPlaybook() {
  const base = path.join(repoDir, ".agentweaver/playbook");
  mkdirSync(path.join(base, "practices"), { recursive: true });
  mkdirSync(path.join(base, "examples"), { recursive: true });
  mkdirSync(path.join(base, "templates"), { recursive: true });
  writeFileSync(path.join(base, "manifest.yaml"), [
    "version: 1",
    "project:",
    '  name: "Existing"',
    "context_budgets:",
    "  plan: 1000",
    "practices:",
    "  paths:",
    '    - "practices/typescript.md"',
    "  globs: []",
    "examples:",
    "  paths:",
    '    - "examples/example.md"',
    "  globs: []",
    "templates:",
    "  paths:",
    '    - "templates/default.md"',
    "  globs: []",
    "always_include:",
    '  - "project.md"',
    "selection:",
    "  include_examples: true",
    "",
  ].join("\n"), "utf8");
  writeFileSync(path.join(base, "project.md"), "Project.\n", "utf8");
  writeFileSync(path.join(base, "practices/typescript.md"), "---\nid: practice.typescript\ntitle: TypeScript\nphases:\n  - plan\nrelated_practices: []\nrelated_examples: []\n---\nPractice.\n", "utf8");
  writeFileSync(path.join(base, "examples/example.md"), "---\nid: example.typescript\ntitle: Example\nphases:\n  - plan\nrelated_practices: []\nrelated_examples: []\n---\nExample.\n", "utf8");
  writeFileSync(path.join(base, "templates/default.md"), "Template.\n", "utf8");
}

beforeEach(() => {
  repoDir = mkdtempSync(path.join(os.tmpdir(), "agentweaver-playbook-ensure-"));
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe("playbook ensure node", () => {
  it("blocks missing manifest without explicit acceptance", async () => {
    const result = await playbookEnsureNode.run(context(), {
      writeResultJsonFile: resultFile(),
      acceptPlaybookDraft: false,
    });

    assert.equal(result.value.status, "blocked");
    assert.equal(result.value.shouldRunPlaybookInit, false);
    assert.match(result.value.message, /--accept-playbook-draft/);
    assert.equal(readResult().status, "blocked");
  });

  it("requests playbook-init when missing manifest has explicit acceptance", async () => {
    const result = await playbookEnsureNode.run(context(), {
      writeResultJsonFile: resultFile(),
      acceptPlaybookDraft: true,
    });

    assert.equal(result.value.status, "missing_playbook");
    assert.equal(result.value.shouldRunPlaybookInit, true);
    assert.equal(readResult().status, "missing_playbook");
  });

  it("reuses a valid manifest without asking generation questions", async () => {
    writeValidPlaybook();

    const result = await playbookEnsureNode.run(context(), {
      writeResultJsonFile: resultFile(),
      acceptPlaybookDraft: false,
    });

    assert.equal(result.value.status, "skipped_valid_existing");
    assert.equal(result.value.shouldRunPlaybookInit, false);
    assert.equal(readResult().status, "skipped_valid_existing");
  });
});
