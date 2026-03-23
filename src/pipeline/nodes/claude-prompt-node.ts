import type { ClaudeExecutorConfig, ClaudeExecutorInput, ClaudeExecutorResult } from "../../executors/claude-executor.js";
import { printInfo, printPrompt } from "../../tui.js";
import type { PipelineNodeDefinition } from "../types.js";
import { toExecutorContext } from "../types.js";

export type ClaudePromptNodeParams = {
  prompt: string;
  labelText: string;
  command?: string;
  requiredArtifacts?: string[];
  missingArtifactsMessage?: string;
};

export const claudePromptNode: PipelineNodeDefinition<ClaudePromptNodeParams, ClaudeExecutorResult> = {
  kind: "claude-prompt",
  version: 1,
  async run(context, params) {
    printInfo(params.labelText);
    printPrompt("Claude", params.prompt);
    const executor = context.executors.get<ClaudeExecutorConfig, ClaudeExecutorInput, ClaudeExecutorResult>("claude");
    const value = await executor.execute(
      toExecutorContext(context),
      {
        prompt: params.prompt,
        ...(params.command ? { command: params.command } : {}),
        env: { ...context.env },
      },
      executor.defaultConfig,
    );
    return {
      value,
      outputs: (params.requiredArtifacts ?? []).map((path) => ({ kind: "artifact" as const, path, required: true })),
    };
  },
  checks(_context, params) {
    if (!params.requiredArtifacts || params.requiredArtifacts.length === 0) {
      return [];
    }
    return [
      {
        kind: "require-artifacts",
        paths: params.requiredArtifacts,
        message: params.missingArtifactsMessage ?? "Claude prompt node did not produce required artifacts.",
      },
    ];
  },
};
