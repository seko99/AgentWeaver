import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const distRoot = path.resolve(process.cwd(), "dist");
const packageJson = JSON.parse(readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"));

let tempRoot;
let originalCwd;
let originalHome;
let pluginLoaderModule;
let declarativeFlowsModule;
let contextModule;
let nodeRunnerModule;
let flowCatalogModule;
let declarativeFlowRunnerModule;
let artifactRegistryModule;
let claudeExampleModule;

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writePlugin(repoDir, directoryName, manifest, entrySource) {
  const pluginRoot = path.join(repoDir, ".agentweaver", ".plugins", directoryName);
  mkdirSync(pluginRoot, { recursive: true });
  writeJson(path.join(pluginRoot, "plugin.json"), manifest);
  writeFileSync(path.join(pluginRoot, manifest.entrypoint), entrySource, "utf8");
}

function writeProjectFlow(repoDir, relativeFilePath, nodeId) {
  writeJson(path.join(repoDir, ".agentweaver", ".flows", relativeFilePath), {
    kind: "plugin-flow",
    version: 1,
    phases: [
      {
        id: "plugin-phase",
        steps: [
          {
            id: "plugin-step",
            node: nodeId,
            params: {
              message: { const: "hello from plugin" },
            },
          },
        ],
      },
    ],
  });
}

function installLocalAgentWeaverPackage(repoDir) {
  const nodeModulesDir = path.join(repoDir, "node_modules");
  mkdirSync(nodeModulesDir, { recursive: true });
  symlinkSync(repoRoot, path.join(nodeModulesDir, "agentweaver"), "dir");
}

function copyClaudeExample(repoDir) {
  installLocalAgentWeaverPackage(repoDir);
  cpSync(
    path.join(repoRoot, "docs", "examples", ".plugins", "claude-example-plugin"),
    path.join(repoDir, ".agentweaver", ".plugins", "claude-example-plugin"),
    { recursive: true },
  );
  cpSync(
    path.join(repoRoot, "docs", "examples", ".flows", "claude-example.json"),
    path.join(repoDir, ".agentweaver", ".flows", "examples", "claude-example.json"),
  );
}

beforeEach(async () => {
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  tempRoot = mkdtempSync(path.join(os.tmpdir(), "agentweaver-plugin-loader-"));
  process.env.HOME = tempRoot;
  pluginLoaderModule = await import(`${pathToFileURL(path.join(distRoot, "pipeline/plugin-loader.js")).href}?loader=${Date.now()}`);
  declarativeFlowsModule = await import(`${pathToFileURL(path.join(distRoot, "pipeline/declarative-flows.js")).href}?flows=${Date.now()}`);
  contextModule = await import(`${pathToFileURL(path.join(distRoot, "pipeline/context.js")).href}?context=${Date.now()}`);
  nodeRunnerModule = await import(`${pathToFileURL(path.join(distRoot, "pipeline/node-runner.js")).href}?runner=${Date.now()}`);
  flowCatalogModule = await import(`${pathToFileURL(path.join(distRoot, "pipeline/flow-catalog.js")).href}?catalog=${Date.now()}`);
  declarativeFlowRunnerModule = await import(`${pathToFileURL(path.join(distRoot, "pipeline/declarative-flow-runner.js")).href}?phase=${Date.now()}`);
  artifactRegistryModule = await import(`${pathToFileURL(path.join(distRoot, "runtime/artifact-registry.js")).href}?artifact=${Date.now()}`);
  claudeExampleModule = await import(
    `${pathToFileURL(path.join(repoRoot, "docs", "examples", ".plugins", "claude-example-plugin", "index.js")).href}?claude=${Date.now()}`
  );
});

afterEach(() => {
  process.chdir(originalCwd);
  process.env.HOME = originalHome;
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("plugin loader", () => {
  it("exports the public plugin SDK subpath in package metadata", () => {
    assert.equal(packageJson.exports["./plugin-sdk"], "./dist/plugin-sdk.js");
  });

  it("loads executor-only and node-only plugins into one merged registry and executes plugin nodes", async () => {
    const repoDir = path.join(tempRoot, "repo-valid");
    mkdirSync(repoDir, { recursive: true });
    process.chdir(repoDir);

    writePlugin(repoDir, "executor-plugin", {
      id: "executor-plugin",
      sdk_version: 1,
      entrypoint: "index.js",
    }, `
export const executors = [
  {
    id: "test-executor",
    definition: {
      kind: "test-executor",
      version: 1,
      defaultConfig: { prefix: "plugin:" },
      async execute(_context, input, config) {
        return \`\${config.prefix}\${String(input.message)}\`;
      }
    }
  }
];
`);
    writePlugin(repoDir, "node-plugin", {
      id: "node-plugin",
      sdk_version: 1,
      entrypoint: "index.js",
    }, `
export const nodes = [
  {
    id: "test-node",
    definition: {
      kind: "test-node",
      version: 1,
      async run(context, params) {
        const executor = context.executors.get("test-executor");
        const value = await executor.execute(context, { message: params.message }, executor.defaultConfig);
        return { value: { echoed: value } };
      }
    },
    metadata: {
      kind: "test-node",
      version: 1,
      prompt: "forbidden",
      requiredParams: ["message"],
      executors: ["test-executor"]
    }
  }
];
`);
    writeProjectFlow(repoDir, "plugin-flow.json", "test-node");

    const registryContext = await pluginLoaderModule.createPipelineRegistryContext(repoDir);
    assert.equal(registryContext.executors.has("test-executor"), true);
    assert.equal(registryContext.nodes.has("test-node"), true);

    const builtInContext = pluginLoaderModule.createBuiltInRegistryContext(repoDir);
    await assert.rejects(
      () => declarativeFlowsModule.loadDeclarativeFlow(
        { source: "project-local", filePath: path.join(repoDir, ".agentweaver", ".flows", "plugin-flow.json") },
        { cwd: repoDir, registryContext: builtInContext },
      ),
      /Unknown node kind 'test-node'/,
    );

    const flow = await declarativeFlowsModule.loadDeclarativeFlow(
      { source: "project-local", filePath: path.join(repoDir, ".agentweaver", ".flows", "plugin-flow.json") },
      { cwd: repoDir, registryContext },
    );
    assert.equal(flow.kind, "plugin-flow");

    const pipelineContext = await contextModule.createPipelineContext({
      issueKey: "PLUGIN-1",
      jiraRef: "PLUGIN-1",
      dryRun: true,
      verbose: false,
      runtime: {
        resolveCmd(commandName) {
          return commandName;
        },
        async runCommand() {
          return "";
        },
        artifactRegistry: {
          publish() {
            throw new Error("not used");
          },
        },
      },
      registryContext,
    });
    const result = await nodeRunnerModule.runNodeByKind("test-node", pipelineContext, {
      message: "hello from plugin",
    });
    assert.deepEqual(result.value, {
      echoed: "plugin:hello from plugin",
    });
  });

  it("rejects default-export-only plugin modules", async () => {
    const repoDir = path.join(tempRoot, "repo-default-export");
    mkdirSync(repoDir, { recursive: true });
    process.chdir(repoDir);

    writePlugin(repoDir, "default-export-plugin", {
      id: "default-export-plugin",
      sdk_version: 1,
      entrypoint: "index.js",
    }, `export default { executors: [] };`);

    await assert.rejects(
      () => pluginLoaderModule.createPipelineRegistryContext(repoDir),
      /named exports only; default exports are not supported/,
    );
  });

  it("rejects unresolved plugin executor dependencies before flow loading", async () => {
    const repoDir = path.join(tempRoot, "repo-missing-executor");
    mkdirSync(repoDir, { recursive: true });
    process.chdir(repoDir);

    writePlugin(repoDir, "missing-executor-plugin", {
      id: "missing-executor-plugin",
      sdk_version: 1,
      entrypoint: "index.js",
    }, `
export const nodes = [
  {
    id: "missing-executor-node",
    definition: {
      kind: "missing-executor-node",
      version: 1,
      async run() {
        return { value: null };
      }
    },
    metadata: {
      kind: "missing-executor-node",
      version: 1,
      prompt: "forbidden",
      executors: ["does-not-exist"]
    }
  }
];
`);

    await assert.rejects(
      () => pluginLoaderModule.createPipelineRegistryContext(repoDir),
      /requires unknown executor 'does-not-exist'/,
    );
  });

  it("fails fast on the first invalid plugin in lexical discovery order", async () => {
    const repoDir = path.join(tempRoot, "repo-fail-fast");
    mkdirSync(repoDir, { recursive: true });
    process.chdir(repoDir);

    writePlugin(repoDir, "a-valid-plugin", {
      id: "a-valid-plugin",
      sdk_version: 1,
      entrypoint: "index.js",
    }, `
export const executors = [
  {
    id: "a-valid-executor",
    definition: {
      kind: "a-valid-executor",
      version: 1,
      defaultConfig: {},
      async execute() {
        return "ok";
      }
    }
  }
];
`);
    writePlugin(repoDir, "b-invalid-plugin", {
      id: "b-invalid-plugin",
      sdk_version: 2,
      entrypoint: "index.js",
    }, `export const executors = [];`);

    await assert.rejects(
      () => pluginLoaderModule.createPipelineRegistryContext(repoDir),
      /Plugin 'b-invalid-plugin'.*supports 1/,
    );
  });

  it("makes plugin-aware flow catalog loading succeed for custom flows that depend on plugin ids", async () => {
    const repoDir = path.join(tempRoot, "repo-catalog");
    mkdirSync(repoDir, { recursive: true });
    process.chdir(repoDir);

    writePlugin(repoDir, "catalog-plugin", {
      id: "catalog-plugin",
      sdk_version: 1,
      entrypoint: "index.js",
    }, `
export const nodes = [
  {
    id: "catalog-node",
    definition: {
      kind: "catalog-node",
      version: 1,
      async run() {
        return { value: "ok" };
      }
    },
    metadata: {
      kind: "catalog-node",
      version: 1,
      prompt: "forbidden"
    }
  }
];
`);
    writeProjectFlow(repoDir, "custom/catalog-flow.json", "catalog-node");

    const entries = await flowCatalogModule.loadInteractiveFlowCatalog(repoDir);
    assert.equal(entries.some((entry) => entry.id === "custom/catalog-flow"), true);
  });

  it("loads the Claude example plugin and validates the project-local example flow through the merged registry", async () => {
    const repoDir = path.join(tempRoot, "repo-claude-example");
    mkdirSync(repoDir, { recursive: true });
    copyClaudeExample(repoDir);
    process.chdir(repoDir);

    const registryContext = await pluginLoaderModule.createPipelineRegistryContext(repoDir);
    assert.equal(registryContext.executors.has("claude"), true);
    assert.equal(registryContext.nodes.has("claude-prompt"), false);

    const flow = await declarativeFlowsModule.loadDeclarativeFlow(
      { source: "project-local", filePath: path.join(repoDir, ".agentweaver", ".flows", "examples", "claude-example.json") },
      { cwd: repoDir, registryContext },
    );
    assert.equal(flow.kind, "claude-example-flow");

    const entries = await flowCatalogModule.loadInteractiveFlowCatalog(repoDir, { registryContext, cwd: repoDir });
    assert.equal(entries.some((entry) => entry.id === "examples/claude-example"), true);
  });

  it("runs the Claude example flow through llm-prompt and publishes the required artifact", async () => {
    const repoDir = path.join(tempRoot, "repo-claude-run");
    mkdirSync(repoDir, { recursive: true });
    copyClaudeExample(repoDir);
    process.chdir(repoDir);

    const registryContext = await pluginLoaderModule.createPipelineRegistryContext(repoDir);
    const flow = await declarativeFlowsModule.loadDeclarativeFlow(
      { source: "project-local", filePath: path.join(repoDir, ".agentweaver", ".flows", "examples", "claude-example.json") },
      { cwd: repoDir, registryContext },
    );
    const artifactRegistry = artifactRegistryModule.createArtifactRegistry();
    const argvCalls = [];
    const pipelineContext = await contextModule.createPipelineContext({
      issueKey: "CLAUDE-1",
      jiraRef: "CLAUDE-1",
      dryRun: false,
      verbose: false,
      runtime: {
        resolveCmd(commandName) {
          assert.equal(commandName, "claude");
          return "/usr/bin/claude";
        },
        async runCommand(argv) {
          argvCalls.push(argv);
          writeJson(path.join(repoDir, ".agentweaver", ".artifacts", "examples", "claude-example-proof.json"), {
            status: "ok",
            executor: "claude",
            message: "Claude executed through llm-prompt.",
            model: "claude-3-7-sonnet",
          });
          return JSON.stringify({
            result: "wrote .agentweaver/.artifacts/examples/claude-example-proof.json",
            model: "claude-3-7-sonnet",
            message: {
              content: [{ text: "fallback that should not win" }],
            },
          });
        },
        artifactRegistry,
      },
      registryContext,
    });

    const phaseResult = await declarativeFlowRunnerModule.runExpandedPhase(
      flow.phases[0],
      pipelineContext,
      {},
      flow.constants,
      { flowKind: flow.kind, flowVersion: flow.version },
    );
    assert.equal(argvCalls.length, 1);
    assert.deepEqual(argvCalls[0]?.slice(0, 2), ["/usr/bin/claude", "-p"]);
    assert.match(
      argvCalls[0]?.[2] ?? "",
      /Create the JSON file `\.agentweaver\/\.artifacts\/examples\/claude-example-proof\.json`/,
    );
    assert.deepEqual(argvCalls[0]?.slice(3), [
      "--output-format",
      "json",
      "--add-dir",
      repoDir,
      "--permission-mode",
      "bypassPermissions",
    ]);

    const proofPath = path.join(repoDir, ".agentweaver", ".artifacts", "examples", "claude-example-proof.json");
    const proofPayloadPath = ".agentweaver/.artifacts/examples/claude-example-proof.json";
    const proofPayload = JSON.parse(readFileSync(proofPath, "utf8"));
    assert.deepEqual(proofPayload, {
      status: "ok",
      executor: "claude",
      message: "Claude executed through llm-prompt.",
      model: "claude-3-7-sonnet",
    });

    const publishedArtifact = phaseResult.steps[0]?.publishedArtifacts?.[0];
    assert.ok(publishedArtifact, "expected the flow step to publish the proof artifact");
    assert.equal(publishedArtifact.payload_path, proofPayloadPath);
    assert.equal(publishedArtifact.logical_key, "artifacts/examples/claude-example-proof.json");

    const manifest = artifactRegistry.loadManifestByPayloadPath(proofPayloadPath);
    assert.ok(manifest, "expected a manifest sidecar for the proof artifact");
    assert.equal(manifest.logical_key, "artifacts/examples/claude-example-proof.json");
    assert.equal(manifest.producer.node, "llm-prompt");
    assert.equal(manifest.producer.executor, "claude");
  });

  it("keeps the Claude example plugin on the public SDK import boundary only", () => {
    const source = readFileSync(
      path.join(repoRoot, "docs", "examples", ".plugins", "claude-example-plugin", "index.js"),
      "utf8",
    );
    assert.match(source, /agentweaver\/plugin-sdk/);
    assert.doesNotMatch(source, /agentweaver\/dist\//);
    assert.doesNotMatch(source, /agentweaver\/src\//);
    assert.doesNotMatch(source, /from\s+["']agentweaver["']/);
    assert.doesNotMatch(source, /from\s+["']\.\.?\//);
  });

  it("normalizes Claude payloads, applies precedence, and fails deterministically on schema drift", async () => {
    const executor = claudeExampleModule.claudeExecutorDefinition;
    const runtime = {
      resolveCmd(commandName, envVarName) {
        assert.equal(commandName, "claude");
        assert.equal(envVarName, "CLAUDE_BIN");
        return "claude";
      },
      async runCommand() {
        return JSON.stringify({
          result: "Result wins",
          model: "payload-model",
          message: { content: [{ text: "should not win" }] },
          content: [{ text: "should also not win" }],
        });
      },
      artifactRegistry: { publish() { throw new Error("not used"); } },
    };
    const result = await executor.execute({
      cwd: repoRoot,
      env: { CLAUDE_MODEL: "env-model", CLAUDE_MAX_TURNS: "4" },
      ui: { writeStdout() {}, writeStderr() {} },
      dryRun: false,
      verbose: false,
      mdLang: null,
      runtime,
    }, {
      prompt: "hello",
      model: "direct-model",
      maxTurns: 9,
    }, {
      ...executor.defaultConfig,
      defaultModel: "default-model",
      defaultMaxTurns: "12",
    });
    assert.equal(result.output, "Result wins");
    assert.equal(result.model, "payload-model");
    assert.deepEqual(result.rawResponse, {
      result: "Result wins",
      model: "payload-model",
      message: { content: [{ text: "should not win" }] },
      content: [{ text: "should also not win" }],
    });

    const messageFallback = await executor.execute({
      cwd: repoRoot,
      env: {},
      ui: { writeStdout() {}, writeStderr() {} },
      dryRun: false,
      verbose: false,
      mdLang: null,
      runtime: {
        ...runtime,
        async runCommand(argv) {
          assert.deepEqual(argv, [
            "claude",
            "-p",
            "hello",
            "--output-format",
            "json",
            "--add-dir",
            repoRoot,
            "--permission-mode",
            "bypassPermissions",
            "--model",
            "default-model",
            "--max-turns",
            "12",
          ]);
          return JSON.stringify({
            message: {
              content: [{ text: "First fragment" }, { text: "   " }, { tool: "ignore" }, { text: "Second fragment" }],
            },
          });
        },
      },
    }, {
      prompt: "hello",
    }, {
      ...executor.defaultConfig,
      defaultModel: "default-model",
      defaultMaxTurns: "12",
    });
    assert.equal(messageFallback.output, "First fragment\nSecond fragment");
    assert.equal(messageFallback.model, "default-model");

    const contentFallback = await executor.execute({
      cwd: repoRoot,
      env: {},
      ui: { writeStdout() {}, writeStderr() {} },
      dryRun: false,
      verbose: false,
      mdLang: null,
      runtime: {
        ...runtime,
        async runCommand() {
          return JSON.stringify({
            content: [{ type: "text", text: "Alpha" }, null, { text: "" }, { text: "Beta" }],
          });
        },
      },
    }, {
      prompt: "hello",
    }, {
      ...executor.defaultConfig,
      defaultModel: "",
      defaultMaxTurns: "",
    });
    assert.equal(contentFallback.output, "Alpha\nBeta");
    assert.equal(contentFallback.model, "");

    await assert.rejects(
      () => executor.execute({
        cwd: repoRoot,
        env: {},
        ui: { writeStdout() {}, writeStderr() {} },
        dryRun: false,
        verbose: false,
        mdLang: null,
        runtime: {
          ...runtime,
          async runCommand() {
            return JSON.stringify({ message: { content: [{ type: "tool_result" }] } });
          },
        },
      }, {
        prompt: "hello",
      }, executor.defaultConfig),
      /Claude JSON normalization failed: no supported assistant text was found/,
    );
  });

  it("surfaces missing command resolution and unauthenticated Claude setup deterministically", async () => {
    const executor = claudeExampleModule.claudeExecutorDefinition;

    await assert.rejects(
      () => executor.execute({
        cwd: repoRoot,
        env: {},
        ui: { writeStdout() {}, writeStderr() {} },
        dryRun: false,
        verbose: false,
        mdLang: null,
        runtime: {
          resolveCmd() {
            throw new Error("Claude command resolution failed");
          },
          async runCommand() {
            throw new Error("should not execute");
          },
          artifactRegistry: { publish() { throw new Error("not used"); } },
        },
      }, {
        prompt: "hello",
      }, executor.defaultConfig),
      /Claude command resolution failed/,
    );

    const runtime = {
      resolveCmd() {
        return "claude";
      },
      async runCommand(argv) {
        assert.deepEqual(argv, ["claude", "auth", "status"]);
        throw new Error("exit code 1");
      },
      artifactRegistry: { publish() { throw new Error("not used"); } },
    };
    await assert.rejects(
      () => claudeExampleModule.verifyClaudeAuth(runtime, {}, executor.defaultConfig),
      /Claude CLI authentication is required/,
    );
  });
});
