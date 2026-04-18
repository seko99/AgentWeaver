import type { LlmExecutorId, ResolvedLaunchProfile } from "./launch-profile-config.js";

export const EXECUTION_ROUTING_GROUPS = [
  "planning",
  "design-review",
  "implementation",
  "review",
  "repair-loop",
  "local-fix-loop",
] as const;

export type ExecutionRoutingGroup = (typeof EXECUTION_ROUTING_GROUPS)[number];

export const BUILT_IN_EXECUTION_PRESET_IDS = [
  "balanced",
  "quality-first",
  "cheap-first",
  "codex-only",
  "opencode-only",
] as const;

export type BuiltInExecutionPresetId = (typeof BUILT_IN_EXECUTION_PRESET_IDS)[number];

export type ExecutionRouteSelection = {
  executor: LlmExecutorId | "default";
  model: string | "default";
};

export type ExecutionRoute = Pick<ResolvedLaunchProfile, "executor" | "model">;

export type ExecutionRoutingOverrides = Partial<Record<ExecutionRoutingGroup, ExecutionRouteSelection>>;

export type ResolvedExecutionRouting = {
  defaultRoute: ResolvedLaunchProfile;
  groups: Record<ExecutionRoutingGroup, ResolvedLaunchProfile>;
  fingerprint: string;
};

export type ExecutionRoutingPresetDefinition = {
  id: BuiltInExecutionPresetId;
  label: string;
  description: string;
  defaultRoute: ExecutionRouteSelection;
  groupOverrides?: ExecutionRoutingOverrides;
};

export type SelectedExecutionPreset =
  | {
      kind: "built-in";
      presetId: BuiltInExecutionPresetId;
      label: string;
    }
  | {
      kind: "named";
      presetId: string;
      label: string;
    }
  | {
      kind: "flow-default";
      label: string;
    }
  | {
      kind: "last-used";
      label: string;
    }
  | {
      kind: "custom";
      label: string;
    };

export type StoredExecutionRoutingEntry = {
  routing: ResolvedExecutionRouting;
  selectedPreset: SelectedExecutionPreset;
  updatedAt: string;
};

