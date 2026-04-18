import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { designReviewVerdictNode } from "../src/pipeline/nodes/design-review-verdict-node.js";

const TEST_SCOPE_KEY = "TEST-123";

function getTestScopeDir(): string {
  return join(process.cwd(), ".agentweaver", "scopes", TEST_SCOPE_KEY);
}

function getTestArtifactsDir(): string {
  return join(getTestScopeDir(), ".artifacts");
}

function setupTestScope(): void {
  mkdirSync(getTestArtifactsDir(), { recursive: true });
}

function cleanupTestScope(): void {
  const scopeDir = getTestScopeDir();
  if (existsSync(scopeDir)) {
    rmSync(scopeDir, { recursive: true, force: true });
  }
}

function writeDesignReviewJson(iteration: number, status: string, summary: string): void {
  const filePath = join(getTestArtifactsDir(), `design-review-${TEST_SCOPE_KEY}-${iteration}.json`);
  writeFileSync(filePath, JSON.stringify({
    status,
    summary,
    blocking_findings: [],
    major_findings: [],
    warnings: [],
    missing_information: [],
    consistency_checks: [],
    qa_coverage_gaps: [],
    recommended_actions: [],
  }, null, 2));
}

function writeDesignReviewJsonMissingStatus(iteration: number, summary: string): void {
  const filePath = join(getTestArtifactsDir(), `design-review-${TEST_SCOPE_KEY}-${iteration}.json`);
  writeFileSync(filePath, JSON.stringify({
    summary,
    blocking_findings: [],
    major_findings: [],
    warnings: [],
    missing_information: [],
    consistency_checks: [],
    qa_coverage_gaps: [],
    recommended_actions: [],
  }, null, 2));
}

describe("design-review-verdict-node", () => {
  beforeEach(() => {
    setupTestScope();
  });

  afterEach(() => {
    cleanupTestScope();
  });

  it("should return approved status and canProceed=true", async () => {
    writeDesignReviewJson(1, "approved", "Design looks good");
    const result = await designReviewVerdictNode.run(
      {} as never,
      { taskKey: TEST_SCOPE_KEY, iteration: 1 },
    );
    expect(result.value.status).toBe("approved");
    expect(result.value.canProceed).toBe(true);
    expect(result.value.needsRevision).toBe(false);
    expect(result.value.verdict).toBe("Design looks good");
  });

  it("should return approved_with_warnings status and canProceed=true", async () => {
    writeDesignReviewJson(1, "approved_with_warnings", "Design acceptable with warnings");
    const result = await designReviewVerdictNode.run(
      {} as never,
      { taskKey: TEST_SCOPE_KEY, iteration: 1 },
    );
    expect(result.value.status).toBe("approved_with_warnings");
    expect(result.value.canProceed).toBe(true);
    expect(result.value.needsRevision).toBe(false);
  });

  it("should return needs_revision status and canProceed=false", async () => {
    writeDesignReviewJson(1, "needs_revision", "Design requires changes");
    const result = await designReviewVerdictNode.run(
      {} as never,
      { taskKey: TEST_SCOPE_KEY, iteration: 1 },
    );
    expect(result.value.status).toBe("needs_revision");
    expect(result.value.canProceed).toBe(false);
    expect(result.value.needsRevision).toBe(true);
    expect(result.value.verdict).toBe("Design requires changes");
  });

  it("should throw when status field is missing (schema validation fails)", async () => {
    writeDesignReviewJsonMissingStatus(1, "No status field");
    await expect(
      designReviewVerdictNode.run(
        {} as never,
        { taskKey: TEST_SCOPE_KEY, iteration: 1 },
      ),
    ).rejects.toThrow("Design review verdict is invalid or missing");
  });

  it("should throw when design-review JSON is missing", async () => {
    await expect(
      designReviewVerdictNode.run(
        {} as never,
        { taskKey: TEST_SCOPE_KEY, iteration: 1 },
      ),
    ).rejects.toThrow();
  });

  it("should throw when design-review JSON is invalid", async () => {
    const filePath = join(getTestArtifactsDir(), `design-review-${TEST_SCOPE_KEY}-1.json`);
    writeFileSync(filePath, "not valid json{");
    await expect(
      designReviewVerdictNode.run(
        {} as never,
        { taskKey: TEST_SCOPE_KEY, iteration: 1 },
      ),
    ).rejects.toThrow();
  });

  it("should use iteration 1 by default when not specified", async () => {
    writeDesignReviewJson(1, "approved", "Default iteration test");
    const result = await designReviewVerdictNode.run(
      {} as never,
      { taskKey: TEST_SCOPE_KEY },
    );
    expect(result.value.status).toBe("approved");
  });

  it("should read from specific iteration when specified", async () => {
    writeDesignReviewJson(2, "needs_revision", "Second iteration verdict");
    writeDesignReviewJson(1, "approved", "First iteration verdict");
    const result = await designReviewVerdictNode.run(
      {} as never,
      { taskKey: TEST_SCOPE_KEY, iteration: 2 },
    );
    expect(result.value.status).toBe("needs_revision");
    expect(result.value.verdict).toBe("Second iteration verdict");
  });
});