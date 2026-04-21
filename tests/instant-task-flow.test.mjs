import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distIndex = path.resolve(process.cwd(), "dist/index.js");
const distRoot = path.resolve(process.cwd(), "dist");
const distIndexUrl = pathToFileURL(distIndex).href;
const flowCatalogModule = await import(
  pathToFileURL(path.join(distRoot, "pipeline/flow-catalog.js")).href
);
const { loadDeclarativeFlow } = await import(
  pathToFileURL(path.join(distRoot, "pipeline/declarative-flows.js")).href
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
      decision: "Use structured review routing.",
      rationale: "It keeps instant-task review deterministic.",
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
      title: "Implement instant-task routing",
      details: "Use planning artifacts and task input for structured review.",
    },
  ],
  tests: ["Run routing tests"],
  rollout_notes: ["Ship atomically"],
  follow_up_items: [],
};

let tempDir;
let originalCwd;

function scopeHash(projectRoot) {
  return crypto.createHash("sha1").update(projectRoot).digest("hex").slice(0, 8);
}

function scopeKeyForBranch(branchName) {
  return `${branchName}@${scopeHash(tempDir)}`;
}

function scopeDir(scopeKey) {
  return path.join(tempDir, ".agentweaver", "scopes", scopeKey);
}

function artifactsDir(scopeKey) {
  return path.join(scopeDir(scopeKey), ".artifacts");
}

function writeMarkdownArtifact(scopeKey, prefix, iteration, body = `# ${prefix}\n`) {
  const filePath = path.join(scopeDir(scopeKey), `${prefix}-${scopeKey}-${iteration}.md`);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, body, "utf8");
}

function writeJsonArtifact(scopeKey, prefix, iteration, payload) {
  const filePath = path.join(artifactsDir(scopeKey), `${prefix}-${scopeKey}-${iteration}.json`);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeInvalidInstantTaskInput(scopeKey) {
  const filePath = path.join(artifactsDir(scopeKey), `instant-task-input-${scopeKey}.json`);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, "{not-json\n", "utf8");
}

function setupGitRepo(branchName) {
  spawnSync("git", ["init"], { cwd: tempDir, stdio: "ignore" });
  spawnSync("git", ["config", "user.email", "agentweaver@example.com"], { cwd: tempDir, stdio: "ignore" });
  spawnSync("git", ["config", "user.name", "AgentWeaver Test"], { cwd: tempDir, stdio: "ignore" });
  spawnSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: tempDir, stdio: "ignore" });
  spawnSync("git", ["checkout", "-b", branchName], { cwd: tempDir, stdio: "ignore" });
}

async function runCliInProcess(args) {
  const { main } = await import(distIndexUrl);
  const originalCwdForRun = process.cwd();
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const originalEnv = {
    CODEX_BIN: process.env.CODEX_BIN,
    OPENCODE_BIN: process.env.OPENCODE_BIN,
  };
  let stdout = "";
  let stderr = "";

  process.stdout.write = ((chunk, encoding, callback) => {
    stdout += typeof chunk === "string" ? chunk : chunk.toString(typeof encoding === "string" ? encoding : undefined);
    if (typeof encoding === "function") {
      encoding();
    }
    if (typeof callback === "function") {
      callback();
    }
    return true;
  });
  process.stderr.write = ((chunk, encoding, callback) => {
    stderr += typeof chunk === "string" ? chunk : chunk.toString(typeof encoding === "string" ? encoding : undefined);
    if (typeof encoding === "function") {
      encoding();
    }
    if (typeof callback === "function") {
      callback();
    }
    return true;
  });

  process.chdir(tempDir);
  process.env.CODEX_BIN = "/bin/echo";
  process.env.OPENCODE_BIN = "/bin/echo";

  try {
    const status = await main(args);
    return { status, stdout, stderr };
  } finally {
    process.chdir(originalCwdForRun);
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    if (originalEnv.CODEX_BIN === undefined) {
      delete process.env.CODEX_BIN;
    } else {
      process.env.CODEX_BIN = originalEnv.CODEX_BIN;
    }
    if (originalEnv.OPENCODE_BIN === undefined) {
      delete process.env.OPENCODE_BIN;
    } else {
      process.env.OPENCODE_BIN = originalEnv.OPENCODE_BIN;
    }
  }
}

async function runCli(args) {
  const result = spawnSync("node", [distIndex, ...args], {
    cwd: tempDir,
    encoding: "utf8",
    timeout: 15000,
    env: {
      ...process.env,
      CODEX_BIN: "/bin/echo",
      OPENCODE_BIN: "/bin/echo",
    },
  });
  if (result.error?.code === "EPERM") {
    return runCliInProcess(args);
  }
  return result;
}

async function runHelp() {
  const result = spawnSync("node", [distIndex, "--help"], {
    cwd: tempDir,
    encoding: "utf8",
    timeout: 15000,
  });
  if (result.error?.code === "EPERM") {
    return runCliInProcess(["--help"]);
  }
  return result;
}

beforeEach(() => {
  originalCwd = process.cwd();
  tempDir = mkdtempSync(path.join(os.tmpdir(), "agentweaver-instant-task-"));
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tempDir, { recursive: true, force: true });
});

describe("instant-task command and flow", () => {
  it("appears in help output and built-in flow catalog", async () => {
    const help = await runHelp();
    assert.equal(help.status, 0, help.stderr);

    const entry = (await flowCatalogModule.loadInteractiveFlowCatalog(process.cwd())).find((candidate) => candidate.id === "instant-task");
    assert.ok(entry, "instant-task flow should exist");
    assert.equal(flowCatalogModule.builtInCommandFlowFile("instant-task"), "instant-task.json");
  });

  it("rejects explicit scope overrides for instant-task", async () => {
    const result = await runCli(["instant-task", "--scope", "demo", "--dry"]);

    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  });

  it("uses the expected top-level pipeline phases", () => {
    const flow = await loadDeclarativeFlow({ source: "built-in", fileName: "instant-task.json" });
    assert.deepEqual(flow.phases.map((phase) => phase.id), [
      "source",
      "normalize",
      "plan",
      "design_review_loop",
      "implement",
      "review-loop",
    ]);
  });

  it("reuses the stored instant-task input artifact unless interactive restart requests editing", () => {
    const flow = await loadDeclarativeFlow({ source: "built-in", fileName: "task-source/manual-input.json" });
    const sourcePhase = flow.phases.find((phase) => phase.id === "source");
    const editStep = sourcePhase?.steps.find((step) => step.id === "edit_task_source");
    const collectStep = sourcePhase?.steps.find((step) => step.id === "collect_task_source");
    const validateStep = sourcePhase?.steps.find((step) => step.id === "validate_task_source_artifact");

    assert.ok(editStep, "edit_task_source step should exist");
    assert.ok(collectStep, "collect_task_source step should exist");
    assert.ok(validateStep, "validate_task_source_artifact step should exist");
    assert.deepEqual(editStep.when, {
      all: [
        {
          ref: "params.repromptInstantTaskInput",
        },
        {
          exists: {
            artifact: {
              kind: "instant-task-input-json-file",
              taskKey: { ref: "params.taskKey" },
            },
          },
        },
      ],
    });
    assert.deepEqual(collectStep.when, {
      not: {
        exists: {
          artifact: {
            kind: "instant-task-input-json-file",
            taskKey: { ref: "params.taskKey" },
          },
        },
      },
    });
    assert.deepEqual(validateStep.when, {
      all: [
        {
          not: {
            ref: "params.repromptInstantTaskInput",
          },
        },
        {
          exists: {
            artifact: {
              kind: "instant-task-input-json-file",
              taskKey: { ref: "params.taskKey" },
            },
          },
        },
      ],
    });
  });

  it("requires the exact rerun planning iteration artifacts before reporting plan success", () => {
    const flow = await loadDeclarativeFlow({ source: "built-in", fileName: "plan.json" });
    const planPhase = flow.phases.find((phase) => phase.id === "plan");
    const runPlanStep = planPhase?.steps.find((step) => step.id === "run_plan");

    assert.ok(runPlanStep, "run_plan step should exist");

    const requiredArtifacts = runPlanStep.params?.requiredArtifacts;
    assert.deepEqual(requiredArtifacts, {
      list: [
        {
          artifact: {
            kind: "design-file",
            taskKey: { ref: "params.taskKey" },
            iteration: { ref: "params.designIteration" },
          },
        },
        {
          artifact: {
            kind: "design-json-file",
            taskKey: { ref: "params.taskKey" },
            iteration: { ref: "params.designIteration" },
          },
        },
        {
          artifact: {
            kind: "plan-file",
            taskKey: { ref: "params.taskKey" },
            iteration: { ref: "params.planIteration" },
          },
        },
        {
          artifact: {
            kind: "plan-json-file",
            taskKey: { ref: "params.taskKey" },
            iteration: { ref: "params.planIteration" },
          },
        },
        {
          artifact: {
            kind: "qa-file",
            taskKey: { ref: "params.taskKey" },
            iteration: { ref: "params.qaIteration" },
          },
        },
        {
          artifact: {
            kind: "qa-json-file",
            taskKey: { ref: "params.taskKey" },
            iteration: { ref: "params.qaIteration" },
          },
        },
      ],
    });

    const requireArtifactsExpectation = runPlanStep.expect?.find((candidate) => candidate.kind === "require-artifacts");
    assert.ok(requireArtifactsExpectation, "run_plan should require its markdown and JSON artifacts");
    assert.deepEqual(requireArtifactsExpectation.paths, requiredArtifacts);
  });

  it("fails direct review and review-loop when planning exists but task context is missing", async () => {
    const branchName = "instant-task-branch";
    setupGitRepo(branchName);
    process.chdir(tempDir);

    const scopeKey = scopeKeyForBranch(branchName);
    writeMarkdownArtifact(scopeKey, "design", 1);
    writeJsonArtifact(scopeKey, "design", 1, VALID_DESIGN);
    writeMarkdownArtifact(scopeKey, "plan", 1);
    writeJsonArtifact(scopeKey, "plan", 1, VALID_PLAN);

    const reviewResult = await runCli(["review", "--dry"]);
    assert.notEqual(reviewResult.status, 0, `${reviewResult.stdout}\n${reviewResult.stderr}`);
    assert.match(
      reviewResult.stderr,
      /Structured review requires a normalized task-context artifact, or legacy Jira\/instant-task context/,
    );

    const reviewLoopResult = await runCli(["review-loop", "--dry"]);
    assert.notEqual(reviewLoopResult.status, 0, `${reviewLoopResult.stdout}\n${reviewLoopResult.stderr}`);
    assert.match(
      reviewLoopResult.stderr,
      /Structured review requires a normalized task-context artifact, or legacy Jira\/instant-task context/,
    );
  });

  it("fails direct review when the instant-task input artifact exists but is invalid", async () => {
    const branchName = "instant-task-invalid-input";
    setupGitRepo(branchName);
    process.chdir(tempDir);

    const scopeKey = scopeKeyForBranch(branchName);
    writeMarkdownArtifact(scopeKey, "design", 1);
    writeJsonArtifact(scopeKey, "design", 1, VALID_DESIGN);
    writeMarkdownArtifact(scopeKey, "plan", 1);
    writeJsonArtifact(scopeKey, "plan", 1, VALID_PLAN);
    writeInvalidInstantTaskInput(scopeKey);

    const reviewResult = await runCli(["review", "--dry"]);

    assert.notEqual(reviewResult.status, 0, `${reviewResult.stdout}\n${reviewResult.stderr}`);
  });

  it("fails instant-task reruns when the persisted input artifact is corrupted", async () => {
    const branchName = "instant-task-corrupted-rerun";
    setupGitRepo(branchName);
    process.chdir(tempDir);

    const scopeKey = scopeKeyForBranch(branchName);
    writeInvalidInstantTaskInput(scopeKey);

    const result = await runCli(["instant-task", "--dry"]);

    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(
      result.stderr,
      /Instant-task source input is missing or invalid\./,
    );
  });
});
