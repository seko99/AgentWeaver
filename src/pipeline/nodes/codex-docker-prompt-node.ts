import type {
  CodexDockerExecutorConfig,
  CodexDockerExecutorInput,
  CodexDockerExecutorResult,
} from "../../executors/codex-docker-executor.js";
import { printInfo, printPrompt } from "../../tui.js";
import type { PipelineNodeDefinition } from "../types.js";
import { toExecutorContext } from "../types.js";

export type CodexDockerPromptNodeParams = {
  prompt: string;
  dockerComposeFile: string;
  labelText: string;
  requiredArtifacts?: string[];
  missingArtifactsMessage?: string;
};

export const codexDockerPromptNode: PipelineNodeDefinition<CodexDockerPromptNodeParams, CodexDockerExecutorResult> = {
  kind: "codex-docker-prompt",
  version: 1,
  async run(context, params) {
    printInfo(params.labelText);
    printPrompt("Codex", params.prompt);
    const executor = context.executors.get<CodexDockerExecutorConfig, CodexDockerExecutorInput, CodexDockerExecutorResult>(
      "codex-docker",
    );
    const value = await executor.execute(
      toExecutorContext(context),
      {
        dockerComposeFile: params.dockerComposeFile,
        prompt: params.prompt,
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
        message: params.missingArtifactsMessage ?? "Codex docker node did not produce required artifacts.",
      },
    ];
  },
};
