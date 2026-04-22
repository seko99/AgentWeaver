import { createHash } from "node:crypto";

import { TaskRunnerError } from "../errors.js";
import {
  allowedModelsForExecutor,
  DEFAULT_LAUNCH_PROFILE,
  defaultModelForExecutor,
  isAllowedModelForExecutor,
  resolveLaunchProfile,
  type LaunchProfileSelection,
  type LlmExecutorId,
  type ResolvedLaunchProfile,
} from "../pipeline/launch-profile-config.js";
import type { ExecutorRegistry } from "../pipeline/registry.js";
import {
  BUILT_IN_EXECUTION_PRESET_IDS,
  EXECUTION_ROUTING_GROUPS,
  type BuiltInExecutionPresetId,
  type ExecutionRouteSelection,
  type ExecutionRoutingGroup,
  type ExecutionRoutingOverrides,
  type ExecutionRoutingPresetDefinition,
  type ResolvedExecutionRouting,
  type SelectedExecutionPreset,
} from "../pipeline/execution-routing-config.js";

export const BUILT_IN_EXECUTION_PRESETS: Record<BuiltInExecutionPresetId, ExecutionRoutingPresetDefinition> = {
  balanced: {
    id: "balanced",
    label: "Balanced",
    description: "Use Codex for planning and review, OpenCode for implementation-style loops.",
    defaultRoute: { executor: "opencode", model: "default" },
    groupOverrides: {
      planning: { executor: "codex", model: "gpt-5.4" },
      "design-review": { executor: "codex", model: "gpt-5.4" },
      review: { executor: "codex", model: "gpt-5.4" },
    },
  },
  "quality-first": {
    id: "quality-first",
    label: "Quality-first",
    description: "Run all routing groups on Codex GPT-5.4.",
    defaultRoute: { executor: "codex", model: "gpt-5.4" },
  },
  "cheap-first": {
    id: "cheap-first",
    label: "Cheap-first",
    description: "Prefer lower-cost models while preserving valid executor and model pairs.",
    defaultRoute: { executor: "opencode", model: "opencode/minimax-m2.5-free" },
    groupOverrides: {
      planning: { executor: "codex", model: "gpt-5.4-mini" },
      "design-review": { executor: "codex", model: "gpt-5.4-mini" },
      review: { executor: "codex", model: "gpt-5.4-mini" },
    },
  },
  "codex-only": {
    id: "codex-only",
    label: "Codex-only",
    description: "Run all routing groups on Codex with the default Codex model.",
    defaultRoute: { executor: "codex", model: "default" },
  },
  "opencode-only": {
    id: "opencode-only",
    label: "OpenCode-only",
    description: "Run all routing groups on OpenCode with the default OpenCode model.",
    defaultRoute: { executor: "opencode", model: "default" },
  },
};

function stableRoutingPayload(routing: ResolvedExecutionRouting): string {
  return JSON.stringify({
    defaultRoute: {
      executor: routing.defaultRoute.executor,
      model: routing.defaultRoute.model,
    },
    groups: Object.fromEntries(
      EXECUTION_ROUTING_GROUPS.map((group) => [
        group,
        {
          executor: routing.groups[group].executor,
          model: routing.groups[group].model,
        },
      ]),
    ),
  });
}

export function executionRoutingFingerprint(routing: Omit<ResolvedExecutionRouting, "fingerprint">): string {
  return createHash("sha256").update(stableRoutingPayload({ ...routing, fingerprint: "" })).digest("hex");
}

export function validateExecutionRoute(executor: string, model: string, executors?: ExecutorRegistry): void {
  if (!executors && !isAllowedModelForExecutor(executor, model)) {
    throw new TaskRunnerError(`Unsupported llm executor '${executor}'.`);
  }
  if (executors && !executors.getRouting(executor)) {
    throw new TaskRunnerError(`Unsupported llm executor '${executor}'.`);
  }
  if (!isAllowedModelForExecutor(executor, model, executors)) {
    throw new TaskRunnerError(`Model '${model}' is not allowed for executor '${executor}'.`);
  }
}

export function toExecutionRouteSelection(route: Pick<ResolvedLaunchProfile, "executor" | "model">): ExecutionRouteSelection {
  return {
    executor: route.executor,
    model: route.model,
  };
}

export function resolveExecutionRoute(
  selection: ExecutionRouteSelection,
  fallback: Pick<ResolvedLaunchProfile, "executor" | "model">,
  executors?: ExecutorRegistry,
): ResolvedLaunchProfile {
  const launchProfile = resolveLaunchProfile(
    {
      executor: selection.executor,
      model: selection.model,
    } satisfies LaunchProfileSelection,
    fallback,
    executors,
  );
  validateExecutionRoute(launchProfile.executor, launchProfile.model, executors);
  return launchProfile;
}

export function resolveExecutionRouting(options: {
  defaultRoute?: ExecutionRouteSelection;
  presetId?: BuiltInExecutionPresetId | null;
  presetOverrides?: ExecutionRoutingOverrides;
  currentRunOverrides?: ExecutionRoutingOverrides;
  fallbackDefaultRoute?: Pick<ResolvedLaunchProfile, "executor" | "model">;
  executors?: ExecutorRegistry;
}): ResolvedExecutionRouting {
  const fallbackDefaultRoute = options.fallbackDefaultRoute ?? DEFAULT_LAUNCH_PROFILE;
  const preset = options.presetId ? BUILT_IN_EXECUTION_PRESETS[options.presetId] : null;
  const defaultRouteSelection = options.defaultRoute ?? preset?.defaultRoute ?? toExecutionRouteSelection(fallbackDefaultRoute);
  const defaultRoute = resolveExecutionRoute(defaultRouteSelection, fallbackDefaultRoute, options.executors);
  const groups = Object.fromEntries(
    EXECUTION_ROUTING_GROUPS.map((group) => {
      const override = options.currentRunOverrides?.[group]
        ?? options.presetOverrides?.[group]
        ?? preset?.groupOverrides?.[group]
        ?? { executor: "default", model: "default" };
      return [group, resolveExecutionRoute(override, defaultRoute, options.executors)];
    }),
  ) as Record<ExecutionRoutingGroup, ResolvedLaunchProfile>;
  const fingerprint = executionRoutingFingerprint({
    defaultRoute,
    groups,
  });
  return {
    defaultRoute,
    groups,
    fingerprint,
  };
}

export function routingGroupLabel(group: ExecutionRoutingGroup): string {
  switch (group) {
    case "planning":
      return "Planning";
    case "design-review":
      return "Design review";
    case "implementation":
      return "Implementation";
    case "review":
      return "Review";
    case "repair-loop":
      return "Repair loop";
    case "local-fix-loop":
      return "Local fix loop";
    default:
      return group;
  }
}

export function describeExecutionRouting(
  routing: ResolvedExecutionRouting,
  groups: readonly ExecutionRoutingGroup[] = EXECUTION_ROUTING_GROUPS,
): string {
  const lines = [`Default: ${routing.defaultRoute.executor} / ${routing.defaultRoute.model}`];
  for (const group of groups) {
    const route = routing.groups[group];
    lines.push(`${routingGroupLabel(group)}: ${route.executor} / ${route.model}`);
  }
  return lines.join("\n");
}

export function executorsForRoutingGroups(
  routing: ResolvedExecutionRouting,
  groups: readonly ExecutionRoutingGroup[],
): LlmExecutorId[] {
  const requiredExecutors: LlmExecutorId[] = [];
  for (const group of groups) {
    const executor = routing.groups[group].executor;
    if (!requiredExecutors.includes(executor)) {
      requiredExecutors.push(executor);
    }
  }
  return requiredExecutors;
}

export function normalizeEditableExecutionRouting(
  routes: Record<ExecutionRoutingGroup, { executor: LlmExecutorId; model: string }>,
  executors?: ExecutorRegistry,
): {
  routes: Record<ExecutionRoutingGroup, { executor: LlmExecutorId; model: string }>;
  validationErrors: string[];
} {
  const normalizedRoutes = {} as Record<ExecutionRoutingGroup, { executor: LlmExecutorId; model: string }>;
  const validationErrors: string[] = [];
  for (const group of EXECUTION_ROUTING_GROUPS) {
    const route = routes[group];
    if (isAllowedModelForExecutor(route.executor, route.model, executors)) {
      normalizedRoutes[group] = { ...route };
      continue;
    }
    normalizedRoutes[group] = {
      executor: route.executor,
      model: defaultModelForExecutor(route.executor, executors),
    };
    validationErrors.push(
      `${routingGroupLabel(group)} model '${route.model}' is not allowed for executor '${route.executor}'. Select a ${route.executor} model.`,
    );
  }
  return {
    routes: normalizedRoutes,
    validationErrors,
  };
}

export function builtInExecutionPresetList(): ExecutionRoutingPresetDefinition[] {
  return BUILT_IN_EXECUTION_PRESET_IDS.map((id) => BUILT_IN_EXECUTION_PRESETS[id]);
}

export function selectedExecutionPresetLabel(selection: SelectedExecutionPreset): string {
  return selection.label;
}

export function cloneResolvedExecutionRouting(routing: ResolvedExecutionRouting): ResolvedExecutionRouting {
  return {
    defaultRoute: { ...routing.defaultRoute },
    groups: Object.fromEntries(
      EXECUTION_ROUTING_GROUPS.map((group) => [group, { ...routing.groups[group] }]),
    ) as Record<ExecutionRoutingGroup, ResolvedLaunchProfile>,
    fingerprint: routing.fingerprint,
  };
}

export function defaultExecutionRouting(): ResolvedExecutionRouting {
  return resolveExecutionRouting({
    defaultRoute: {
      executor: DEFAULT_LAUNCH_PROFILE.executor,
      model: DEFAULT_LAUNCH_PROFILE.model,
    },
  });
}

export function resolveStoredExecutionRoutingSnapshot(
  routing: ResolvedExecutionRouting,
  executors?: ExecutorRegistry,
): ResolvedExecutionRouting {
  if (executors) {
    validateExecutionRoute(routing.defaultRoute.executor, routing.defaultRoute.model, executors);
  }
  for (const group of EXECUTION_ROUTING_GROUPS) {
    if (executors) {
      validateExecutionRoute(routing.groups[group].executor, routing.groups[group].model, executors);
    }
  }
  const fingerprint = executionRoutingFingerprint({
    defaultRoute: routing.defaultRoute,
    groups: routing.groups,
  });
  return {
    defaultRoute: {
      ...routing.defaultRoute,
      selectedExecutor: routing.defaultRoute.selectedExecutor ?? routing.defaultRoute.executor,
      selectedModel: routing.defaultRoute.selectedModel ?? routing.defaultRoute.model,
      fingerprint: routing.defaultRoute.fingerprint ?? `${routing.defaultRoute.executor}::${routing.defaultRoute.model}`,
    },
    groups: Object.fromEntries(
      EXECUTION_ROUTING_GROUPS.map((group) => {
        const route = routing.groups[group];
        return [group, {
          ...route,
          selectedExecutor: route.selectedExecutor ?? route.executor,
          selectedModel: route.selectedModel ?? route.model,
          fingerprint: route.fingerprint ?? `${route.executor}::${route.model}`,
        }];
      }),
    ) as Record<ExecutionRoutingGroup, ResolvedLaunchProfile>,
    fingerprint,
  };
}

export function singleLaunchProfileExecutionRouting(launchProfile: ResolvedLaunchProfile): ResolvedExecutionRouting {
  return resolveExecutionRouting({
    defaultRoute: toExecutionRouteSelection(launchProfile),
    currentRunOverrides: Object.fromEntries(
      EXECUTION_ROUTING_GROUPS.map((group) => [group, toExecutionRouteSelection(launchProfile)]),
    ) as ExecutionRoutingOverrides,
  });
}

export function modelOptionsForExecutor(executor: LlmExecutorId, executors?: ExecutorRegistry): Array<{ value: string; label: string }> {
  const defaultModel = defaultModelForExecutor(executor, executors);
  return allowedModelsForExecutor(executor, executors).map((model) => ({
    value: model,
    label: model === defaultModel ? `${model} [default]` : model,
  }));
}
