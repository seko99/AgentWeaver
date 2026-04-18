import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { flowReadinessCheck } = await import(
  pathToFileURL(path.join(distRoot, "doctor/checks/flow-readiness.js")).href
);

const VALID_DESIGN = {
  summary: "Design summary",
  goals: ["Goal"],
  non_goals: [],
  components: ["doctor"],
  current_state: [],
  target_state: [],
  affected_code: [],
  business_rules: [],
  decisions: [
    {
      component: "doctor",
      decision: "Use bundle readiness.",
      rationale: "It should match implement.",
    },
  ],
  migration_strategy: [],
  database_changes: [],
  api_changes: [],
  risks: ["Readiness drift risk"],
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
      title: "Check readiness",
      details: "Inspect the newest planning bundle.",
    },
  ],
  tests: ["Run doctor"],
  rollout_notes: ["No rollout issues"],
  follow_up_items: [],
};

const VALID_QA = {
  summary: "QA summary",
  test_scenarios: [
    {
      id: "qa-1",
      title: "Readiness check",
      expected_result: "Doctor matches implement.",
    },
  ],
  non_functional_checks: [],
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

function writePlanningBundle(taskKey, iteration, options = {}) {
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
  if (options.withQaMarkdown !== false) {
    writeMarkdownArtifact(taskKey, "qa", iteration);
  }
  if (options.withQaJson !== false) {
    writeJsonArtifact(taskKey, "qa", iteration, options.qaJson ?? VALID_QA);
  }
}

async function getImplementEntry() {
  const result = await flowReadinessCheck.execute();
  const entry = result.data.entries.find((candidate) => candidate.flowId === "implement");
  assert.ok(entry, "implement entry should be present");
  return entry;
}

beforeEach(() => {
  originalCwd = process.cwd();
  tempDir = mkdtempSync(path.join(os.tmpdir(), "agentweaver-doctor-flow-"));
  process.chdir(tempDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tempDir, { recursive: true, force: true });
});

describe("flowReadinessCheck", () => {
  it("marks implement available when the newest planning bundle is complete and valid", async () => {
    const taskKey = "ag-78@test";
    writePlanningBundle(taskKey, 1);

    const entry = await getImplementEntry();

    assert.equal(entry.state, "available");
    assert.equal(entry.reasons.length, 0);
  });

  it("reports the newest broken planning iteration as invalid state for implement", async () => {
    const taskKey = "ag-79@test";
    writePlanningBundle(taskKey, 1);
    writePlanningBundle(taskKey, 2, {
      withQaJson: false,
    });

    const entry = await getImplementEntry();

    assert.equal(entry.state, "invalid_state");
    assert.match(entry.reasons.join("\n"), /iteration 2/);
    assert.match(entry.reasons.join("\n"), /qa-ag-79@test-2\.json/);
    assert.match(entry.nextStep, /Regenerate the planning artifacts/);
  });
});
