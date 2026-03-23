import { TaskRunnerError } from "../errors.js";
import { readFileSync } from "node:fs";
import type { JsonValue } from "../executors/types.js";
import { runNodeChecks } from "./checks.js";
import { runNodeByKind } from "./node-runner.js";
import { renderPrompt } from "./prompt-runtime.js";
import type {
  ExpectationSpec,
  ExpandedPhaseExecutionState,
  ExpandedPhaseSpec,
  ExpandedStepExecutionState,
  FlowExecutionState,
  StepAfterActionSpec,
} from "./spec-types.js";
import type { NodeCheckSpec, PipelineContext } from "./types.js";
import { evaluateCondition, resolveParams, resolveValue, type DeclarativeResolverContext } from "./value-resolver.js";

export type DeclarativePhaseRunResult = {
  id: string;
  status: "done" | "skipped" | "stopped";
  stopped: boolean;
  executionState: FlowExecutionState;
  steps: Array<{
    id: string;
    status: "done" | "skipped";
    outputs?: Record<string, JsonValue>;
  }>;
};

export type DeclarativePhaseRunOptions = {
  onStepStart?: (phase: ExpandedPhaseSpec, step: { id: string }) => void | Promise<void>;
  executionState?: FlowExecutionState;
  flowKind?: string;
  flowVersion?: number;
};

function nowIso8601(): string {
  return new Date().toISOString();
}

function toJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((candidate) => toJsonValue(candidate));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, candidate]) => [key, toJsonValue(candidate)]),
    );
  }
  return String(value);
}

function ensureExecutionState(options: DeclarativePhaseRunOptions): FlowExecutionState {
  if (options.executionState) {
    return options.executionState;
  }
  return {
    flowKind: options.flowKind ?? "declarative-flow",
    flowVersion: options.flowVersion ?? 1,
    terminated: false,
    phases: [],
  };
}

function ensurePhaseState(executionState: FlowExecutionState, phase: ExpandedPhaseSpec): ExpandedPhaseExecutionState {
  let phaseState = executionState.phases.find((candidate) => candidate.id === phase.id);
  if (!phaseState) {
    phaseState = {
      id: phase.id,
      status: "pending",
      repeatVars: { ...phase.repeatVars },
      steps: phase.steps.map<ExpandedStepExecutionState>((step) => ({
        id: step.id,
        status: "pending",
      })),
    };
    executionState.phases.push(phaseState);
  }
  return phaseState;
}

function toStepOutputs(value: unknown): Record<string, JsonValue> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, candidate]) => [key, toJsonValue(candidate)]),
  );
}

function createResolverContext(
  pipelineContext: PipelineContext,
  flowParams: Record<string, unknown>,
  flowConstants: Record<string, unknown>,
  repeatVars: Record<string, unknown>,
  executionState?: FlowExecutionState,
): DeclarativeResolverContext {
  return {
    flowParams,
    flowConstants,
    pipelineContext,
    repeatVars,
    ...(executionState ? { executionState } : {}),
  };
}

function resolveExpectation(expectation: ExpectationSpec, context: DeclarativeResolverContext): NodeCheckSpec {
  if (expectation.kind === "require-artifacts") {
    const value = resolveValue(expectation.paths, context);
    if (!Array.isArray(value) || value.some((candidate) => typeof candidate !== "string")) {
      throw new TaskRunnerError("Expectation 'require-artifacts' must resolve to string[]");
    }
    return {
      kind: "require-artifacts",
      paths: value as string[],
      message: expectation.message,
    };
  }
  if (expectation.kind === "require-file") {
    const value = resolveValue(expectation.path, context);
    if (typeof value !== "string") {
      throw new TaskRunnerError("Expectation 'require-file' must resolve to string");
    }
    return {
      kind: "require-file",
      path: value,
      message: expectation.message,
    };
  }
  if (expectation.kind === "step-output") {
    const value = resolveValue(expectation.value, context);
    if (expectation.equals !== undefined) {
      const expected = resolveValue(expectation.equals, context);
      if (value !== expected) {
        throw new TaskRunnerError(expectation.message);
      }
      return {
        kind: "require-file",
        path: "",
        message: expectation.message,
      };
    }
    if (!value) {
      throw new TaskRunnerError(expectation.message);
    }
    return {
      kind: "require-file",
      path: "",
      message: expectation.message,
    };
  }
  throw new TaskRunnerError(`Unsupported expectation kind: ${(expectation as { kind?: string }).kind ?? "unknown"}`);
}

function runAfterAction(action: StepAfterActionSpec, pipelineContext: PipelineContext, context: DeclarativeResolverContext): void {
  if (action.kind === "set-summary-from-file") {
    const value = resolveValue(action.path, context);
    if (typeof value !== "string") {
      throw new TaskRunnerError("After action 'set-summary-from-file' must resolve to string path");
    }
    pipelineContext.setSummary?.(readFileSync(value, "utf8").trim());
    return;
  }
  throw new TaskRunnerError(`Unsupported after action kind: ${(action as { kind?: string }).kind ?? "unknown"}`);
}

export async function runExpandedPhase(
  phase: ExpandedPhaseSpec,
  pipelineContext: PipelineContext,
  flowParams: Record<string, unknown>,
  flowConstants: Record<string, unknown>,
  options: DeclarativePhaseRunOptions = {},
): Promise<DeclarativePhaseRunResult> {
  const executionState = ensureExecutionState(options);
  const phaseState = ensurePhaseState(executionState, phase);
  const phaseContext = createResolverContext(pipelineContext, flowParams, flowConstants, phase.repeatVars, executionState);
  if (executionState.terminated) {
    phaseState.status = "skipped";
    return {
      id: phase.id,
      status: "skipped",
      stopped: true,
      executionState,
      steps: phase.steps.map((step) => ({ id: step.id, status: "skipped" as const })),
    };
  }
  if (!evaluateCondition(phase.when, phaseContext)) {
    phaseState.status = "skipped";
    phaseState.startedAt ??= nowIso8601();
    phaseState.finishedAt = nowIso8601();
    phaseState.steps.forEach((step) => {
      step.status = "skipped";
      step.finishedAt = nowIso8601();
    });
    return {
      id: phase.id,
      status: "skipped",
      stopped: false,
      executionState,
      steps: phase.steps.map((step) => ({ id: step.id, status: "skipped" as const })),
    };
  }

  phaseState.status = "running";
  phaseState.startedAt ??= nowIso8601();
  const steps: DeclarativePhaseRunResult["steps"] = [];
  for (const [stepIndex, step] of phase.steps.entries()) {
    await options.onStepStart?.(phase, step);
    const stepContext = createResolverContext(pipelineContext, flowParams, flowConstants, step.repeatVars, executionState);
    const stepState = phaseState.steps[stepIndex];
    if (!stepState) {
      throw new TaskRunnerError(`Missing execution state for step '${step.id}' in phase '${phase.id}'`);
    }
    stepState.status = "running";
    stepState.startedAt ??= nowIso8601();
    if (!evaluateCondition(step.when, stepContext)) {
      stepState.status = "skipped";
      stepState.finishedAt = nowIso8601();
      steps.push({ id: step.id, status: "skipped" });
      continue;
    }
    const params = resolveParams(step.params, stepContext);
    if (step.prompt) {
      params.prompt = renderPrompt(step.prompt, stepContext);
    }
    const result = await runNodeByKind(step.node, pipelineContext, params, { skipChecks: step.expect !== undefined });
    stepState.value = toJsonValue(result.value);
    const stepOutputs = toStepOutputs(result.value);
    if (stepOutputs) {
      stepState.outputs = stepOutputs;
    } else {
      delete stepState.outputs;
    }
    if (step.expect) {
      const nodeChecks = step.expect
        .filter((expectation) => evaluateCondition(expectation.when, stepContext))
        .flatMap((expectation) => {
          if (expectation.kind === "step-output") {
            resolveExpectation(expectation, stepContext);
            return [];
          }
          return [resolveExpectation(expectation, stepContext)];
        });
      runNodeChecks(nodeChecks);
    }
    if (step.after) {
      step.after.filter((action) => evaluateCondition(action.when, stepContext)).forEach((action) => {
        runAfterAction(action, pipelineContext, stepContext);
      });
    }
    const stopFlow = step.stopFlowIf ? evaluateCondition(step.stopFlowIf, stepContext) : false;
    stepState.status = "done";
    stepState.finishedAt = nowIso8601();
    stepState.stopFlow = stopFlow;
    steps.push({ id: step.id, status: "done", ...(stepState.outputs ? { outputs: stepState.outputs } : {}) });
    if (stopFlow) {
      executionState.terminated = true;
      executionState.terminationReason = `Stopped by ${phase.id}:${step.id}`;
      phaseState.status = "done";
      phaseState.finishedAt = nowIso8601();
      return {
        id: phase.id,
        status: "stopped",
        stopped: true,
        executionState,
        steps,
      };
    }
  }

  phaseState.status = "done";
  phaseState.finishedAt = nowIso8601();
  return {
    id: phase.id,
    status: "done",
    stopped: false,
    executionState,
    steps,
  };
}

export function findPhaseById(phases: ExpandedPhaseSpec[], phaseId: string): ExpandedPhaseSpec {
  const phase = phases.find((candidate) => candidate.id === phaseId);
  if (!phase) {
    throw new TaskRunnerError(`Unknown expanded phase id: ${phaseId}`);
  }
  return phase;
}
