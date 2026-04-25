import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { playbookWriteNode } = await import(pathToFileURL(path.join(distRoot, "pipeline/nodes/playbook-write-node.js")).href);
const { createArtifactRegistry } = await import(pathToFileURL(path.join(distRoot, "runtime/artifact-registry.js")).href);
const { validateStructuredArtifact } = await import(pathToFileURL(path.join(distRoot, "structured-artifacts.js")).href);

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
    finalJson: path.join(repoDir, ".agentweaver/playbook/playbook.json"),
    finalMd: path.join(repoDir, ".agentweaver/playbook/playbook.md"),
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
    proposed_files: [".agentweaver/playbook/playbook.json", ".agentweaver/playbook/playbook.md"],
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
    assert.doesNotThrow(() => validateStructuredArtifact(f.finalJson, "playbook-final/v1"));
    assert.equal(readJson(f.finalJson).status, "accepted");
  });

  it("does not write final files when acceptance is false or missing", async () => {
    const f = files();
    writeDraftAndAnswers(false);

    const result = await run(false);

    assert.equal(result.status, "not_accepted");
    assert.equal(readFileSync(f.result, "utf8").includes("not_accepted"), true);
    assert.throws(() => readFileSync(f.finalJson, "utf8"));
  });

  it("skips an existing accepted playbook without overwriting it", async () => {
    const f = files();
    writeDraftAndAnswers(true);
    writeJson(f.finalJson, {
      status: "accepted",
      accepted_at: "2026-04-25T00:00:00.000Z",
      source_draft_artifact: "existing",
      summary: "Existing playbook.",
      rules: [{ id: "existing", title: "Existing", rule: "Keep this.", evidence_paths: ["README.md"] }],
      evidence_paths: ["README.md"],
    });
    writeFileSync(f.finalMd, "existing\n", "utf8");
    const before = readFileSync(f.finalJson, "utf8");

    const result = await run(false);

    assert.equal(result.status, "skipped");
    assert.equal(readFileSync(f.finalJson, "utf8"), before);
  });

  it("blocks partial and malformed playbook states", async () => {
    const f = files();
    writeDraftAndAnswers(true);
    mkdirSync(path.dirname(f.finalJson), { recursive: true });
    writeFileSync(f.finalMd, "markdown only\n", "utf8");

    let result = await run(false);
    assert.equal(result.status, "blocked");
    assert.deepEqual(result.blocked_paths, [f.finalMd]);

    rmSync(path.dirname(f.finalJson), { recursive: true, force: true });
    writeDraftAndAnswers(true);
    writeJson(f.finalJson, { status: "draft" });
    writeFileSync(f.finalMd, "bad\n", "utf8");

    result = await run(false);
    assert.equal(result.status, "blocked");
    assert.equal(readJson(f.finalJson).status, "draft");
  });

  it("reports dry_run without creating final files even when accepted", async () => {
    const f = files();
    writeDraftAndAnswers(true);

    const result = await run(true);

    assert.equal(result.status, "dry_run");
    assert.throws(() => readFileSync(f.finalJson, "utf8"));
  });
});
