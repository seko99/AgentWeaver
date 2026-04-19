import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { readyToMergeFile } from "../src/artifacts.js";
import { runExpandedPhase } from "../src/pipeline/declarative-flow-runner.js";
import { createNodeRegistry } from "../src/pipeline/node-registry.js";
import { reviewVerdictNode } from "../src/pipeline/nodes/review-verdict-node.js";
import { createArtifactRegistry } from "../src/runtime/artifact-registry.js";

const TEST_SCOPE_KEY = "REVIEW-VERDICT-TEST";

function getScopeDir(): string {
  return join(process.cwd(), ".agentweaver", "scopes", TEST_SCOPE_KEY);
}

function getArtifactsDir(): string {
  return join(getScopeDir(), ".artifacts");
}

function reviewJsonPath(iteration: number): string {
  return join(getArtifactsDir(), `review-${TEST_SCOPE_KEY}-${iteration}.json`);
}

function setupTestScope(): void {
  mkdirSync(getArtifactsDir(), { recursive: true });
}

function cleanupTestScope(): void {
  const scopeDir = getScopeDir();
  if (existsSync(scopeDir)) {
    rmSync(scopeDir, { recursive: true, force: true });
  }
}

function writeReviewJson(iteration: number, payload: object): void {
  writeFileSync(reviewJsonPath(iteration), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

describe("review-verdict-node", () => {
  beforeEach(() => {
    setupTestScope();
  });

  afterEach(() => {
    cleanupTestScope();
  });

  it("marks review ready to merge when findings do not cross the default threshold", async () => {
    writeReviewJson(1, {
      summary: "Only non-blocking findings remain.",
      ready_to_merge: false,
      findings: [
        {
          severity: "medium",
          title: "Non-default medium finding",
          description: "Should not block under the default threshold.",
        },
      ],
    });

    const result = await reviewVerdictNode.run(
      { mdLang: "en" } as never,
      { taskKey: TEST_SCOPE_KEY, iteration: 1 },
    );

    expect(result.value.readyToMerge).toBe(true);
    expect(result.value.blockingSeverities).toEqual(["blocker", "critical", "high"]);
    expect(result.value.blockingFindingTitles).toEqual([]);
    expect(existsSync(readyToMergeFile(TEST_SCOPE_KEY))).toBe(true);

    const rewritten = JSON.parse(readFileSync(reviewJsonPath(1), "utf8")) as { ready_to_merge: boolean };
    expect(rewritten.ready_to_merge).toBe(true);
  });

  it("blocks merge when an overridden threshold includes the finding severity", async () => {
    writeReviewJson(1, {
      summary: "High finding should block under the override.",
      ready_to_merge: true,
      findings: [
        {
          severity: "high",
          title: "High severity finding",
          description: "Must block when high is configured as blocking.",
        },
      ],
    });
    writeFileSync(readyToMergeFile(TEST_SCOPE_KEY), "stale marker\n", "utf8");

    const result = await reviewVerdictNode.run(
      { mdLang: "ru" } as never,
      { taskKey: TEST_SCOPE_KEY, iteration: 1, blockingSeverities: ["blocker", "critical", "high"] },
    );

    expect(result.value.readyToMerge).toBe(false);
    expect(result.value.blockingSeverities).toEqual(["blocker", "critical", "high"]);
    expect(result.value.blockingFindingTitles).toEqual(["High severity finding"]);
    expect(existsSync(readyToMergeFile(TEST_SCOPE_KEY))).toBe(false);

    const rewritten = JSON.parse(readFileSync(reviewJsonPath(1), "utf8")) as { ready_to_merge: boolean };
    expect(rewritten.ready_to_merge).toBe(false);
  });

  it("publishes manifests for rewritten review JSON and ready-to-merge marker", async () => {
    writeReviewJson(1, {
      summary: "Only medium findings remain.",
      ready_to_merge: false,
      findings: [
        {
          severity: "medium",
          title: "Medium finding",
          description: "Should not block under the default threshold.",
        },
      ],
    });

    const runtime = {
      resolveCmd: (commandName: string) => commandName,
      runCommand: async () => "",
      artifactRegistry: createArtifactRegistry(),
    };

    await runExpandedPhase(
      {
        id: "review",
        repeatVars: {},
        steps: [
          {
            id: "review_verdict",
            node: "review-verdict",
            repeatVars: {},
            params: {
              taskKey: { const: TEST_SCOPE_KEY },
              iteration: { const: 1 },
            },
          },
        ],
      },
      {
        issueKey: TEST_SCOPE_KEY,
        jiraRef: TEST_SCOPE_KEY,
        cwd: process.cwd(),
        env: {},
        ui: {} as never,
        dryRun: false,
        verbose: false,
        mdLang: "en",
        runtime,
        executors: {} as never,
        nodes: createNodeRegistry(),
      },
      { taskKey: TEST_SCOPE_KEY },
      {},
    );

    const records = runtime.artifactRegistry.listScopeArtifacts(TEST_SCOPE_KEY);
    const payloadPaths = records.map((record) => record.payload_path);
    expect(payloadPaths).toContain(reviewJsonPath(1));
    expect(payloadPaths).toContain(readyToMergeFile(TEST_SCOPE_KEY));
  });
});
