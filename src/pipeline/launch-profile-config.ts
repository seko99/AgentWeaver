export const LLM_EXECUTOR_IDS = ["codex", "opencode"] as const;

export type LlmExecutorId = (typeof LLM_EXECUTOR_IDS)[number];

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

export const ALLOWED_MODELS_BY_EXECUTOR: Record<LlmExecutorId, readonly string[]> = {
  codex: ["gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex"],
  opencode: ["opencode/minimax-m2.5-free", "minimax-coding-plan/MiniMax-M2.7"],
};

export const DEFAULT_EXECUTOR: LlmExecutorId = "opencode";

export const DEFAULT_MODEL_BY_EXECUTOR: Record<LlmExecutorId, string> = {
  codex: "gpt-5.4",
  opencode: "minimax-coding-plan/MiniMax-M2.7",
};

export const DEFAULT_LAUNCH_PROFILE: Readonly<Pick<ResolvedLaunchProfile, "executor" | "model">> = {
  executor: DEFAULT_EXECUTOR,
  model: DEFAULT_MODEL_BY_EXECUTOR[DEFAULT_EXECUTOR],
};

export function defaultModelForExecutor(executor: LlmExecutorId): string {
  return DEFAULT_MODEL_BY_EXECUTOR[executor];
}

export function isLlmExecutorId(value: string): value is LlmExecutorId {
  return (LLM_EXECUTOR_IDS as readonly string[]).includes(value);
}

export function isAllowedModelForExecutor(executor: LlmExecutorId, model: string): boolean {
  return ALLOWED_MODELS_BY_EXECUTOR[executor].includes(model);
}

export function resolveLaunchProfile(
  selection: LaunchProfileSelection,
  fallback: Pick<ResolvedLaunchProfile, "executor" | "model"> = DEFAULT_LAUNCH_PROFILE,
): ResolvedLaunchProfile {
  const executor = selection.executor === "default" ? fallback.executor : selection.executor;
  const model = selection.model === "default"
    ? selection.executor === "default"
      ? fallback.model
      : defaultModelForExecutor(executor)
    : selection.model;
  return {
    executor,
    model,
    selectedExecutor: selection.executor,
    selectedModel: selection.model,
    fingerprint: `${executor}::${model}`,
  };
}
