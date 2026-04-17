import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const registryModule = await import(pathToFileURL(path.join(distRoot, "structured-artifact-schema-registry.js")).href);
const artifactsModule = await import(pathToFileURL(path.join(distRoot, "structured-artifacts.js")).href);

const { STRUCTURED_ARTIFACT_SCHEMA_IDS, getStructuredArtifactSchema } = registryModule;
const { validateStructuredArtifact } = artifactsModule;

const VALID_DESIGN_REVIEW = {
  summary: "Planning artifacts are implementation-ready with one follow-up warning.",
  status: "approved_with_warnings",
  blocking_findings: [],
  major_findings: [],
  warnings: [
    {
      title: "Missing rollback note",
      description: "The rollout section should mention how to revert the change safely.",
      affected_artifacts: ["plan-json", "design-json"],
    },
  ],
  missing_information: [],
  consistency_checks: [
    {
      name: "Design and plan alignment",
      status: "pass",
      details: "The design and implementation plan describe the same scope and constraints.",
    },
  ],
  qa_coverage_gaps: [],
  recommended_actions: ["Add a short rollback note to the rollout section before implementation starts."],
};

let tempDir;

function writeArtifact(fileName, payload) {
  const filePath = path.join(tempDir, fileName);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return filePath;
}

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), "agentweaver-design-review-schema-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("design-review schema registry", () => {
  it("registers design-review/v1", () => {
    assert.equal(STRUCTURED_ARTIFACT_SCHEMA_IDS.includes("design-review/v1"), true);
    assert.equal(getStructuredArtifactSchema("design-review/v1").type, "object");
  });

  it("accepts a valid design-review/v1 artifact", () => {
    const filePath = writeArtifact("valid-design-review.json", VALID_DESIGN_REVIEW);

    assert.doesNotThrow(() => validateStructuredArtifact(filePath, "design-review/v1"));
  });

  it("rejects a critique item without affected_artifacts", () => {
    const filePath = writeArtifact("invalid-design-review.json", {
      ...VALID_DESIGN_REVIEW,
      warnings: [
        {
          title: "Missing rollback note",
          description: "The rollout section should mention how to revert the change safely.",
          affected_artifacts: [],
        },
      ],
    });

    assert.throws(
      () => validateStructuredArtifact(filePath, "design-review/v1"),
      /affected_artifacts must not be empty/,
    );
  });

  it("rejects a design-review artifact with an unsupported status", () => {
    const filePath = writeArtifact("invalid-design-review-status.json", {
      ...VALID_DESIGN_REVIEW,
      status: "foo",
    });

    assert.throws(
      () => validateStructuredArtifact(filePath, "design-review/v1"),
      /status must be one of: approved, approved_with_warnings, needs_revision/,
    );
  });
});
