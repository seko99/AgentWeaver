import type { JsonObject, JsonValue } from "../../executors/types.js";
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
  JsonObject & { executor: string };

type RoutedLlmExecutorInput = {
  prompt: string;
  command?: string;
  model?: string;
  env?: NodeJS.ProcessEnv;
};

type RoutedLlmExecutorResult = JsonObject & {
  output: string;
  command?: string;
  model?: string;
};

function outputsForArtifacts(requiredArtifacts?: string[]) {
  return Array.from(new Set(requiredArtifacts ?? [])).map((outputPath) => ({
    kind: "artifact" as const,
    path: outputPath,
    required: true,
    manifest: {
      publish: true,
    },
  }));
}

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
    if (!executor || !isLlmExecutorId(executor, context.executors)) {
      throw new TaskRunnerError(`Unsupported llm executor '${String(executor ?? params.executor ?? "undefined")}'.`);
    }
    if (model && !isAllowedModelForExecutor(executor, model, context.executors)) {
      throw new TaskRunnerError(`Model '${model}' is not allowed for executor '${executor}'.`);
    }
    printInfo(params.labelText);
    printPrompt(`LLM:${executor}`, params.prompt);
    const executorContext = toExecutorContext(context);
    const resolvedExecutor = context.executors.get<JsonValue, RoutedLlmExecutorInput, RoutedLlmExecutorResult>(executor);
    const value = await resolvedExecutor.execute(
      executorContext,
      {
        prompt: params.prompt,
        ...(model ? { model } : {}),
        env: { ...context.env },
      },
      resolvedExecutor.defaultConfig,
    );
    return {
      value: {
        ...value,
        executor,
      },
      outputs: outputsForArtifacts(params.requiredArtifacts),
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
        message: params.missingArtifactsMessage ?? "LLM prompt node did not produce required artifacts.",
      },
    ];
  },
};
