import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { OPTIONAL_INPUT_NOT_PROVIDED, resolveDesignReviewInputContract } = await import(
  pathToFileURL(path.join(distRoot, "runtime/design-review-input-contract.js")).href
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
      decision: "Use a dedicated resolver.",
      rationale: "It keeps the contract explicit.",
    },
  ],
  migration_strategy: [],
  database_changes: [],
  api_changes: [],
  risks: ["Resolver drift risk"],
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
      title: "Implement contract",
      details: "Add a dedicated design-review contract resolver.",
    },
  ],
  tests: ["Run contract tests"],
  rollout_notes: ["Ship atomically"],
  follow_up_items: [],
};

const VALID_QA = {
  summary: "QA summary",
  test_scenarios: [
    {
      id: "qa-1",
      title: "Smoke test",
      expected_result: "The flow succeeds.",
    },
  ],
  non_functional_checks: [],
};

const VALID_USER_INPUT = {
  form_id: "planning-questions",
  submitted_at: "2026-04-16T00:00:00.000Z",
  values: {
    scope: "default",
  },
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

function writeSidecarArtifactIndex(taskKey) {
  const filePath = path.join(artifactsDir(taskKey), "artifact-index.json");
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, "{\n  \"scope\": \"test\",\n  \"records\": []\n}\n", "utf8");
}

function writePlanningRun(taskKey, iteration, options = {}) {
  if (options.withDesignMarkdown !== false) {
    writeMarkdownArtifact(taskKey, "design", iteration);
  }
  if (options.withDesignJson !== false) {
    writeJsonArtifact(taskKey, "design", iteration, options.designJson ?? VALID_DESIGN);
  }
  if (options.withPlanMarkdown !== false) {
    writeMarkdownArtifact(taskKey, "plan", iteration);
  }
  if (options.withPlanJson !== false) {
    writeJsonArtifact(taskKey, "plan", iteration, options.planJson ?? VALID_PLAN);
  }
  if (options.withQaMarkdown) {
    writeMarkdownArtifact(taskKey, "qa", iteration);
  }
  if (options.withQaJson) {
    writeJsonArtifact(taskKey, "qa", iteration, options.qaJson ?? VALID_QA);
  }
}

function writePlanningAnswers(taskKey, payload = VALID_USER_INPUT) {
  const filePath = path.join(artifactsDir(taskKey), `planning-answers-${taskKey}.json`);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return filePath;
}

function writeInstantTaskInput(taskKey, payload = VALID_USER_INPUT) {
  const filePath = path.join(artifactsDir(taskKey), `instant-task-input-${taskKey}.json`);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return filePath;
}

beforeEach(() => {
  originalCwd = process.cwd();
  tempDir = mkdtempSync(path.join(os.tmpdir(), "agentweaver-design-review-contract-"));
  process.chdir(tempDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tempDir, { recursive: true, force: true });
});

describe("resolveDesignReviewInputContract", () => {
  it("selects the latest completed planning run instead of a future or partial iteration", () => {
    const taskKey = "ag-30@test";
    writePlanningRun(taskKey, 1);
    writePlanningRun(taskKey, 2, {
      withPlanMarkdown: false,
      withPlanJson: false,
    });

    const contract = resolveDesignReviewInputContract(taskKey);

    assert.equal(contract.planningIteration, 1);
    assert.match(contract.designFile, /design-ag-30@test-1\.md$/);
    assert.match(contract.planJsonFile, /plan-ag-30@test-1\.json$/);
    assert.equal(contract.hasQaArtifacts, false);
    assert.equal(contract.qaFile, OPTIONAL_INPUT_NOT_PROVIDED);
    assert.equal(contract.qaJsonFile, OPTIONAL_INPUT_NOT_PROVIDED);
    assert.equal(contract.hasJiraTaskFile, false);
    assert.equal(contract.hasPlanningAnswersJsonFile, false);
  });

  it("fails clearly when a required markdown artifact is missing", () => {
    const taskKey = "ag-31@test";
    writePlanningRun(taskKey, 1, {
      withPlanMarkdown: false,
    });

    assert.throws(
      () => resolveDesignReviewInputContract(taskKey),
      /Design-review requires design and plan markdown\/JSON artifacts from the latest completed planning run\./,
    );
  });

  it("fails clearly when a required structured artifact is invalid", () => {
    const taskKey = "ag-32@test";
    writePlanningRun(taskKey, 1, {
      planJson: { summary: "Broken plan" },
    });

    assert.throws(
      () => resolveDesignReviewInputContract(taskKey),
      /implementation-plan\/v1/,
    );
  });

  it("tolerates an absent QA pair but rejects a partial QA pair", () => {
    const taskKey = "ag-33@test";
    writePlanningRun(taskKey, 1, {
      withQaJson: true,
      withQaMarkdown: false,
    });

    assert.throws(
      () => resolveDesignReviewInputContract(taskKey),
      /complete markdown\/JSON pair/,
    );
  });

  it("includes optional planning answers when the structured artifact is present and valid", () => {
    const taskKey = "ag-34@test";
    writePlanningRun(taskKey, 1);
    const planningAnswersPath = writePlanningAnswers(taskKey);

    const contract = resolveDesignReviewInputContract(taskKey);

    assert.equal(contract.hasPlanningAnswersJsonFile, true);
    assert.equal(contract.planningAnswersJsonFilePath, planningAnswersPath);
    assert.equal(contract.planningAnswersJsonFile, planningAnswersPath);
    assert.equal(contract.hasJiraAttachmentsManifestFile, false);
    assert.equal(contract.jiraAttachmentsManifestFile, OPTIONAL_INPUT_NOT_PROVIDED);
  });

  it("includes optional instant-task input when the structured artifact is present and valid", () => {
    const taskKey = "ag-34b@test";
    writePlanningRun(taskKey, 1);
    const taskInputPath = writeInstantTaskInput(taskKey, {
      form_id: "instant-task-input",
      submitted_at: "2026-04-19T00:00:00.000Z",
      values: {
        task_description: "Add instant-task support.",
        additional_instructions: "Keep Jira flows intact.",
      },
    });

    const contract = resolveDesignReviewInputContract(taskKey);

    assert.equal(contract.hasTaskInputJsonFile, true);
    assert.equal(contract.taskInputJsonFilePath, taskInputPath);
    assert.equal(contract.taskInputJsonFile, taskInputPath);
  });

  it("keeps the design-review contract stable when artifact registry files are present", () => {
    const taskKey = "ag-35@test";
    writePlanningRun(taskKey, 1);
    writeSidecarArtifactIndex(taskKey);

    const contract = resolveDesignReviewInputContract(taskKey);

    assert.equal(contract.planningIteration, 1);
    assert.match(contract.designJsonFile, /design-ag-35@test-1\.json$/);
    assert.match(contract.planJsonFile, /plan-ag-35@test-1\.json$/);
    assert.equal(contract.hasQaArtifacts, false);
  });
});
