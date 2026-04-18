import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { llmPromptNode } = await import(
  pathToFileURL(path.join(distRoot, "pipeline/nodes/llm-prompt-node.js")).href
);
const { createNodeRegistry } = await import(
  pathToFileURL(path.join(distRoot, "pipeline/node-registry.js")).href
);
const { createExecutorRegistry } = await import(
  pathToFileURL(path.join(distRoot, "pipeline/registry.js")).href
);
const { validateFlowSpec } = await import(
  pathToFileURL(path.join(distRoot, "pipeline/spec-validator.js")).href
);
const { getOutputAdapter, setOutputAdapter } = await import(
  pathToFileURL(path.join(distRoot, "tui.js")).href
);

let originalOutputAdapter;

beforeEach(() => {
  originalOutputAdapter = getOutputAdapter();
  setOutputAdapter({
    writeStdout() {},
    writeStderr() {},
    supportsTransientStatus: false,
    supportsPassthrough: false,
    renderAuxiliaryOutput: false,
    renderPanelsAsPlainText: true,
  });
});

afterEach(() => {
  setOutputAdapter(originalOutputAdapter);
});

describe("llm-prompt routing", () => {
  it("prefers the routing-group route over explicit step executor and model", async () => {
    const calls = [];
    const context = {
      issueKey: "AG-73",
      jiraRef: "AG-73",
      cwd: process.cwd(),
      env: {},
      ui: {},
      dryRun: false,
      verbose: false,
      runtime: {},
      executors: {
        get(id) {
          return {
            defaultConfig: {},
            async execute(_executorContext, input) {
              calls.push({ id, input });
              return { output: "ok" };
            },
          };
        },
      },
      nodes: {},
      executionRouting: {
        fingerprint: "routing-fingerprint",
        defaultRoute: { executor: "opencode", model: "minimax-coding-plan/MiniMax-M2.7" },
        groups: {
          review: { executor: "opencode", model: "minimax-coding-plan/MiniMax-M2.7" },
        },
      },
    };

    const result = await llmPromptNode.run(context, {
      prompt: "Review this",
      labelText: "Running prompt",
      routingGroup: "review",
      executor: "codex",
      model: "gpt-5.4-mini",
    });

    assert.deepEqual(calls, [
      {
        id: "opencode",
        input: {
          prompt: "Review this",
          model: "minimax-coding-plan/MiniMax-M2.7",
          env: {},
        },
      },
    ]);
    assert.equal(result.value.executor, "opencode");
  });

  it("uses explicit step executor and model when no routing-group route is configured", async () => {
    const calls = [];
    const context = {
      issueKey: "AG-73",
      jiraRef: "AG-73",
      cwd: process.cwd(),
      env: {},
      ui: {},
      dryRun: false,
      verbose: false,
      runtime: {},
      executors: {
        get(id) {
          return {
            defaultConfig: {},
            async execute(_executorContext, input) {
              calls.push({ id, input });
              return { output: "ok" };
            },
          };
        },
      },
      nodes: {},
      executionRouting: {
        fingerprint: "routing-fingerprint",
        defaultRoute: { executor: "opencode", model: "minimax-coding-plan/MiniMax-M2.7" },
        groups: {},
      },
    };

    const result = await llmPromptNode.run(context, {
      prompt: "Review this",
      labelText: "Running prompt",
      routingGroup: "review",
      executor: "codex",
      model: "gpt-5.4-mini",
    });

    assert.deepEqual(calls, [
      {
        id: "codex",
        input: {
          prompt: "Review this",
          model: "gpt-5.4-mini",
          env: {},
        },
      },
    ]);
    assert.equal(result.value.executor, "codex");
  });

  it("rejects llm-prompt steps that lack both routingGroup and executor", () => {
    const spec = {
      kind: "test-flow",
      version: 1,
      phases: [
        {
          id: "phase-1",
          steps: [
            {
              id: "step-1",
              node: "llm-prompt",
              prompt: {
                inlineTemplate: "Prompt body",
              },
              params: {
                labelText: {
                  const: "Run prompt",
                },
              },
            },
          ],
        },
      ],
    };

    assert.throws(
      () => validateFlowSpec(spec, createNodeRegistry(), createExecutorRegistry()),
      /requires routingGroup or param 'executor'/,
    );
  });
});
