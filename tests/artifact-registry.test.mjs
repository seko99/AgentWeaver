import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { createArtifactRegistry } = await import(
  pathToFileURL(path.join(distRoot, "runtime/artifact-registry.js")).href
);
const { artifactIndexFile, artifactManifestSidecarPath, planJsonFile, scopeWorkspaceDir } = await import(
  pathToFileURL(path.join(distRoot, "artifacts.js")).href
);
const { runExpandedPhase } = await import(
  pathToFileURL(path.join(distRoot, "pipeline/declarative-flow-runner.js")).href
);
const { ARTIFACT_LINEAGE_REF_PATHS_PARAM } = await import(
  pathToFileURL(path.join(distRoot, "pipeline/value-resolver.js")).href
);
const { ensureSummaryJsonNode } = await import(
  pathToFileURL(path.join(distRoot, "pipeline/nodes/ensure-summary-json-node.js")).href
);
const { userInputNode } = await import(
  pathToFileURL(path.join(distRoot, "pipeline/nodes/user-input-node.js")).href
);

let originalCwd;
let tempDir;

beforeEach(() => {
  originalCwd = process.cwd();
  tempDir = mkdtempSync(path.join(os.tmpdir(), "agentweaver-artifact-registry-"));
  process.chdir(tempDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tempDir, { recursive: true, force: true });
});

function writeScopeFile(scopeKey, relativePath, content) {
  const filePath = path.join(scopeWorkspaceDir(scopeKey), relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");
  return filePath;
}

function createRuntime() {
  return {
    resolveCmd: (commandName) => commandName,
    runCommand: async () => "",
    artifactRegistry: createArtifactRegistry(),
  };
}

function createContext(scopeKey, nodes, options = {}) {
  const runtime = options.runtime ?? createRuntime();
  return {
    issueKey: scopeKey,
    jiraRef: scopeKey,
    cwd: tempDir,
    env: {},
    ui: {},
    dryRun: options.dryRun ?? false,
    verbose: false,
    mdLang: "ru",
    runtime,
    executors: {},
    requestUserInput: options.requestUserInput,
    nodes: {
      get(kind) {
        const node = nodes[kind];
        if (!node) {
          throw new Error(`Unknown node kind: ${kind}`);
        }
        return node;
      },
    },
  };
}

describe("artifact registry", () => {
  it("keeps singleton history, supersession, idempotency, and rebuildable index", () => {
    const scopeKey = "ag-77@test";
    const registry = createArtifactRegistry();
    const readyPath = writeScopeFile(scopeKey, "ready-to-merge.md", "ready v1\n");

    const first = registry.publish({
      scopeKey,
      runId: "run-1",
      flowId: "review-flow",
      phaseId: "finalize",
      stepId: "mark_ready",
      nodeKind: "clear-ready-to-merge",
      nodeVersion: 1,
      kind: "artifact",
      payloadPath: readyPath,
      inputs: [],
    });
    const duplicate = registry.publish({
      scopeKey,
      runId: "run-1",
      flowId: "review-flow",
      phaseId: "finalize",
      stepId: "mark_ready",
      nodeKind: "clear-ready-to-merge",
      nodeVersion: 1,
      kind: "artifact",
      payloadPath: readyPath,
      inputs: [],
    });

    assert.equal(first.version, 1);
    assert.equal(duplicate.artifact_id, first.artifact_id);

    writeFileSync(readyPath, "ready v2\n", "utf8");
    const second = registry.publish({
      scopeKey,
      runId: "run-2",
      flowId: "review-flow",
      phaseId: "finalize",
      stepId: "mark_ready_again",
      nodeKind: "clear-ready-to-merge",
      nodeVersion: 1,
      kind: "artifact",
      payloadPath: readyPath,
      inputs: [],
    });
    writeFileSync(artifactManifestSidecarPath(readyPath), `${JSON.stringify(first.manifest, null, 2)}\n`, "utf8");

    const records = registry.listScopeArtifacts(scopeKey);
    const recovered = registry.loadManifestByPayloadPath(readyPath);
    const latest = records.find((record) => record.artifact_id === second.artifact_id);
    const previous = records.find((record) => record.artifact_id === first.artifact_id);

    assert.equal(second.version, 2);
    assert.equal(second.manifest.supersedes, first.artifact_id);
    assert.equal(recovered?.artifact_id, second.artifact_id);
    assert.equal(latest?.status, "ready");
    assert.equal(previous?.status, "superseded");
    assert.match(second.manifest.content_hash, /^sha256:[a-f0-9]{64}$/);

    const indexPath = artifactIndexFile(scopeKey);
    assert.equal(existsSync(indexPath), true);
    writeFileSync(indexPath, "{broken\n", "utf8");
    const rebuilt = registry.rebuildIndex(scopeKey);
    assert.equal(rebuilt.length, 2);

    const parsedIndex = JSON.parse(readFileSync(indexPath, "utf8"));
    assert.equal(parsedIndex.records.length, 2);
  });

  it("keeps versioned filenames in one logical stream", () => {
    const scopeKey = "ag-78@test";
    const registry = createArtifactRegistry();
    const firstPath = writeScopeFile(scopeKey, ".artifacts/plan-ag-78@test-1.json", "{\n  \"summary\": \"one\"\n}\n");
    const secondPath = writeScopeFile(scopeKey, ".artifacts/plan-ag-78@test-2.json", "{\n  \"summary\": \"two\"\n}\n");

    const first = registry.publish({
      scopeKey,
      runId: "run-1",
      flowId: "plan-flow",
      phaseId: "plan",
      stepId: "write_plan",
      nodeKind: "codex-prompt",
      nodeVersion: 1,
      kind: "artifact",
      payloadPath: firstPath,
      inputs: [],
    });
    const second = registry.publish({
      scopeKey,
      runId: "run-2",
      flowId: "plan-flow",
      phaseId: "plan",
      stepId: "write_plan_again",
      nodeKind: "codex-prompt",
      nodeVersion: 1,
      kind: "artifact",
      payloadPath: secondPath,
      inputs: [],
    });

    assert.equal(first.logical_key, second.logical_key);
    assert.equal(first.version, 1);
    assert.equal(second.version, 2);
  });

  it("creates a new version when the same run resumes with a new publication run id", () => {
    const scopeKey = "ag-78b@test";
    const registry = createArtifactRegistry();
    const outputPath = writeScopeFile(scopeKey, "ready-to-merge.md", "ready v1\n");

    const first = registry.publish({
      scopeKey,
      runId: "run-1",
      publicationRunId: "attempt-1",
      flowId: "review-flow",
      phaseId: "finalize",
      stepId: "mark_ready",
      nodeKind: "seed-node",
      nodeVersion: 1,
      kind: "artifact",
      payloadPath: outputPath,
      inputs: [],
    });
    const duplicate = registry.publish({
      scopeKey,
      runId: "run-1",
      publicationRunId: "attempt-1",
      flowId: "review-flow",
      phaseId: "finalize",
      stepId: "mark_ready",
      nodeKind: "seed-node",
      nodeVersion: 1,
      kind: "artifact",
      payloadPath: outputPath,
      inputs: [],
    });

    writeFileSync(outputPath, "ready v2\n", "utf8");
    const resumed = registry.publish({
      scopeKey,
      runId: "run-1",
      publicationRunId: "attempt-2",
      flowId: "review-flow",
      phaseId: "finalize",
      stepId: "mark_ready",
      nodeKind: "seed-node",
      nodeVersion: 1,
      kind: "artifact",
      payloadPath: outputPath,
      inputs: [],
    });

    assert.equal(duplicate.artifact_id, first.artifact_id);
    assert.equal(resumed.version, 2);
    assert.equal(resumed.manifest.supersedes, first.artifact_id);
    assert.notEqual(resumed.manifest.publication_key, first.manifest.publication_key);
  });
});

describe("runner publication", () => {
  it("publishes multiple outputs without stream collisions", async () => {
    const scopeKey = "ag-79@test";
    const designMd = path.join(scopeWorkspaceDir(scopeKey), `design-${scopeKey}-1.md`);
    const designJson = path.join(scopeWorkspaceDir(scopeKey), ".artifacts", `design-${scopeKey}-1.json`);
    const nodes = {
      "publish-two": {
        kind: "publish-two",
        version: 1,
        async run() {
          mkdirSync(path.dirname(designMd), { recursive: true });
          mkdirSync(path.dirname(designJson), { recursive: true });
          writeFileSync(designMd, "# Design\n", "utf8");
          writeFileSync(designJson, "{\n  \"summary\": \"Design\"\n}\n", "utf8");
          return {
            value: { ok: true },
            outputs: [
              { kind: "artifact", path: designMd, required: true, manifest: { publish: true } },
              { kind: "artifact", path: designJson, required: true, manifest: { publish: true } },
            ],
          };
        },
      },
    };
    const context = createContext(scopeKey, nodes);

    await runExpandedPhase(
      {
        id: "publish",
        repeatVars: {},
        steps: [{ id: "write_pair", node: "publish-two", repeatVars: {} }],
      },
      context,
      { taskKey: scopeKey },
      {},
    );

    const records = context.runtime.artifactRegistry.listScopeArtifacts(scopeKey);
    assert.equal(records.length, 2);
    assert.notEqual(records[0].logical_key, records[1].logical_key);
    assert.equal(records[0].version, 1);
    assert.equal(records[1].version, 1);
  });

  it("publishes only after checks pass and skips sidecars during dry-run", async () => {
    const scopeKey = "ag-80@test";
    const node = {
      kind: "single-output",
      version: 1,
      async run(_context, params) {
        mkdirSync(path.dirname(params.outputPath), { recursive: true });
        writeFileSync(params.outputPath, "# Result\n", "utf8");
        return {
          value: { ok: true },
          outputs: [{ kind: "artifact", path: params.outputPath, required: true }],
        };
      },
    };
    const outputPath = path.join(scopeWorkspaceDir(scopeKey), "result.md");

    const failingContext = createContext(scopeKey, { "single-output": node });
    await assert.rejects(
      () =>
        runExpandedPhase(
          {
            id: "publish",
            repeatVars: {},
            steps: [
              {
                id: "fail_checks",
                node: "single-output",
                repeatVars: {},
                params: {
                  outputPath: { const: outputPath },
                },
                expect: [
                  {
                    kind: "require-file",
                    path: { const: path.join(scopeWorkspaceDir(scopeKey), "missing.md") },
                    message: "missing output",
                  },
                ],
              },
            ],
          },
          failingContext,
          { taskKey: scopeKey },
          {},
        ),
      /missing output/,
    );
    assert.equal(failingContext.runtime.artifactRegistry.listScopeArtifacts(scopeKey).length, 0);

    const dryContext = createContext("ag-81@test", { "single-output": node }, { dryRun: true });
    const dryOutputPath = path.join(scopeWorkspaceDir("ag-81@test"), "result.md");
    await runExpandedPhase(
      {
        id: "publish",
        repeatVars: {},
        steps: [
          {
            id: "dry_run_step",
            node: "single-output",
            repeatVars: {},
            params: {
              outputPath: { const: dryOutputPath },
            },
          },
        ],
      },
      dryContext,
      { taskKey: "ag-81@test" },
      {},
    );
    assert.equal(dryContext.runtime.artifactRegistry.listScopeArtifacts("ag-81@test").length, 0);
    assert.equal(existsSync(artifactIndexFile("ag-81@test")), false);
  });

  it("captures contract artifacts, requires explicit legacy opt-ins, and ignores incidental paths", async () => {
    const scopeKey = "ag-82@test";
    const runtime = createRuntime();
    const inputWithManifest = planJsonFile(scopeKey, 1);
    const legacyInput = writeScopeFile(scopeKey, "legacy.txt", "legacy\n");
    const incidentalInput = writeScopeFile(scopeKey, "incidental.txt", "incidental\n");
    mkdirSync(path.dirname(inputWithManifest), { recursive: true });
    writeFileSync(inputWithManifest, "{\n  \"summary\": \"plan\"\n}\n", "utf8");
    runtime.artifactRegistry.publish({
      scopeKey,
      runId: "seed-run",
      flowId: "seed",
      phaseId: "seed",
      stepId: "seed",
      nodeKind: "seed-node",
      nodeVersion: 1,
      kind: "artifact",
      payloadPath: inputWithManifest,
      logicalKey: "artifacts/plan.json",
      schemaId: "helper-json/v1",
      schemaVersion: 1,
      payloadFamily: "helper-json",
      inputs: [],
    });

    const outputPath = path.join(scopeWorkspaceDir(scopeKey), ".artifacts", "jira-output.json");
    const nodes = {
      "file-output": {
        kind: "file-output",
        version: 1,
        async run(_context, params) {
          mkdirSync(path.dirname(outputPath), { recursive: true });
          writeFileSync(outputPath, "{\n  \"summary\": \"jira\"\n}\n", "utf8");
          return {
            value: {
              legacyFile: params.legacyFile,
              incidentalFile: params.incidentalFile,
            },
            outputs: [
              {
                kind: "file",
                path: outputPath,
                required: true,
                manifest: {
                  publish: true,
                  logicalKey: "artifacts/jira-task.json",
                  schemaId: "helper-json/v1",
                  schemaVersion: 1,
                  payloadFamily: "helper-json",
                  inputRefs: [{ source: "external-path", path: params.legacyFile }],
                },
              },
            ],
          };
        },
      },
    };
    const context = createContext(scopeKey, nodes, { runtime });

    await runExpandedPhase(
      {
        id: "publish",
        repeatVars: {},
        steps: [
          {
            id: "write_file_output",
            node: "file-output",
            repeatVars: {},
            params: {
              legacyFile: { const: legacyInput },
              incidentalFile: { const: incidentalInput },
            },
            prompt: {
              inlineTemplate: "Use {sourceFile}, {legacyFile}, and {incidentalFile}.",
              vars: {
                sourceFile: {
                  artifact: {
                    kind: "plan-json-file",
                    taskKey: { const: scopeKey },
                    iteration: { const: 1 },
                  },
                },
                legacyFile: { const: legacyInput },
                incidentalFile: { const: incidentalInput },
              },
            },
          },
        ],
      },
      context,
      { taskKey: scopeKey },
      {},
    );

    const manifest = context.runtime.artifactRegistry.loadManifestByPayloadPath(outputPath);
    assert.ok(manifest);
    assert.equal(manifest.kind, "file");
    assert.equal(manifest.inputs.some((item) => item.source === "manifest" && item.path === inputWithManifest), true);
    assert.equal(manifest.inputs.some((item) => item.source === "external-path" && item.path === legacyInput), true);
    assert.equal(manifest.inputs.some((item) => item.path === incidentalInput), false);
  });

  it("preserves child publications through nested flow execution", async () => {
    const scopeKey = "ag-83@test";
    const markdownPath = writeScopeFile(scopeKey, "child-source.md", "# Child\n\nNested flow output.\n");
    const outputPath = path.join(scopeWorkspaceDir(scopeKey), ".artifacts", `child-summary-${scopeKey}-1.json`);
    const nestedNode = {
      kind: "nested-run",
      version: 1,
      async run(context) {
        const nestedExecutionState = {
          flowKind: "child-flow",
          flowVersion: 1,
          terminated: false,
          terminationOutcome: "success",
          phases: [],
        };
        const nestedResult = await runExpandedPhase(
          {
            id: "publish_child",
            repeatVars: {},
            steps: [
              {
                id: "ensure_json",
                node: "ensure-summary-json",
                repeatVars: {},
                params: {
                  markdownFile: { const: markdownPath },
                  outputFile: { const: outputPath },
                },
              },
            ],
          },
          context,
          { taskKey: scopeKey },
          {},
          { executionState: nestedExecutionState, flowKind: "child-flow", flowVersion: 1 },
        );
        return {
          value: {
            flowKind: "child-flow",
            flowVersion: 1,
            executionState: nestedExecutionState,
            publishedArtifacts: nestedResult.steps.flatMap((step) => step.publishedArtifacts ?? []),
          },
        };
      },
    };

    const context = createContext(scopeKey, {
      "nested-run": nestedNode,
      "ensure-summary-json": ensureSummaryJsonNode,
    });

    const result = await runExpandedPhase(
      {
        id: "parent",
        repeatVars: {},
        steps: [
          {
            id: "run_child",
            node: "nested-run",
            repeatVars: {},
          },
        ],
      },
      context,
      { taskKey: scopeKey },
      {},
    );

    const records = context.runtime.artifactRegistry.listScopeArtifacts(scopeKey);
    assert.equal(records.length, 1);
    const parentStepValue = result.executionState.phases[0].steps[0].value;
    assert.ok(parentStepValue && Array.isArray(parentStepValue.publishedArtifacts));
    assert.equal(parentStepValue.publishedArtifacts.length, 1);
    assert.equal(parentStepValue.publishedArtifacts[0].artifact_id, records[0].artifact_id);
  });

  it("propagates publications through recursive nested runner aggregation", async () => {
    const scopeKey = "ag-84@test";
    const markdownPath = writeScopeFile(scopeKey, "grandchild-source.md", "# Grandchild\n\nNested flow output.\n");
    const outputPath = path.join(scopeWorkspaceDir(scopeKey), ".artifacts", `grandchild-summary-${scopeKey}-1.json`);
    const innerNode = {
      kind: "inner-run",
      version: 1,
      async run(context) {
        const innerExecutionState = {
          flowKind: "inner-flow",
          flowVersion: 1,
          terminated: false,
          terminationOutcome: "success",
          phases: [],
        };
        const innerResult = await runExpandedPhase(
          {
            id: "publish_grandchild",
            repeatVars: {},
            steps: [
              {
                id: "ensure_json",
                node: "ensure-summary-json",
                repeatVars: {},
                params: {
                  markdownFile: { const: markdownPath },
                  outputFile: { const: outputPath },
                },
              },
            ],
          },
          context,
          { taskKey: scopeKey },
          {},
          { executionState: innerExecutionState, flowKind: "inner-flow", flowVersion: 1 },
        );
        return {
          value: {
            flowKind: "inner-flow",
            flowVersion: 1,
            executionState: innerExecutionState,
            publishedArtifacts: innerResult.steps.flatMap((step) => step.publishedArtifacts ?? []),
          },
        };
      },
    };
    const middleNode = {
      kind: "middle-run",
      version: 1,
      async run(context) {
        const middleExecutionState = {
          flowKind: "middle-flow",
          flowVersion: 1,
          terminated: false,
          terminationOutcome: "success",
          phases: [],
        };
        const middleResult = await runExpandedPhase(
          {
            id: "call_inner",
            repeatVars: {},
            steps: [
              {
                id: "run_inner",
                node: "inner-run",
                repeatVars: {},
              },
            ],
          },
          context,
          { taskKey: scopeKey },
          {},
          { executionState: middleExecutionState, flowKind: "middle-flow", flowVersion: 1 },
        );
        return {
          value: {
            flowKind: "middle-flow",
            flowVersion: 1,
            executionState: middleExecutionState,
            publishedArtifacts: middleResult.steps.flatMap((step) => step.publishedArtifacts ?? []),
          },
        };
      },
    };

    const context = createContext(scopeKey, {
      "ensure-summary-json": ensureSummaryJsonNode,
      "inner-run": innerNode,
      "middle-run": middleNode,
    });

    const result = await runExpandedPhase(
      {
        id: "parent",
        repeatVars: {},
        steps: [
          {
            id: "run_middle",
            node: "middle-run",
            repeatVars: {},
          },
        ],
      },
      context,
      { taskKey: scopeKey },
      {},
    );

    const records = context.runtime.artifactRegistry.listScopeArtifacts(scopeKey);
    assert.equal(records.length, 1);
    assert.equal(records[0].logical_key, "artifacts/grandchild-summary.json");

    const parentStepValue = result.executionState.phases[0].steps[0].value;
    assert.ok(parentStepValue && Array.isArray(parentStepValue.publishedArtifacts));
    assert.equal(parentStepValue.publishedArtifacts.length, 1);
    assert.equal(parentStepValue.publishedArtifacts[0].artifact_id, records[0].artifact_id);
  });

  it("excludes the currently published output from its own lineage inputs", async () => {
    const scopeKey = "ag-85@test";
    const inputPath = writeScopeFile(scopeKey, "source.md", "# Source\n\nUpstream content.\n");
    const outputPath = path.join(scopeWorkspaceDir(scopeKey), ".artifacts", `summary-${scopeKey}-1.json`);
    const nodes = {
      "self-referential-output": {
        kind: "self-referential-output",
        version: 1,
        async run(_context, params) {
          mkdirSync(path.dirname(params.outputFile), { recursive: true });
          writeFileSync(outputPath, "{\n  \"summary\": \"derived\"\n}\n", "utf8");
          return {
            value: {
              inputFile: params.inputFile,
              outputFile: params.outputFile,
            },
            outputs: [
              {
                kind: "artifact",
                path: params.outputFile,
                required: true,
                manifest: {
                  publish: true,
                  inputRefs: [{ source: "external-path", path: params.inputFile }],
                },
              },
            ],
          };
        },
      },
    };
    const context = createContext(scopeKey, nodes);

    await runExpandedPhase(
      {
        id: "publish",
        repeatVars: {},
        steps: [
          {
            id: "write_summary",
            node: "self-referential-output",
            repeatVars: {},
            params: {
              inputFile: { const: inputPath },
              outputFile: { const: outputPath },
            },
          },
        ],
      },
      context,
      { taskKey: scopeKey },
      {},
    );

    const manifest = context.runtime.artifactRegistry.loadManifestByPayloadPath(outputPath);
    assert.ok(manifest);
    assert.equal(manifest.inputs.some((item) => item.path === inputPath), true);
    assert.equal(manifest.inputs.some((item) => item.path === outputPath), false);
  });

  it("fails fast when one step resolves duplicate logical keys for different outputs", async () => {
    const scopeKey = "ag-85b@test";
    const firstPath = path.join(scopeWorkspaceDir(scopeKey), ".artifacts", "first.json");
    const secondPath = path.join(scopeWorkspaceDir(scopeKey), ".artifacts", "second.json");
    const nodes = {
      "duplicate-logical-key": {
        kind: "duplicate-logical-key",
        version: 1,
        async run() {
          mkdirSync(path.dirname(firstPath), { recursive: true });
          writeFileSync(firstPath, "{\n  \"summary\": \"first\"\n}\n", "utf8");
          writeFileSync(secondPath, "{\n  \"summary\": \"second\"\n}\n", "utf8");
          return {
            value: { ok: true },
            outputs: [
              {
                kind: "artifact",
                path: firstPath,
                required: true,
                manifest: { publish: true, logicalKey: "artifacts/collision.json" },
              },
              {
                kind: "artifact",
                path: secondPath,
                required: true,
                manifest: { publish: true, logicalKey: "artifacts/collision.json" },
              },
            ],
          };
        },
      },
    };
    const context = createContext(scopeKey, nodes);

    await assert.rejects(
      () =>
        runExpandedPhase(
          {
            id: "publish",
            repeatVars: {},
            steps: [{ id: "write_pair", node: "duplicate-logical-key", repeatVars: {} }],
          },
          context,
          { taskKey: scopeKey },
          {},
        ),
      /duplicate logical_key/,
    );
    assert.equal(context.runtime.artifactRegistry.listScopeArtifacts(scopeKey).length, 0);
  });

  it("keeps manifest-backed lineage for cross-scope contract inputs when a manifest exists", async () => {
    const scopeKey = "ag-85c@test";
    const upstreamScopeKey = "ag-upstream@test";
    const runtime = createRuntime();
    const upstreamInput = planJsonFile(upstreamScopeKey, 1);
    mkdirSync(path.dirname(upstreamInput), { recursive: true });
    writeFileSync(upstreamInput, "{\n  \"summary\": \"upstream\"\n}\n", "utf8");
    runtime.artifactRegistry.publish({
      scopeKey: upstreamScopeKey,
      runId: "seed-run",
      flowId: "seed",
      phaseId: "seed",
      stepId: "seed",
      nodeKind: "seed-node",
      nodeVersion: 1,
      kind: "artifact",
      payloadPath: upstreamInput,
      logicalKey: "artifacts/plan.json",
      schemaId: "helper-json/v1",
      schemaVersion: 1,
      payloadFamily: "helper-json",
      inputs: [],
    });

    const outputPath = path.join(scopeWorkspaceDir(scopeKey), ".artifacts", "summary.json");
    const nodes = {
      "cross-scope-lineage": {
        kind: "cross-scope-lineage",
        version: 1,
        async run(_context, params) {
          mkdirSync(path.dirname(outputPath), { recursive: true });
          writeFileSync(outputPath, "{\n  \"summary\": \"derived\"\n}\n", "utf8");
          return {
            value: { upstreamInput: params.upstreamInput },
            outputs: [{ kind: "artifact", path: outputPath, required: true, manifest: { publish: true } }],
          };
        },
      },
    };
    const context = createContext(scopeKey, nodes, { runtime });

    await runExpandedPhase(
      {
        id: "publish",
        repeatVars: {},
        steps: [
          {
            id: "write_summary",
            node: "cross-scope-lineage",
            repeatVars: {},
            params: {
              upstreamInput: {
                artifact: {
                  kind: "plan-json-file",
                  taskKey: { const: upstreamScopeKey },
                  iteration: { const: 1 },
                },
              },
            },
          },
        ],
      },
      context,
      { taskKey: scopeKey },
      {},
    );

    const manifest = context.runtime.artifactRegistry.loadManifestByPayloadPath(outputPath);
    assert.ok(manifest);
    assert.equal(manifest.inputs.some((item) => item.source === "manifest" && item.path === upstreamInput), true);
  });

  it("captures manifest-backed params refs only when the flow annotates them as contract lineage inputs", async () => {
    const scopeKey = "ag-85e@test";
    const runtime = createRuntime();
    const contractInput = planJsonFile(scopeKey, 1);
    const incidentalInput = writeScopeFile(scopeKey, "incidental.txt", "incidental\n");
    mkdirSync(path.dirname(contractInput), { recursive: true });
    writeFileSync(contractInput, "{\n  \"summary\": \"contract\"\n}\n", "utf8");
    runtime.artifactRegistry.publish({
      scopeKey,
      runId: "seed-run",
      flowId: "seed",
      phaseId: "seed",
      stepId: "seed",
      nodeKind: "seed-node",
      nodeVersion: 1,
      kind: "artifact",
      payloadPath: contractInput,
      logicalKey: "artifacts/plan.json",
      schemaId: "helper-json/v1",
      schemaVersion: 1,
      payloadFamily: "helper-json",
      inputs: [],
    });

    const outputPath = path.join(scopeWorkspaceDir(scopeKey), ".artifacts", "params-ref-summary.json");
    const nodes = {
      "params-ref-lineage": {
        kind: "params-ref-lineage",
        version: 1,
        async run() {
          mkdirSync(path.dirname(outputPath), { recursive: true });
          writeFileSync(outputPath, "{\n  \"summary\": \"derived\"\n}\n", "utf8");
          return {
            value: { ok: true },
            outputs: [{ kind: "artifact", path: outputPath, required: true, manifest: { publish: true } }],
          };
        },
      },
    };
    const context = createContext(scopeKey, nodes, { runtime });

    await runExpandedPhase(
      {
        id: "publish",
        repeatVars: {},
        steps: [
          {
            id: "write_summary",
            node: "params-ref-lineage",
            repeatVars: {},
            prompt: {
              inlineTemplate: "Use {contractFile} but ignore {incidentalFile}.",
              vars: {
                contractFile: { ref: "params.contractFile" },
                incidentalFile: { ref: "params.incidentalFile" },
              },
            },
          },
        ],
      },
      context,
      {
        taskKey: scopeKey,
        contractFile: contractInput,
        incidentalFile: incidentalInput,
        [ARTIFACT_LINEAGE_REF_PATHS_PARAM]: {
          "params.contractFile": contractInput,
        },
      },
      {},
    );

    const manifest = context.runtime.artifactRegistry.loadManifestByPayloadPath(outputPath);
    assert.ok(manifest);
    assert.equal(manifest.inputs.some((item) => item.source === "manifest" && item.path === contractInput), true);
    assert.equal(manifest.inputs.some((item) => item.path === incidentalInput), false);
  });

  it("requires explicit manifest opt-in before publishing artifact outputs", async () => {
    const scopeKey = "ag-85d@test";
    const outputPath = path.join(scopeWorkspaceDir(scopeKey), ".artifacts", "legacy.json");
    const nodes = {
      "legacy-output": {
        kind: "legacy-output",
        version: 1,
        async run() {
          mkdirSync(path.dirname(outputPath), { recursive: true });
          writeFileSync(outputPath, "{\n  \"summary\": \"legacy\"\n}\n", "utf8");
          return {
            value: { ok: true },
            outputs: [{ kind: "artifact", path: outputPath, required: true }],
          };
        },
      },
    };
    const context = createContext(scopeKey, nodes);

    await runExpandedPhase(
      {
        id: "publish",
        repeatVars: {},
        steps: [{ id: "write_legacy", node: "legacy-output", repeatVars: {} }],
      },
      context,
      { taskKey: scopeKey },
      {},
    );

    assert.equal(context.runtime.artifactRegistry.listScopeArtifacts(scopeKey).length, 0);
  });

  it("computes diagnostics for non-structured payload-family contracts", () => {
    const scopeKey = "ag-86@test";
    const registry = createArtifactRegistry();
    const helperJsonPath = writeScopeFile(scopeKey, ".artifacts/broken-helper.json", "{broken\n");
    const plainTextPath = writeScopeFile(scopeKey, "empty.txt", "");
    const markdownPath = writeScopeFile(scopeKey, "notes.md", "# Notes\n");
    const opaquePath = path.join(scopeWorkspaceDir(scopeKey), "blob.bin");
    mkdirSync(path.dirname(opaquePath), { recursive: true });
    writeFileSync(opaquePath, Buffer.from([0xde, 0xad, 0xbe, 0xef]));

    registry.publish({
      scopeKey,
      runId: "run-1",
      flowId: "review-flow",
      phaseId: "publish",
      stepId: "helper_json",
      nodeKind: "seed-node",
      nodeVersion: 1,
      kind: "artifact",
      payloadPath: helperJsonPath,
      logicalKey: "artifacts/helper.json",
      schemaId: "helper-json/v1",
      schemaVersion: 1,
      payloadFamily: "helper-json",
      inputs: [],
    });
    registry.publish({
      scopeKey,
      runId: "run-1",
      flowId: "review-flow",
      phaseId: "publish",
      stepId: "plain_text",
      nodeKind: "seed-node",
      nodeVersion: 1,
      kind: "artifact",
      payloadPath: plainTextPath,
      logicalKey: "empty.txt",
      schemaId: "plain-text/v1",
      schemaVersion: 1,
      payloadFamily: "plain-text",
      inputs: [],
    });
    registry.publish({
      scopeKey,
      runId: "run-1",
      flowId: "review-flow",
      phaseId: "publish",
      stepId: "markdown",
      nodeKind: "seed-node",
      nodeVersion: 1,
      kind: "artifact",
      payloadPath: markdownPath,
      logicalKey: "notes.md",
      schemaId: "markdown/v1",
      schemaVersion: 1,
      payloadFamily: "markdown",
      inputs: [],
    });
    registry.publish({
      scopeKey,
      runId: "run-1",
      flowId: "review-flow",
      phaseId: "publish",
      stepId: "opaque",
      nodeKind: "seed-node",
      nodeVersion: 1,
      kind: "artifact",
      payloadPath: opaquePath,
      logicalKey: "blob.bin",
      schemaId: "opaque-file/v1",
      schemaVersion: 1,
      payloadFamily: "opaque-file",
      inputs: [],
    });

    const records = registry.listScopeArtifacts(scopeKey);
    const helperJson = records.find((record) => record.logical_key === "artifacts/helper.json");
    const plainText = records.find((record) => record.logical_key === "empty.txt");
    const markdown = records.find((record) => record.logical_key === "notes.md");
    const opaqueFile = records.find((record) => record.logical_key === "blob.bin");

    assert.ok(helperJson?.manifest.diagnostics);
    assert.equal(helperJson.manifest.diagnostics[0]?.code, "invalid-schema");
    assert.match(helperJson.manifest.diagnostics[0]?.message ?? "", /not valid JSON/);

    assert.ok(plainText?.manifest.diagnostics);
    assert.equal(plainText.manifest.diagnostics[0]?.code, "invalid-schema");
    assert.match(plainText.manifest.diagnostics[0]?.message ?? "", /non-empty string/);

    assert.deepEqual(markdown?.manifest.diagnostics ?? [], []);
    assert.deepEqual(opaqueFile?.manifest.diagnostics ?? [], []);
  });

  it("publishes review-fix selection inputs with explicit user-input manifest metadata", async () => {
    const scopeKey = "ag-87@test";
    const outputPath = path.join(scopeWorkspaceDir(scopeKey), ".artifacts", `review-fix-selection-${scopeKey}-iter-1.json`);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    const context = createContext(
      scopeKey,
      {
        "user-input": userInputNode,
      },
      {
        requestUserInput: async () => ({
          formId: "review-fix-selection",
          submittedAt: "2026-04-18T18:38:39.626Z",
          values: {
            apply_all: true,
            selected_findings: [],
            extra_notes: "",
          },
        }),
      },
    );

    await runExpandedPhase(
      {
        id: "collect",
        repeatVars: {},
        steps: [
          {
            id: "review_fix_selection",
            node: "user-input",
            repeatVars: {},
            params: {
              formId: { const: "review-fix-selection" },
              title: { const: "Review-Fix Selection" },
              fields: {
                const: [
                  {
                    id: "apply_all",
                    type: "boolean",
                    label: "Apply all",
                    default: true,
                  },
                  {
                    id: "selected_findings",
                    type: "multi-select",
                    label: "Selected findings",
                    options: [],
                    default: [],
                  },
                  {
                    id: "extra_notes",
                    type: "text",
                    label: "Extra notes",
                    default: "",
                  },
                ],
              },
              outputFile: { const: outputPath },
            },
          },
        ],
      },
      context,
      { taskKey: scopeKey },
      {},
    );

    const records = context.runtime.artifactRegistry.listScopeArtifacts(scopeKey);
    assert.equal(records.length, 1);
    assert.equal(records[0].schema_id, "user-input/v1");
    assert.equal(records[0].logical_key, "artifacts/review-fix-selection.json");
  });
});
