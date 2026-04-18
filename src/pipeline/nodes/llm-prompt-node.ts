import type {
  CodexExecutorConfig,
  CodexExecutorInput,
  CodexExecutorResult,
} from "../../executors/codex-executor.js";
import type {
  OpenCodeExecutorConfig,
  OpenCodeExecutorInput,
  OpenCodeExecutorResult,
} from "../../executors/opencode-executor.js";
import { TaskRunnerError } from "../../errors.js";
import { printInfo, printPrompt } from "../../tui.js";
import type { ExecutionRoutingGroup } from "../execution-routing-config.js";
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
  executor?: LlmExecutorId;
  command?: string;
  model?: string;
  routingGroup?: ExecutionRoutingGroup;
  requiredArtifacts?: string[];
  missingArtifactsMessage?: string;
};

type LlmPromptNodeResult =
  | (CodexExecutorResult & { executor: "codex" })
  | (OpenCodeExecutorResult & { executor: "opencode" });

export const llmPromptNode: PipelineNodeDefinition<LlmPromptNodeParams, LlmPromptNodeResult> = {
  kind: "llm-prompt",
  version: 1,
  async run(context, params) {
    const routedProfile = params.routingGroup
      ? context.executionRouting?.groups[params.routingGroup]
      : undefined;
    const fallbackProfile = context.executionRouting?.defaultRoute;
    const executor = params.routingGroup
      ? routedProfile?.executor ?? params.executor ?? fallbackProfile?.executor
      : params.executor ?? fallbackProfile?.executor;
    const model = params.routingGroup
      ? routedProfile?.model ?? params.model ?? fallbackProfile?.model
      : params.model ?? fallbackProfile?.model;
    if (!executor || !isLlmExecutorId(executor)) {
      throw new TaskRunnerError(`Unsupported llm executor '${String(executor ?? params.executor ?? "undefined")}'.`);
    }
    if (model && !isAllowedModelForExecutor(executor, model)) {
      throw new TaskRunnerError(`Model '${model}' is not allowed for executor '${executor}'.`);
    }
    printInfo(params.labelText);
    printPrompt(`LLM:${executor}`, params.prompt);
    const executorContext = toExecutorContext(context);
    if (executor === "codex") {
      const executor = context.executors.get<CodexExecutorConfig, CodexExecutorInput, CodexExecutorResult>(
        "codex",
      );
      const value = await executor.execute(
        executorContext,
        {
          prompt: params.prompt,
          ...(model ? { model } : {}),
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
    if (executor === "opencode") {
      const executor = context.executors.get<OpenCodeExecutorConfig, OpenCodeExecutorInput, OpenCodeExecutorResult>("opencode");
      const value = await executor.execute(
        executorContext,
        {
          prompt: params.prompt,
          ...(model ? { model } : {}),
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
    throw new TaskRunnerError(`Unsupported llm executor '${executor}'.`);
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
