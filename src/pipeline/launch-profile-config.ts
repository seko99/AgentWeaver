import type { ExecutorRegistry } from "./registry.js";
import { createExecutorRegistry } from "./registry.js";

const BUILT_IN_EXECUTOR_REGISTRY = createExecutorRegistry();

export type LlmExecutorId = string;

export type LaunchProfileSelection = {
  executor: LlmExecutorId | "default";
  model: string | "default";
};

export type ResolvedLaunchProfile = {
  executor: LlmExecutorId;
  model: string;
  selectedExecutor: LlmExecutorId | "default";
  selectedModel: string | "default";
  fingerprint: string;
};

export const DEFAULT_EXECUTOR: LlmExecutorId = "opencode";

export const DEFAULT_LAUNCH_PROFILE: Readonly<Pick<ResolvedLaunchProfile, "executor" | "model">> = {
  executor: DEFAULT_EXECUTOR,
  model: "minimax-coding-plan/MiniMax-M2.7",
};

function registryOrBuiltIn(executors?: ExecutorRegistry): ExecutorRegistry {
  return executors ?? BUILT_IN_EXECUTOR_REGISTRY;
}

export function llmExecutorIds(executors?: ExecutorRegistry): LlmExecutorId[] {
  return registryOrBuiltIn(executors).llmExecutors().map((entry) => entry.id);
}

export function defaultModelForExecutor(executor: LlmExecutorId, executors?: ExecutorRegistry): string {
  const routing = registryOrBuiltIn(executors).getRouting(executor);
  if (!routing || routing.kind !== "llm") {
    throw new Error(`Unsupported llm executor '${executor}'.`);
  }
  return routing.defaultModel;
}

export function isLlmExecutorId(value: string, executors?: ExecutorRegistry): value is LlmExecutorId {
  const routing = registryOrBuiltIn(executors).getRouting(value);
  return routing?.kind === "llm";
}

export function isAllowedModelForExecutor(executor: LlmExecutorId, model: string, executors?: ExecutorRegistry): boolean {
  const routing = registryOrBuiltIn(executors).getRouting(executor);
  return routing?.kind === "llm" ? routing.models.includes(model) : false;
}

export function allowedModelsForExecutor(executor: LlmExecutorId, executors?: ExecutorRegistry): string[] {
  const routing = registryOrBuiltIn(executors).getRouting(executor);
  if (!routing || routing.kind !== "llm") {
    throw new Error(`Unsupported llm executor '${executor}'.`);
  }
  return [...routing.models];
}

export function resolveLaunchProfile(
  selection: LaunchProfileSelection,
  fallback: Pick<ResolvedLaunchProfile, "executor" | "model"> = DEFAULT_LAUNCH_PROFILE,
  executors?: ExecutorRegistry,
): ResolvedLaunchProfile {
  const executor = selection.executor === "default" ? fallback.executor : selection.executor;
  const model = selection.model === "default"
    ? selection.executor === "default"
      ? fallback.model
      : defaultModelForExecutor(executor, executors)
    : selection.model;
  return {
    executor,
    model,
    selectedExecutor: selection.executor,
    selectedModel: selection.model,
    fingerprint: `${executor}::${model}`,
  };
}
