import type {
  CodexLocalExecutorConfig,
  CodexLocalExecutorInput,
  CodexLocalExecutorResult,
} from "../../executors/codex-local-executor.js";
import type {
  OpenCodeExecutorConfig,
  OpenCodeExecutorInput,
  OpenCodeExecutorResult,
} from "../../executors/opencode-executor.js";
import { TaskRunnerError } from "../../errors.js";
import { printInfo, printPrompt } from "../../tui.js";
import {
  isAllowedModelForExecutor,
  isLlmExecutorId,
  type LlmExecutorId,
} from "../launch-profile-config.js";
import type { PipelineNodeDefinition } from "../types.js";
import { toExecutorContext } from "../types.js";

export type LlmPromptNodeParams = {
  prompt: string;
  labelText: string;
  executor: LlmExecutorId;
  command?: string;
  model?: string;
  requiredArtifacts?: string[];
  missingArtifactsMessage?: string;
};

type LlmPromptNodeResult =
  | (CodexLocalExecutorResult & { executor: "codex" })
  | (OpenCodeExecutorResult & { executor: "opencode" });

export const llmPromptNode: PipelineNodeDefinition<LlmPromptNodeParams, LlmPromptNodeResult> = {
  kind: "llm-prompt",
  version: 1,
  async run(context, params) {
    if (!isLlmExecutorId(params.executor)) {
      throw new TaskRunnerError(`Unsupported llm executor '${params.executor}'.`);
    }
    if (params.model && !isAllowedModelForExecutor(params.executor, params.model)) {
      throw new TaskRunnerError(`Model '${params.model}' is not allowed for executor '${params.executor}'.`);
    }
    printInfo(params.labelText);
    printPrompt(`LLM:${params.executor}`, params.prompt);
    const executorContext = toExecutorContext(context);
    if (params.executor === "codex") {
      const executor = context.executors.get<CodexLocalExecutorConfig, CodexLocalExecutorInput, CodexLocalExecutorResult>(
        "codex",
      );
      const value = await executor.execute(
        executorContext,
        {
          prompt: params.prompt,
          ...(params.model ? { model: params.model } : {}),
          env: { ...context.env },
        },
        executor.defaultConfig,
      );
      return {
        value: {
          ...value,
          executor: "codex",
        },
        outputs: (params.requiredArtifacts ?? []).map((path) => ({ kind: "artifact" as const, path, required: true })),
      };
    }
    if (params.executor === "opencode") {
      const executor = context.executors.get<OpenCodeExecutorConfig, OpenCodeExecutorInput, OpenCodeExecutorResult>("opencode");
      const value = await executor.execute(
        executorContext,
        {
          prompt: params.prompt,
          ...(params.model ? { model: params.model } : {}),
          env: { ...context.env },
        },
        executor.defaultConfig,
      );
      return {
        value: {
          ...value,
          executor: "opencode",
        },
        outputs: (params.requiredArtifacts ?? []).map((path) => ({ kind: "artifact" as const, path, required: true })),
      };
    }
    throw new TaskRunnerError(`Unsupported llm executor '${params.executor}'.`);
  },
  checks(_context, params) {
    if (!params.requiredArtifacts || params.requiredArtifacts.length === 0) {
      return [];
    }
    return [
      {
        kind: "require-artifacts",
        paths: params.requiredArtifacts,
        message: params.missingArtifactsMessage ?? "LLM prompt node did not produce required artifacts.",
      },
    ];
  },
};
