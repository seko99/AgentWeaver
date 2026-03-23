import { TaskRunnerError } from "../errors.js";
import { runNodeChecks } from "./checks.js";
import { runNodeByKind } from "./node-runner.js";
import { renderPrompt } from "./prompt-runtime.js";
import type { ExpectationSpec, ExpandedPhaseSpec } from "./spec-types.js";
import type { NodeCheckSpec, PipelineContext } from "./types.js";
import { evaluateCondition, resolveParams, resolveValue, type DeclarativeResolverContext } from "./value-resolver.js";

export type DeclarativePhaseRunResult = {
  id: string;
  status: "done" | "skipped";
  steps: Array<{
    id: string;
    status: "done" | "skipped";
  }>;
};

export type DeclarativePhaseRunOptions = {
  onStepStart?: (phase: ExpandedPhaseSpec, step: { id: string }) => void | Promise<void>;
};

function createResolverContext(
  pipelineContext: PipelineContext,
  flowParams: Record<string, unknown>,
  flowConstants: Record<string, unknown>,
  repeatVars: Record<string, unknown>,
): DeclarativeResolverContext {
  return {
    flowParams,
    flowConstants,
    pipelineContext,
    repeatVars,
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
  throw new TaskRunnerError(`Unsupported expectation kind: ${(expectation as { kind?: string }).kind ?? "unknown"}`);
}

export async function runExpandedPhase(
  phase: ExpandedPhaseSpec,
  pipelineContext: PipelineContext,
  flowParams: Record<string, unknown>,
  flowConstants: Record<string, unknown>,
  options: DeclarativePhaseRunOptions = {},
): Promise<DeclarativePhaseRunResult> {
  const phaseContext = createResolverContext(pipelineContext, flowParams, flowConstants, phase.repeatVars);
  if (!evaluateCondition(phase.when, phaseContext)) {
    return {
      id: phase.id,
      status: "skipped",
      steps: phase.steps.map((step) => ({ id: step.id, status: "skipped" as const })),
    };
  }

  const steps: DeclarativePhaseRunResult["steps"] = [];
  for (const step of phase.steps) {
    await options.onStepStart?.(phase, step);
    const stepContext = createResolverContext(pipelineContext, flowParams, flowConstants, step.repeatVars);
    if (!evaluateCondition(step.when, stepContext)) {
      steps.push({ id: step.id, status: "skipped" });
      continue;
    }
    const params = resolveParams(step.params, stepContext);
    if (step.prompt) {
      params.prompt = renderPrompt(step.prompt, stepContext);
    }
    await runNodeByKind(step.node, pipelineContext, params, { skipChecks: step.expect !== undefined });
    if (step.expect) {
      runNodeChecks(
        step.expect
          .filter((expectation) => evaluateCondition(expectation.when, stepContext))
          .map((expectation) => resolveExpectation(expectation, stepContext)),
      );
    }
    steps.push({ id: step.id, status: "done" });
  }

  return {
    id: phase.id,
    status: "done",
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
