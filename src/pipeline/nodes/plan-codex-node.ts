import type {
  CodexLocalExecutorConfig,
  CodexLocalExecutorInput,
  CodexLocalExecutorResult,
} from "../../executors/codex-local-executor.js";
import { printInfo, printPrompt } from "../../tui.js";
import type { PipelineNodeDefinition } from "../types.js";
import { toExecutorContext } from "../types.js";

export type PlanCodexNodeParams = {
  prompt: string;
  requiredArtifacts: string[];
  command?: string;
};

export const planCodexNode: PipelineNodeDefinition<PlanCodexNodeParams, CodexLocalExecutorResult> = {
  kind: "plan-codex",
  version: 1,
  async run(context, params) {
    printInfo("Running Codex planning mode");
    printPrompt("Codex", params.prompt);
    const executor = context.executors.get<CodexLocalExecutorConfig, CodexLocalExecutorInput, CodexLocalExecutorResult>("codex-local");
    const input: CodexLocalExecutorInput = {
      prompt: params.prompt,
      env: { ...context.env },
    };
    if (params.command) {
      input.command = params.command;
    }
    const value = await executor.execute(
      toExecutorContext(context),
      input,
      executor.defaultConfig,
    );
    return {
      value,
      outputs: params.requiredArtifacts.map((path) => ({ kind: "artifact" as const, path, required: true })),
    };
  },
  checks(_context, params) {
    return [
      {
        kind: "require-artifacts",
        paths: params.requiredArtifacts,
        message: "Plan mode did not produce the required artifacts.",
      },
    ];
  },
};
