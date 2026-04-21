import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const packageJson = JSON.parse(readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"));

let tempRoot;
let originalCwd;
let pluginLoaderModule;
let declarativeFlowsModule;
let contextModule;
let nodeRunnerModule;
let flowCatalogModule;

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

beforeEach(async () => {
  originalCwd = process.cwd();
  tempRoot = mkdtempSync(path.join(os.tmpdir(), "agentweaver-plugin-loader-"));
  pluginLoaderModule = await import(`${pathToFileURL(path.join(distRoot, "pipeline/plugin-loader.js")).href}?loader=${Date.now()}`);
  declarativeFlowsModule = await import(`${pathToFileURL(path.join(distRoot, "pipeline/declarative-flows.js")).href}?flows=${Date.now()}`);
  contextModule = await import(`${pathToFileURL(path.join(distRoot, "pipeline/context.js")).href}?context=${Date.now()}`);
  nodeRunnerModule = await import(`${pathToFileURL(path.join(distRoot, "pipeline/node-runner.js")).href}?runner=${Date.now()}`);
  flowCatalogModule = await import(`${pathToFileURL(path.join(distRoot, "pipeline/flow-catalog.js")).href}?catalog=${Date.now()}`);
});

afterEach(() => {
  process.chdir(originalCwd);
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
});
