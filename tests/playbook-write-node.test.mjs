import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { playbookWriteNode } = await import(pathToFileURL(path.join(distRoot, "pipeline/nodes/playbook-write-node.js")).href);
const { createArtifactRegistry } = await import(pathToFileURL(path.join(distRoot, "runtime/artifact-registry.js")).href);
const { loadProjectPlaybook } = await import(pathToFileURL(path.join(distRoot, "runtime/playbook.js")).href);

let repoDir;

function writeJson(filePath, payload) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function context(dryRun = false) {
  return {
    issueKey: "playbook-test",
    jiraRef: "playbook-test",
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

function files() {
  return {
    draft: path.join(repoDir, ".agentweaver/scopes/playbook-test/.artifacts/playbook-draft-playbook-test.json"),
    answers: path.join(repoDir, ".agentweaver/scopes/playbook-test/.artifacts/playbook-answers-playbook-test.json"),
    result: path.join(repoDir, ".agentweaver/scopes/playbook-test/.artifacts/playbook-write-result-playbook-test.json"),
    manifest: path.join(repoDir, ".agentweaver/playbook/manifest.yaml"),
    projectMd: path.join(repoDir, ".agentweaver/playbook/project.md"),
    practiceMd: path.join(repoDir, ".agentweaver/playbook/practices/generated-rules.md"),
    exampleMd: path.join(repoDir, ".agentweaver/playbook/examples/generated-example.md"),
    templateMd: path.join(repoDir, ".agentweaver/playbook/templates/default.md"),
  };
}

function writeDraftAndAnswers(accepted) {
  const f = files();
  writeJson(f.draft, {
    summary: "Project playbook draft.",
    generated_at: "2026-04-25T00:00:00.000Z",
    accepted_rules: [
      { id: "rule-tests", title: "Run tests", rule: "Run npm test before release.", evidence_paths: ["package.json"] },
    ],
    candidate_rules: [],
    unresolved_questions: [],
    evidence_paths: ["package.json"],
    proposed_files: [
      ".agentweaver/playbook/manifest.yaml",
      ".agentweaver/playbook/project.md",
      ".agentweaver/playbook/practices/generated-rules.md",
      ".agentweaver/playbook/examples/generated-example.md",
      ".agentweaver/playbook/templates/default.md",
    ],
  });
  writeJson(f.answers, {
    summary: accepted ? "Accepted." : "Not accepted.",
    answered_at: "2026-04-25T00:00:00.000Z",
    answers: [],
    final_write_accepted: accepted,
  });
}

async function run(dryRun = false) {
  const f = files();
  await playbookWriteNode.run(context(dryRun), {
    draftJsonFile: f.draft,
    answersJsonFile: f.answers,
    writeResultJsonFile: f.result,
  });
  return readJson(f.result);
}

beforeEach(() => {
  repoDir = mkdtempSync(path.join(os.tmpdir(), "agentweaver-playbook-write-"));
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe("playbook write node", () => {
  it("writes canonical final files when accepted and no playbook exists", async () => {
    const f = files();
    writeDraftAndAnswers(true);

    const result = await run(false);

    assert.equal(result.status, "written");
    const playbook = loadProjectPlaybook(repoDir);
    assert.equal(playbook.manifestPath, f.manifest);
    assert.equal(playbook.practices[0].id, "practice.generated-rules");
    assert.equal(readFileSync(f.projectMd, "utf8").includes("Project playbook draft."), true);
  });

  it("does not write final files when acceptance is false or missing", async () => {
    const f = files();
    writeDraftAndAnswers(false);

    const result = await run(false);

    assert.equal(result.status, "not_accepted");
    assert.equal(readFileSync(f.result, "utf8").includes("not_accepted"), true);
    assert.throws(() => readFileSync(f.manifest, "utf8"));
  });

  it("skips an existing valid manifest playbook without overwriting it", async () => {
    const f = files();
    writeDraftAndAnswers(true);
    mkdirSync(path.dirname(f.practiceMd), { recursive: true });
    mkdirSync(path.dirname(f.exampleMd), { recursive: true });
    mkdirSync(path.dirname(f.templateMd), { recursive: true });
    writeFileSync(f.manifest, [
      "version: 1",
      "project:",
      '  name: "Existing"',
      "context_budgets:",
      "  plan: 1000",
      "practices:",
      "  paths:",
      '    - "practices/generated-rules.md"',
      "  globs: []",
      "examples:",
      "  paths:",
      '    - "examples/generated-example.md"',
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
    writeFileSync(f.projectMd, "existing\n", "utf8");
    writeFileSync(f.practiceMd, "---\nid: practice.existing\ntitle: Existing\nphases:\n  - plan\nrelated_practices: []\nrelated_examples: []\n---\nExisting.\n", "utf8");
    writeFileSync(f.exampleMd, "---\nid: example.existing\ntitle: Existing Example\nphases:\n  - plan\nrelated_practices: []\nrelated_examples: []\n---\nExample.\n", "utf8");
    writeFileSync(f.templateMd, "template\n", "utf8");
    const before = readFileSync(f.manifest, "utf8");

    const result = await run(false);

    assert.equal(result.status, "skipped_valid_existing");
    assert.equal(readFileSync(f.manifest, "utf8"), before);
  });

  it("blocks invalid manifest playbook states", async () => {
    const f = files();
    writeDraftAndAnswers(true);
    mkdirSync(path.dirname(f.manifest), { recursive: true });
    writeFileSync(f.manifest, "version: 2\n", "utf8");

    let result = await run(false);
    assert.equal(result.status, "blocked");
    assert.deepEqual(result.blocked_paths, [f.manifest]);

    rmSync(path.dirname(f.manifest), { recursive: true, force: true });
    writeDraftAndAnswers(true);
    mkdirSync(path.dirname(f.manifest), { recursive: true });
    writeFileSync(f.manifest, "version: 1\nproject:\n  name: Partial\n", "utf8");

    result = await run(false);
    assert.equal(result.status, "blocked");
    assert.equal(readFileSync(f.manifest, "utf8").includes("Partial"), true);
  });

  it("reports dry_run without creating final files even when accepted", async () => {
    const f = files();
    writeDraftAndAnswers(true);

    const result = await run(true);

    assert.equal(result.status, "dry_run_written");
    assert.throws(() => readFileSync(f.manifest, "utf8"));
  });
});
