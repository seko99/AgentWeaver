import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { inspectReviewInputContract, resolveReviewInputContract } = await import(
  pathToFileURL(path.join(distRoot, "runtime/review-input-contract.js")).href
);

const VALID_DESIGN = {
  summary: "Design summary",
  goals: ["Goal"],
  non_goals: [],
  components: ["src/index.ts"],
  current_state: [],
  target_state: [],
  affected_code: [],
  business_rules: [],
  decisions: [
    {
      component: "src/index.ts",
      decision: "Use a dedicated contract.",
      rationale: "It keeps review routing deterministic.",
    },
  ],
  migration_strategy: [],
  database_changes: [],
  api_changes: [],
  risks: ["Routing drift risk"],
  acceptance_criteria: [],
  open_questions: [],
};

const VALID_PLAN = {
  summary: "Plan summary",
  prerequisites: [],
  workstreams: [],
  implementation_steps: [
    {
      id: "step-1",
      title: "Implement review routing",
      details: "Use structured review when planning artifacts and task context exist.",
    },
  ],
  tests: ["Run review routing coverage"],
  rollout_notes: ["Ship atomically"],
  follow_up_items: [],
};

let originalCwd;
let tempDir;

function scopeDir(taskKey) {
  return path.join(tempDir, ".agentweaver", "scopes", taskKey);
}

function artifactsDir(taskKey) {
  return path.join(scopeDir(taskKey), ".artifacts");
}

function writeMarkdownArtifact(taskKey, prefix, iteration, body = `# ${prefix}\n`) {
  const filePath = path.join(scopeDir(taskKey), `${prefix}-${taskKey}-${iteration}.md`);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, body, "utf8");
  return filePath;
}

function writeJsonArtifact(taskKey, prefix, iteration, payload) {
  const filePath = path.join(artifactsDir(taskKey), `${prefix}-${taskKey}-${iteration}.json`);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return filePath;
}

function writePlanningRun(taskKey, iteration) {
  writeMarkdownArtifact(taskKey, "design", iteration);
  writeJsonArtifact(taskKey, "design", iteration, VALID_DESIGN);
  writeMarkdownArtifact(taskKey, "plan", iteration);
  writeJsonArtifact(taskKey, "plan", iteration, VALID_PLAN);
}

function writeInstantTaskInput(taskKey) {
  const filePath = path.join(artifactsDir(taskKey), `instant-task-input-${taskKey}.json`);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify({
    form_id: "instant-task-input",
    submitted_at: "2026-04-19T00:00:00.000Z",
    values: {
      task_description: "Add instant-task support.",
      additional_instructions: "Keep Jira flows unchanged.",
    },
  }, null, 2)}\n`, "utf8");
  return filePath;
}

function writeJiraTask(taskKey) {
  const filePath = path.join(artifactsDir(taskKey), `${taskKey}.json`);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify({ key: taskKey, summary: "Jira task" }, null, 2)}\n`, "utf8");
  return filePath;
}

beforeEach(() => {
  originalCwd = process.cwd();
  tempDir = mkdtempSync(path.join(os.tmpdir(), "agentweaver-review-contract-"));
  process.chdir(tempDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tempDir, { recursive: true, force: true });
});

describe("review input contract", () => {
  it("resolves structured review when only instant-task input exists", () => {
    const taskKey = "ag-90@test";
    writePlanningRun(taskKey, 1);
    const taskInputPath = writeInstantTaskInput(taskKey);

    const inspection = inspectReviewInputContract(taskKey);
    assert.equal(inspection.status, "ready");
    if (inspection.status !== "ready") {
      return;
    }

    assert.equal(inspection.contract.hasTaskInputJsonFile, true);
    assert.equal(inspection.contract.taskInputJsonFilePath, taskInputPath);
    assert.equal(inspection.contract.hasJiraTaskFile, false);
    assert.match(inspection.contract.designJsonFile, /design-ag-90@test-1\.json$/);
  });

  it("resolves structured review when Jira task context exists", () => {
    const taskKey = "ag-91@test";
    writePlanningRun(taskKey, 1);
    const jiraTaskPath = writeJiraTask(taskKey);

    const contract = resolveReviewInputContract(taskKey);

    assert.equal(contract.hasJiraTaskFile, true);
    assert.equal(contract.jiraTaskFilePath, jiraTaskPath);
    assert.equal(contract.hasTaskInputJsonFile, false);
  });

  it("reports missing task context when planning exists but Jira and instant-task inputs are absent", () => {
    const taskKey = "ag-92@test";
    writePlanningRun(taskKey, 1);

    const inspection = inspectReviewInputContract(taskKey);

    assert.deepEqual(inspection, {
      status: "missing-task-context",
      planningIteration: 1,
    });
  });
});
