import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const distIndex = path.resolve(process.cwd(), "dist/index.js");
const distRoot = path.resolve(process.cwd(), "dist");

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

let tempDir;

function scopeHash(projectRoot) {
  return crypto.createHash("sha1").update(projectRoot).digest("hex").slice(0, 8);
}

function scopeKeyForIssue(issueKey) {
  return `${issueKey.toLowerCase()}@${scopeHash(tempDir)}`;
}

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

function writePlanningRun(taskKey, iteration, options = {}) {
  if (options.withDesignMarkdown !== false) {
    writeMarkdownArtifact(taskKey, "design", iteration);
  }
  if (options.withDesignJson !== false) {
    writeJsonArtifact(taskKey, "design", iteration, VALID_DESIGN);
  }
  if (options.withPlanMarkdown !== false) {
    writeMarkdownArtifact(taskKey, "plan", iteration);
  }
  if (options.withPlanJson !== false) {
    writeJsonArtifact(taskKey, "plan", iteration, VALID_PLAN);
  }
}

function runDesignReview(issueKey, options = {}) {
  const args = ["node", distIndex, "design-review"];
  if (options.dry !== false) {
    args.push("--dry");
  }
  args.push(issueKey);
  return spawnSync(args[0], args.slice(1), {
    cwd: tempDir,
    encoding: "utf8",
    timeout: 15000,
    env: {
      ...process.env,
      CODEX_BIN: options.codexBin ?? "/bin/echo",
      ...(options.env ?? {}),
    },
  });
}

function collectStructuredSchemaIds(spec) {
  return spec.phases.flatMap((phase) =>
    phase.steps.flatMap((step) =>
      (step.expect ?? [])
        .filter((entry) => entry.kind === "require-structured-artifacts")
        .flatMap((entry) => entry.items.map((item) => item.schemaId)),
    ),
  );
}

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), "agentweaver-design-review-flow-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("design-review CLI flow", () => {
  it("uses the resolved latest completed planning run and tolerates missing optional QA/context", () => {
    const issueKey = "AG-30";
    const taskKey = scopeKeyForIssue(issueKey);
    writePlanningRun(taskKey, 1);
    writePlanningRun(taskKey, 2, {
      withPlanMarkdown: false,
      withPlanJson: false,
    });

    const result = runDesignReview(issueKey);

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  });

  it("fails before llm execution when required planning artifacts are missing", () => {
    const issueKey = "AG-31";
    const taskKey = scopeKeyForIssue(issueKey);
    writePlanningRun(taskKey, 1, {
      withPlanMarkdown: false,
    });

    const result = runDesignReview(issueKey);

    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  });

  it("validates design-review against design-review/v1 without migrating other review flows", () => {
    const designReviewSpec = JSON.parse(
      readFileSync(path.join(distRoot, "pipeline/flow-specs/design-review.json"), "utf8"),
    );
    const reviewSpec = JSON.parse(
      readFileSync(path.join(distRoot, "pipeline/flow-specs/review/review.json"), "utf8"),
    );
    const gitlabReviewSpec = JSON.parse(
      readFileSync(path.join(distRoot, "pipeline/flow-specs/gitlab/gitlab-review.json"), "utf8"),
    );
    const gitlabDiffReviewSpec = JSON.parse(
      readFileSync(path.join(distRoot, "pipeline/flow-specs/gitlab/gitlab-diff-review.json"), "utf8"),
    );

    const designReviewSchemaIds = collectStructuredSchemaIds(designReviewSpec);
    const reviewSchemaIds = collectStructuredSchemaIds(reviewSpec);
    const gitlabReviewSchemaIds = collectStructuredSchemaIds(gitlabReviewSpec);
    const gitlabDiffReviewSchemaIds = collectStructuredSchemaIds(gitlabDiffReviewSpec);

    assert.equal(designReviewSchemaIds.includes("design-review/v1"), true);
    assert.equal(designReviewSchemaIds.includes("review-findings/v1"), false);
    assert.equal(reviewSchemaIds.includes("review-findings/v1"), true);
    assert.equal(gitlabReviewSchemaIds.includes("review-findings/v1"), true);
    assert.equal(gitlabDiffReviewSchemaIds.includes("review-findings/v1"), true);
  });
});
