import type {
  CodexLocalExecutorConfig,
  CodexLocalExecutorInput,
  CodexLocalExecutorResult,
} from "../../executors/codex-local-executor.js";
import { printInfo, printPrompt } from "../../tui.js";
import type { PipelineNodeDefinition } from "../types.js";
import { toExecutorContext } from "../types.js";

export type CodexLocalPromptNodeParams = {
  prompt: string;
  labelText: string;
  model?: string;
  requiredArtifacts?: string[];
  missingArtifactsMessage?: string;
};

export const codexLocalPromptNode: PipelineNodeDefinition<CodexLocalPromptNodeParams, CodexLocalExecutorResult> = {
  kind: "codex-local-prompt",
  version: 1,
  async run(context, params) {
    printInfo(params.labelText);
    printPrompt("Codex", params.prompt);
    const executor = context.executors.get<CodexLocalExecutorConfig, CodexLocalExecutorInput, CodexLocalExecutorResult>(
      "codex-local",
    );
    const value = await executor.execute(
      toExecutorContext(context),
      {
        prompt: params.prompt,
        ...(params.model ? { model: params.model } : {}),
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
        message: params.missingArtifactsMessage ?? "Codex local node did not produce required artifacts.",
      },
    ];
  },
};
