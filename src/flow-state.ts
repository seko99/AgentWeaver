import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { ensureScopeWorkspaceDir, flowStateFile } from "./artifacts.js";
import { TaskRunnerError } from "./errors.js";
import type { ResolvedExecutionRouting, SelectedExecutionPreset } from "./pipeline/execution-routing-config.js";
import type { ResolvedLaunchProfile } from "./pipeline/launch-profile-config.js";
import type {
  ExpandedPhaseExecutionState,
  ExpandedPhaseSpec,
  ExpandedStepExecutionState,
  FlowExecutionState,
} from "./pipeline/spec-types.js";
import { resolveStoredExecutionRoutingSnapshot, singleLaunchProfileExecutionRouting } from "./runtime/execution-routing.js";

const FLOW_STATE_SCHEMA_VERSION = 2;

export type FlowRunState = {
  schemaVersion: number;
  flowId: string;
  scopeKey: string;
  jiraRef?: string | null;
  status: "pending" | "running" | "blocked" | "completed";
  currentStep?: string | null;
  updatedAt: string;
  lastError?: { step?: string; returnCode?: number; message?: string } | null;
  launchProfile?: ResolvedLaunchProfile;
  executionRouting?: ResolvedExecutionRouting;
  routingFingerprint?: string;
  selectedRoutingPreset?: SelectedExecutionPreset;
  executionState: FlowExecutionState;
};

type FlowRunStateV1 = Omit<FlowRunState, "schemaVersion" | "executionRouting" | "routingFingerprint" | "selectedRoutingPreset"> & {
  schemaVersion: 1;
};

function nowIso8601(): string {
  return new Date().toISOString();
}

export function stripExecutionStatePayload(executionState: FlowExecutionState): FlowExecutionState {
  return {
    flowKind: executionState.flowKind,
    flowVersion: executionState.flowVersion,
    terminated: executionState.terminated,
    ...(executionState.terminationReason ? { terminationReason: executionState.terminationReason } : {}),
    ...(executionState.terminationOutcome ? { terminationOutcome: executionState.terminationOutcome } : {}),
    phases: executionState.phases.map((phase) => ({
      id: phase.id,
      status: phase.status,
      repeatVars: { ...phase.repeatVars },
      ...(phase.startedAt ? { startedAt: phase.startedAt } : {}),
      ...(phase.finishedAt ? { finishedAt: phase.finishedAt } : {}),
      steps: phase.steps.map((step) => ({
        id: step.id,
        status: step.status,
        ...(step.outputs ? { outputs: step.outputs } : {}),
        ...(step.value !== undefined ? { value: step.value } : {}),
        ...(step.startedAt ? { startedAt: step.startedAt } : {}),
        ...(step.finishedAt ? { finishedAt: step.finishedAt } : {}),
        ...(step.stopFlow !== undefined ? { stopFlow: step.stopFlow } : {}),
      })),
    })),
  };
}

export function createFlowRunState(
  scopeKey: string,
  flowId: string,
  executionState: FlowExecutionState,
  jiraRef?: string | null,
  launchProfile?: ResolvedLaunchProfile,
  executionRouting?: ResolvedExecutionRouting,
  selectedRoutingPreset?: SelectedExecutionPreset,
): FlowRunState {
  const effectiveExecutionRouting = executionRouting ?? (launchProfile ? singleLaunchProfileExecutionRouting(launchProfile) : undefined);
  const effectiveLaunchProfile = launchProfile ?? effectiveExecutionRouting?.defaultRoute;
  return {
    schemaVersion: FLOW_STATE_SCHEMA_VERSION,
    flowId,
    scopeKey,
    ...(jiraRef ? { jiraRef } : {}),
    status: "pending",
    currentStep: null,
    updatedAt: nowIso8601(),
    ...(effectiveLaunchProfile ? { launchProfile: effectiveLaunchProfile } : {}),
    ...(effectiveExecutionRouting ? { executionRouting: effectiveExecutionRouting, routingFingerprint: effectiveExecutionRouting.fingerprint } : {}),
    ...(selectedRoutingPreset ? { selectedRoutingPreset } : {}),
    executionState: stripExecutionStatePayload(executionState),
  };
}

function upgradeFlowRunStateV1(state: FlowRunStateV1): FlowRunState {
  const executionRouting = state.launchProfile ? singleLaunchProfileExecutionRouting(state.launchProfile) : undefined;
  return {
    ...state,
    schemaVersion: FLOW_STATE_SCHEMA_VERSION,
    ...(executionRouting ? { executionRouting, routingFingerprint: executionRouting.fingerprint } : {}),
    ...(executionRouting ? { selectedRoutingPreset: { kind: "custom", label: "Legacy launch profile" } as const } : {}),
  };
}

function normalizeFlowRunState(raw: unknown, flowId: string, filePath: string): FlowRunState {
  if (!raw || typeof raw !== "object") {
    throw new TaskRunnerError(`Invalid flow state file format: ${filePath}`);
  }

  const schemaVersion = (raw as { schemaVersion?: unknown }).schemaVersion;
  let state: FlowRunState;
  if (schemaVersion === 1) {
    state = upgradeFlowRunStateV1(raw as FlowRunStateV1);
  } else if (schemaVersion === FLOW_STATE_SCHEMA_VERSION) {
    state = raw as FlowRunState;
  } else {
    throw new TaskRunnerError(`Unsupported flow state schema in ${filePath}: ${String(schemaVersion ?? "unknown")}`);
  }

  if (state.flowId !== flowId) {
    throw new TaskRunnerError(`Flow state ${filePath} belongs to flow '${state.flowId}', expected '${flowId}'`);
  }

  if (state.executionRouting) {
    const executionRouting = resolveStoredExecutionRoutingSnapshot(state.executionRouting);
    state.executionRouting = executionRouting;
    state.routingFingerprint = executionRouting.fingerprint;
    state.launchProfile = executionRouting.defaultRoute;
  } else if (state.launchProfile) {
    const executionRouting = singleLaunchProfileExecutionRouting(state.launchProfile);
    state.executionRouting = executionRouting;
    state.routingFingerprint = executionRouting.fingerprint;
  }

  return state;
}

export function loadFlowRunState(scopeKey: string, flowId: string): FlowRunState | null {
  const filePath = flowStateFile(scopeKey, flowId);
  if (!existsSync(filePath)) {
    return null;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new TaskRunnerError(`Failed to parse flow state file ${filePath}: ${(error as Error).message}`);
  }
  return normalizeFlowRunState(raw, flowId, filePath);
}

export function saveFlowRunState(state: FlowRunState): void {
  state.updatedAt = nowIso8601();
  state.schemaVersion = FLOW_STATE_SCHEMA_VERSION;
  if (state.executionRouting) {
    state.executionRouting = resolveStoredExecutionRoutingSnapshot(state.executionRouting);
    state.routingFingerprint = state.executionRouting.fingerprint;
    state.launchProfile = state.executionRouting.defaultRoute;
  } else if (state.launchProfile) {
    state.executionRouting = singleLaunchProfileExecutionRouting(state.launchProfile);
    state.routingFingerprint = state.executionRouting.fingerprint;
  }
  ensureScopeWorkspaceDir(state.scopeKey);
  writeFileSync(
    flowStateFile(state.scopeKey, state.flowId),
    `${JSON.stringify(
      {
        ...state,
        executionState: stripExecutionStatePayload(state.executionState),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

export function resetFlowRunState(scopeKey: string, flowId: string): boolean {
  const filePath = flowStateFile(scopeKey, flowId);
  if (!existsSync(filePath)) {
    return false;
  }
  rmSync(filePath);
  return true;
}

export function hasResumableFlowState(state: FlowRunState | null): boolean {
  if (!state) {
    return false;
  }
  if (state.executionState.terminated) {
    return false;
  }
  if (state.status === "completed") {
    return false;
  }
  if (state.status === "running" || state.status === "blocked") {
    return true;
  }
  return state.executionState.phases.some((phase) =>
    phase.steps.some((step) => step.status === "done" || step.status === "running"),
  );
}

function normalizeStepState(step: ExpandedStepExecutionState): ExpandedStepExecutionState {
  if (step.status !== "running") {
    return step;
  }
  const { finishedAt: _finishedAt, outputs: _outputs, value: _value, stopFlow: _stopFlow, ...rest } = step;
  return {
    ...rest,
    status: "pending",
  };
}

function normalizePhaseState(phase: ExpandedPhaseExecutionState): ExpandedPhaseExecutionState {
  const normalizedSteps = phase.steps.map(normalizeStepState);
  if (phase.status !== "running") {
    return {
      ...phase,
      steps: normalizedSteps,
    };
  }
  const { finishedAt: _finishedAt, ...rest } = phase;
  return {
    ...rest,
    status: "pending",
    steps: normalizedSteps,
  };
}

function createPendingPhaseState(phase: ExpandedPhaseSpec): ExpandedPhaseExecutionState {
  return {
    id: phase.id,
    status: "pending",
    repeatVars: { ...phase.repeatVars },
    steps: phase.steps.map((step) => ({
      id: step.id,
      status: "pending" as const,
    })),
  };
}

export function rewindFlowRunStateToPhase(
  state: FlowRunState,
  orderedPhases: ExpandedPhaseSpec[],
  targetPhaseId: string,
): FlowRunState {
  const targetIndex = orderedPhases.findIndex((phase) => phase.id === targetPhaseId);
  if (targetIndex < 0) {
    throw new TaskRunnerError(`Unknown flow phase '${targetPhaseId}'.`);
  }

  const existingPhaseStates = new Map(state.executionState.phases.map((phase) => [phase.id, phase]));
  const rewoundPhases: ExpandedPhaseExecutionState[] = [];

  for (const [index, phase] of orderedPhases.entries()) {
    if (index < targetIndex) {
      const existingPhaseState = existingPhaseStates.get(phase.id);
      if (!existingPhaseState) {
        throw new TaskRunnerError(
          `Cannot restart from phase '${targetPhaseId}' because earlier phase '${phase.id}' has no persisted execution state.`,
        );
      }
      if (existingPhaseState.status !== "done" && existingPhaseState.status !== "skipped") {
        throw new TaskRunnerError(
          `Cannot restart from phase '${targetPhaseId}' because earlier phase '${phase.id}' is not completed in persisted state.`,
        );
      }
      rewoundPhases.push(existingPhaseState);
      continue;
    }
    rewoundPhases.push(createPendingPhaseState(phase));
  }

  state.status = "pending";
  state.currentStep = null;
  state.lastError = null;
  state.executionState = {
    ...state.executionState,
    terminated: false,
    phases: rewoundPhases,
  };
  delete state.executionState.terminationReason;
  return state;
}

export function prepareFlowStateForResume(state: FlowRunState): FlowRunState {
  state.status = "pending";
  state.lastError = null;
  state.currentStep = null;
  state.executionState = {
    ...state.executionState,
    terminated: false,
    phases: state.executionState.phases.map(normalizePhaseState),
  };
  delete state.executionState.terminationReason;
  return state;
}
