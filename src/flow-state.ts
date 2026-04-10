import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { ensureScopeWorkspaceDir, flowStateFile } from "./artifacts.js";
import { TaskRunnerError } from "./errors.js";
import type { ResolvedLaunchProfile } from "./pipeline/launch-profile-config.js";
import type {
  ExpandedPhaseExecutionState,
  ExpandedPhaseSpec,
  ExpandedStepExecutionState,
  FlowExecutionState,
} from "./pipeline/spec-types.js";

const FLOW_STATE_SCHEMA_VERSION = 1;

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
  executionState: FlowExecutionState;
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
): FlowRunState {
  return {
    schemaVersion: FLOW_STATE_SCHEMA_VERSION,
    flowId,
    scopeKey,
    ...(jiraRef ? { jiraRef } : {}),
    status: "pending",
    currentStep: null,
    updatedAt: nowIso8601(),
    ...(launchProfile ? { launchProfile } : {}),
    executionState: stripExecutionStatePayload(executionState),
  };
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

  if (!raw || typeof raw !== "object") {
    throw new TaskRunnerError(`Invalid flow state file format: ${filePath}`);
  }

  const state = raw as FlowRunState;
  if (state.schemaVersion !== FLOW_STATE_SCHEMA_VERSION) {
    throw new TaskRunnerError(`Unsupported flow state schema in ${filePath}: ${state.schemaVersion}`);
  }
  if (state.flowId !== flowId) {
    throw new TaskRunnerError(`Flow state ${filePath} belongs to flow '${state.flowId}', expected '${flowId}'`);
  }
  return state;
}

export function saveFlowRunState(state: FlowRunState): void {
  state.updatedAt = nowIso8601();
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
