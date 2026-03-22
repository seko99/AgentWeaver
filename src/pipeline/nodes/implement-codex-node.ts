import type {
  CodexDockerExecutorConfig,
  CodexDockerExecutorInput,
  CodexDockerExecutorResult,
} from "../../executors/codex-docker-executor.js";
import { printInfo, printPrompt } from "../../tui.js";
import type { PipelineNodeDefinition } from "../types.js";
import { toExecutorContext } from "../types.js";

export type ImplementCodexNodeParams = {
  prompt: string;
  dockerComposeFile: string;
  labelText: string;
};

export const implementCodexNode: PipelineNodeDefinition<ImplementCodexNodeParams, CodexDockerExecutorResult> = {
  kind: "implement-codex",
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
    return { value };
  },
};
