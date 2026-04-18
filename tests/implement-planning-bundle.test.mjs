import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { resolveLatestPlanningBundle } = await import(
  pathToFileURL(path.join(distRoot, "runtime/planning-bundle.js")).href
);
const { resolveValue } = await import(
  pathToFileURL(path.join(distRoot, "pipeline/value-resolver.js")).href
);

const implementFlowSpec = JSON.parse(
  readFileSync(path.join(distRoot, "pipeline/flow-specs/implement.json"), "utf8"),
);
const autoCommonFlowSpec = JSON.parse(
  readFileSync(path.join(distRoot, "pipeline/flow-specs/auto-common.json"), "utf8"),
);
const autoGolangFlowSpec = JSON.parse(
  readFileSync(path.join(distRoot, "pipeline/flow-specs/auto-golang.json"), "utf8"),
);

const VALID_DESIGN = {
  summary: "Design summary",
  goals: ["Goal"],
  non_goals: [],
  components: ["runtime"],
  current_state: [],
  target_state: [],
  affected_code: [],
  business_rules: [],
  decisions: [
    {
      component: "runtime",
      decision: "Resolve one planning bundle.",
      rationale: "It keeps implement deterministic.",
    },
  ],
  migration_strategy: [],
  database_changes: [],
  api_changes: [],
  risks: ["Broken iteration risk"],
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
      title: "Implement resolver",
      details: "Add a shared planning resolver.",
    },
  ],
  tests: ["Run regression coverage"],
  rollout_notes: ["Ship atomically"],
  follow_up_items: [],
};

const VALID_QA = {
  summary: "QA summary",
  test_scenarios: [
    {
      id: "qa-1",
      title: "Smoke test",
      expected_result: "Implement uses the newest bundle.",
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

beforeEach(() => {
  originalCwd = process.cwd();
  tempDir = mkdtempSync(path.join(os.tmpdir(), "agentweaver-implement-bundle-"));
  process.chdir(tempDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tempDir, { recursive: true, force: true });
});

describe("resolveLatestPlanningBundle", () => {
  it("uses the newest complete planning bundle automatically", () => {
    const taskKey = "ag-74@test";
    writePlanningBundle(taskKey, 1);
    writePlanningBundle(taskKey, 2);

    const bundle = resolveLatestPlanningBundle(taskKey);

    assert.equal(bundle.planningIteration, 2);
    assert.match(bundle.designFile, /design-ag-74@test-2\.md$/);
    assert.match(bundle.designJsonFile, /design-ag-74@test-2\.json$/);
    assert.match(bundle.planFile, /plan-ag-74@test-2\.md$/);
    assert.match(bundle.planJsonFile, /plan-ag-74@test-2\.json$/);
    assert.match(bundle.qaFile, /qa-ag-74@test-2\.md$/);
    assert.match(bundle.qaJsonFile, /qa-ag-74@test-2\.json$/);
  });

  it("fails on an incomplete newest iteration instead of falling back to an older bundle", () => {
    const taskKey = "ag-75@test";
    writePlanningBundle(taskKey, 1);
    writePlanningBundle(taskKey, 2, {
      withQaMarkdown: false,
    });

    assert.throws(
      () => resolveLatestPlanningBundle(taskKey),
      (error) => {
        assert.match(error.message, /iteration 2/);
        assert.match(error.message, /qa-ag-75@test-2\.md/);
        assert.doesNotMatch(error.message, /iteration 1/);
        return true;
      },
    );
  });

  it("fails when the newest complete bundle contains schema-invalid JSON", () => {
    const taskKey = "ag-76@test";
    writePlanningBundle(taskKey, 1);
    writePlanningBundle(taskKey, 2, {
      qaJson: { summary: "Broken QA" },
    });

    assert.throws(
      () => resolveLatestPlanningBundle(taskKey),
      (error) => {
        assert.match(error.message, /iteration 2/);
        assert.match(error.message, /qa-ag-76@test-2\.json/);
        assert.match(error.message, /qa-plan\/v1/);
        return true;
      },
    );
  });
});

describe("implement prompt bindings", () => {
  it("resolve every planning artifact with the same explicit iteration", () => {
    const taskKey = "ag-77@test";
    const planningIteration = 3;
    const promptVars = implementFlowSpec.phases[0].steps[0].prompt.vars;
    const context = {
      flowParams: { taskKey, planningIteration, extraPrompt: null },
      flowConstants: {},
      pipelineContext: {},
      repeatVars: {},
    };

    const resolved = Object.fromEntries(
      Object.entries(promptVars).map(([key, value]) => [key, resolveValue(value, context)]),
    );

    assert.match(resolved.design_file, /design-ag-77@test-3\.md$/);
    assert.match(resolved.design_json_file, /design-ag-77@test-3\.json$/);
    assert.match(resolved.plan_file, /plan-ag-77@test-3\.md$/);
    assert.match(resolved.plan_json_file, /plan-ag-77@test-3\.json$/);
    assert.match(resolved.qa_file, /qa-ag-77@test-3\.md$/);
    assert.match(resolved.qa_json_file, /qa-ag-77@test-3\.json$/);
  });
});

function resolveImplementPhasePromptVars(flowSpec, taskKey, planningIteration) {
  const implementPhase = flowSpec.phases.find((phase) => phase.id === "implement");
  const runImplementStep = implementPhase.steps.find((step) => step.id === "run_implement");
  const promptVars = runImplementStep.prompt.vars;
  const context = {
    flowParams: { taskKey, extraPrompt: null },
    flowConstants: {},
    pipelineContext: {},
    repeatVars: {},
    executionState: {
      flowKind: "auto-flow",
      flowVersion: 1,
      terminated: false,
      phases: [
        {
          id: "implement",
          status: "done",
          repeatVars: {},
          steps: [
            {
              id: "resolve_planning_bundle",
              status: "done",
              value: {
                planningIteration,
                designFile: `/.agentweaver/scopes/${taskKey}/design-${taskKey}-${planningIteration}.md`,
                designJsonFile: `/.agentweaver/scopes/${taskKey}/.artifacts/design-${taskKey}-${planningIteration}.json`,
                planFile: `/.agentweaver/scopes/${taskKey}/plan-${taskKey}-${planningIteration}.md`,
                planJsonFile: `/.agentweaver/scopes/${taskKey}/.artifacts/plan-${taskKey}-${planningIteration}.json`,
                qaFile: `/.agentweaver/scopes/${taskKey}/qa-${taskKey}-${planningIteration}.md`,
                qaJsonFile: `/.agentweaver/scopes/${taskKey}/.artifacts/qa-${taskKey}-${planningIteration}.json`,
              },
            },
            {
              id: "run_implement",
              status: "pending",
            },
          ],
        },
      ],
    },
  };

  return Object.fromEntries(
    Object.entries(promptVars).map(([key, value]) => [key, resolveValue(value, context)]),
  );
}

describe("auto flow implement bindings", () => {
  for (const [flowName, flowSpec] of [
    ["auto-common", autoCommonFlowSpec],
    ["auto-golang", autoGolangFlowSpec],
  ]) {
    it(`${flowName} resolves all implement artifacts from the shared planning bundle step`, () => {
      const taskKey = "ag-78@test";
      const planningIteration = 4;
      const resolved = resolveImplementPhasePromptVars(flowSpec, taskKey, planningIteration);

      assert.match(resolved.design_file, /design-ag-78@test-4\.md$/);
      assert.match(resolved.design_json_file, /design-ag-78@test-4\.json$/);
      assert.match(resolved.plan_file, /plan-ag-78@test-4\.md$/);
      assert.match(resolved.plan_json_file, /plan-ag-78@test-4\.json$/);
      assert.match(resolved.qa_file, /qa-ag-78@test-4\.md$/);
      assert.match(resolved.qa_json_file, /qa-ag-78@test-4\.json$/);
    });
  }
});
