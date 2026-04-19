import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { runExpandedPhase } from "../src/pipeline/declarative-flow-runner.js";
import { writeSelectionFileNode } from "../src/pipeline/nodes/write-selection-file-node.js";
import { createArtifactRegistry } from "../src/runtime/artifact-registry.js";

const TEST_SCOPE_KEY = "WRITE-SELECTION-TEST";

function getScopeDir(): string {
  return join(process.cwd(), ".agentweaver", "scopes", TEST_SCOPE_KEY);
}

function getArtifactsDir(): string {
  return join(getScopeDir(), ".artifacts");
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

describe("write-selection-file-node", () => {
  beforeEach(() => {
    setupTestScope();
  });

  afterEach(() => {
    cleanupTestScope();
  });

  it("auto-selects configured blocking severities even when disposition is absent", async () => {
    const reviewJsonFile = join(getArtifactsDir(), `review-${TEST_SCOPE_KEY}-1.json`);
    const selectionFile = join(getScopeDir(), "review-fix-selection.json");

    writeFileSync(reviewJsonFile, JSON.stringify({
      summary: "Review findings",
      ready_to_merge: false,
      findings: [
        {
          severity: "blocker",
          title: "Blocking finding without disposition",
          description: "Should still be selected automatically.",
        },
        {
          severity: "medium",
          title: "Medium finding",
          description: "Should not be selected by the default threshold.",
        },
      ],
    }, null, 2));

    const result = await writeSelectionFileNode.run(
      {} as never,
      {
        outputFile: selectionFile,
        reviewFindingsJsonFile: reviewJsonFile,
        selectionMode: "auto-blocking-severities",
        blockingSeverities: ["blocker", "critical"],
      },
    );

    expect(result.value.selectedFindings).toEqual(["Blocking finding without disposition"]);
    expect(result.value.applyAll).toBe(false);

    const persisted = JSON.parse(readFileSync(selectionFile, "utf8")) as {
      values: { apply_all: boolean; selected_findings: string[] };
    };
    expect(persisted.values.apply_all).toBe(false);
    expect(persisted.values.selected_findings).toEqual(["Blocking finding without disposition"]);
  });

  it("keeps apply_all disabled when no findings match the configured threshold", async () => {
    const reviewJsonFile = join(getArtifactsDir(), `review-${TEST_SCOPE_KEY}-2.json`);
    const selectionFile = join(getScopeDir(), "review-fix-selection-empty.json");

    writeFileSync(reviewJsonFile, JSON.stringify({
      summary: "Review findings",
      ready_to_merge: false,
      findings: [
        {
          severity: "medium",
          title: "Medium finding",
          description: "Should not be auto-selected.",
        },
      ],
    }, null, 2));

    const result = await writeSelectionFileNode.run(
      {} as never,
      {
        outputFile: selectionFile,
        reviewFindingsJsonFile: reviewJsonFile,
        selectionMode: "auto-blocking-severities",
        blockingSeverities: ["blocker", "critical"],
      },
    );

    expect(result.value.selectedFindings).toEqual([]);
    expect(result.value.applyAll).toBe(false);
  });

  it("publishes a manifest for auto-generated review-fix selection files", async () => {
    const reviewJsonFile = join(getArtifactsDir(), `review-${TEST_SCOPE_KEY}-3.json`);
    const selectionFile = join(getScopeDir(), "review-fix-selection-published.json");

    writeFileSync(reviewJsonFile, JSON.stringify({
      summary: "Review findings",
      ready_to_merge: false,
      findings: [
        {
          severity: "high",
          title: "High finding",
          description: "Should be selected and published with a manifest.",
        },
      ],
    }, null, 2));

    const runtime = {
      resolveCmd: (commandName: string) => commandName,
      runCommand: async () => "",
      artifactRegistry: createArtifactRegistry(),
    };

    await runExpandedPhase(
      {
        id: "collect",
        repeatVars: {},
        steps: [
          {
            id: "write_auto_selection",
            node: "write-selection-file",
            repeatVars: {},
            params: {
              outputFile: { const: selectionFile },
              reviewFindingsJsonFile: { const: reviewJsonFile },
              selectionMode: { const: "auto-blocking-severities" },
              blockingSeverities: { const: ["blocker", "critical", "high"] },
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
        nodes: {
          get(kind: string) {
            if (kind !== "write-selection-file") {
              throw new Error(`Unknown node kind: ${kind}`);
            }
            return writeSelectionFileNode as never;
          },
        } as never,
      },
      { taskKey: TEST_SCOPE_KEY },
      {},
    );

    const records = runtime.artifactRegistry.listScopeArtifacts(TEST_SCOPE_KEY);
    expect(records).toHaveLength(1);
    expect(records[0]?.payload_path).toBe(selectionFile);
    expect(records[0]?.schema_id).toBe("user-input/v1");
  });
});
