import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { buildLogicalKeyForPayload, type ArtifactLineageInput } from "../artifact-manifest.js";
import { TaskRunnerError } from "../errors.js";
import type { JsonValue } from "../executors/types.js";
import type { PublishedArtifactRecord } from "../runtime/artifact-registry.js";
import { runNodeChecks } from "./checks.js";
import { runNodeByKind } from "./node-runner.js";
import { renderPrompt, resolvePromptBindingInputs } from "./prompt-runtime.js";
import type {
  ExpectationSpec,
  ExpandedPhaseExecutionState,
  ExpandedPhaseSpec,
  ExpandedStepExecutionState,
  FlowExecutionState,
  StepAfterActionSpec,
} from "./spec-types.js";
import type { NodeCheckSpec, NodeOutputSpec, PipelineContext } from "./types.js";
import {
  collectResolvedArtifactPathCandidates,
  collectResolvedPromptArtifactPathCandidates,
  evaluateCondition,
  resolveParams,
  resolveValue,
  type DeclarativeResolverContext,
} from "./value-resolver.js";

export type DeclarativePhaseRunResult = {
  id: string;
  status: "done" | "skipped" | "stopped";
  stopped: boolean;
  executionState: FlowExecutionState;
  steps: Array<{
    id: string;
    status: "done" | "skipped";
    outputs?: Record<string, JsonValue>;
    publishedArtifacts?: PublishedArtifactRecord[];
  }>;
};

export type DeclarativePhaseRunOptions = {
  onStepStart?: (phase: ExpandedPhaseSpec, step: { id: string }) => void | Promise<void>;
  onStateChange?: (executionState: FlowExecutionState) => void | Promise<void>;
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
    options.executionState.runId ??= randomUUID();
    options.executionState.publicationRunId ??= randomUUID();
    return options.executionState;
  }
  return {
    runId: randomUUID(),
    publicationRunId: randomUUID(),
    flowKind: options.flowKind ?? "declarative-flow",
    flowVersion: options.flowVersion ?? 1,
    terminated: false,
    terminationOutcome: "success",
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
  if (expectation.kind === "require-structured-artifacts") {
    return {
      kind: "require-structured-artifacts",
      items: expectation.items.map((item) => {
        const value = resolveValue(item.path, context);
        if (typeof value !== "string") {
          throw new TaskRunnerError("Expectation 'require-structured-artifacts' item path must resolve to string");
        }
        return {
          path: value,
          schemaId: item.schemaId,
        };
      }),
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

function shouldPublishManifest(output: NodeOutputSpec): boolean {
  return output.manifest?.publish === true;
}

function resolveOutputLogicalKey(scopeKey: string, output: NodeOutputSpec): string {
  return output.manifest?.logicalKey ?? buildLogicalKeyForPayload(scopeKey, output.path);
}

function validateDistinctLogicalKeys(scopeKey: string, phaseId: string, stepId: string, outputs: NodeOutputSpec[]): void {
  const pathsByLogicalKey = new Map<string, string>();
  for (const output of outputs) {
    const logicalKey = resolveOutputLogicalKey(scopeKey, output);
    const existingPath = pathsByLogicalKey.get(logicalKey);
    if (existingPath && existingPath !== output.path) {
      throw new TaskRunnerError(
        `Step '${phaseId}:${stepId}' produced duplicate logical_key '${logicalKey}' for outputs '${existingPath}' and '${output.path}'.`,
      );
    }
    pathsByLogicalKey.set(logicalKey, output.path);
  }
}

function producerMetadata(resultValue: unknown): { executor?: string; model?: string } {
  if (!resultValue || typeof resultValue !== "object" || Array.isArray(resultValue)) {
    return {};
  }
  const record = resultValue as Record<string, unknown>;
  return {
    ...(typeof record["executor"] === "string" ? { executor: record["executor"] } : {}),
    ...(typeof record["model"] === "string" ? { model: record["model"] } : {}),
  };
}

function collectNestedPublishedArtifacts(resultValue: unknown): PublishedArtifactRecord[] {
  if (!resultValue || typeof resultValue !== "object" || Array.isArray(resultValue)) {
    return [];
  }
  const rawArtifacts = (resultValue as Record<string, unknown>)["publishedArtifacts"];
  if (!Array.isArray(rawArtifacts)) {
    return [];
  }
  return rawArtifacts.filter((artifact): artifact is PublishedArtifactRecord => {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
      return false;
    }
    const record = artifact as Record<string, unknown>;
    return typeof record["artifact_id"] === "string" && typeof record["payload_path"] === "string";
  });
}

function mergePublishedArtifacts(...groups: PublishedArtifactRecord[][]): PublishedArtifactRecord[] {
  const merged: PublishedArtifactRecord[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const artifact of group) {
      const key = artifact.artifact_id;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(artifact);
    }
  }
  return merged;
}

function normalizeCandidatePath(value: string): string {
  return path.resolve(value);
}

function collectLineageInputs(
  values: unknown[],
  artifactPaths: Iterable<string>,
  pipelineContext: PipelineContext,
  excludedPaths: Iterable<string> = [],
): ArtifactLineageInput[] {
  const seen = new Set<string>();
  const inputs: ArtifactLineageInput[] = [];
  const excluded = new Set(Array.from(excludedPaths, (candidate) => normalizeCandidatePath(candidate)));

  const addInput = (input: ArtifactLineageInput): void => {
    if (excluded.has(normalizeCandidatePath(input.path))) {
      return;
    }
    const key = `${input.source}:${input.artifact_id ?? ""}:${normalizeCandidatePath(input.path)}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    inputs.push(input);
  };

  for (const artifactPath of artifactPaths) {
    addInput(pipelineContext.runtime.artifactRegistry.resolveLineageInputFromPath(pipelineContext.issueKey, artifactPath));
  }

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item));
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record["artifact_id"] === "string" && typeof record["payload_path"] === "string") {
      const payloadPath = String(record["payload_path"]);
      if (!excluded.has(normalizeCandidatePath(payloadPath))) {
        addInput({
          source: "manifest",
          path: payloadPath,
          artifact_id: String(record["artifact_id"]),
          ...(typeof record["logical_key"] === "string" ? { logical_key: String(record["logical_key"]) } : {}),
          ...(typeof record["schema_id"] === "string" ? { schema_id: String(record["schema_id"]) } : {}),
          ...(typeof record["schema_version"] === "number" ? { schema_version: Number(record["schema_version"]) } : {}),
        });
      }
    }
    for (const candidate of Object.values(record)) {
      visit(candidate);
    }
  };

  values.forEach((value) => visit(value));
  return inputs.sort((left, right) => left.path.localeCompare(right.path));
}

function mergeLineageInputs(...groups: ArtifactLineageInput[][]): ArtifactLineageInput[] {
  const seen = new Set<string>();
  const merged: ArtifactLineageInput[] = [];
  for (const group of groups) {
    for (const input of group) {
      const key = `${input.source}:${input.artifact_id ?? ""}:${normalizeCandidatePath(input.path)}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(input);
    }
  }
  return merged.sort((left, right) => left.path.localeCompare(right.path));
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
  if (phaseState.status === "done") {
    await options.onStateChange?.(executionState);
    return {
      id: phase.id,
      status: "done",
      stopped: false,
      executionState,
      steps: phase.steps.map((step, stepIndex) => ({
        id: step.id,
        status: phaseState.steps[stepIndex]?.status === "skipped" ? "skipped" : "done",
        ...(phaseState.steps[stepIndex]?.outputs ? { outputs: phaseState.steps[stepIndex]?.outputs } : {}),
        ...(phaseState.steps[stepIndex]?.publishedArtifacts
          ? { publishedArtifacts: phaseState.steps[stepIndex]?.publishedArtifacts }
          : {}),
      })),
    };
  }
  if (phaseState.status === "skipped") {
    await options.onStateChange?.(executionState);
    return {
      id: phase.id,
      status: "skipped",
      stopped: false,
      executionState,
      steps: phase.steps.map((step) => ({ id: step.id, status: "skipped" as const })),
    };
  }
  if (executionState.terminated) {
    phaseState.status = "skipped";
    await options.onStateChange?.(executionState);
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
    await options.onStateChange?.(executionState);
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
  await options.onStateChange?.(executionState);
  const steps: DeclarativePhaseRunResult["steps"] = [];
  for (const [stepIndex, step] of phase.steps.entries()) {
    await options.onStepStart?.(phase, step);
    const stepContext = createResolverContext(pipelineContext, flowParams, flowConstants, step.repeatVars, executionState);
    const stepState = phaseState.steps[stepIndex];
    if (!stepState) {
      throw new TaskRunnerError(`Missing execution state for step '${step.id}' in phase '${phase.id}'`);
    }
    if (stepState.status === "done" || stepState.status === "skipped") {
      steps.push({
        id: step.id,
        status: stepState.status,
        ...(stepState.outputs ? { outputs: stepState.outputs } : {}),
        ...(stepState.publishedArtifacts ? { publishedArtifacts: stepState.publishedArtifacts } : {}),
      });
      continue;
    }
    stepState.status = "running";
    stepState.startedAt ??= nowIso8601();
    await options.onStateChange?.(executionState);
    if (!evaluateCondition(step.when, stepContext)) {
      stepState.status = "skipped";
      stepState.finishedAt = nowIso8601();
      await options.onStateChange?.(executionState);
      steps.push({ id: step.id, status: "skipped" });
      continue;
    }
    const params = resolveParams(step.params, stepContext);
    if (step.routingGroup) {
      params.routingGroup = step.routingGroup;
    }
    const promptInputs = step.prompt ? resolvePromptBindingInputs(step.prompt, stepContext) : {};
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
    const publishedArtifacts: PublishedArtifactRecord[] = [];
    const nestedPublishedArtifacts = collectNestedPublishedArtifacts(result.value);
    const publishableOutputs = (result.outputs ?? []).filter((output) => shouldPublishManifest(output));
    if (!pipelineContext.dryRun && publishableOutputs.length > 0) {
      const resolvedPublishableOutputs: NodeOutputSpec[] = [];
      for (const output of publishableOutputs) {
        if (!existsSync(output.path)) {
          if (!output.required) {
            continue;
          }
          throw new TaskRunnerError(`Cannot publish manifest for missing output ${output.path}.`);
        }
        resolvedPublishableOutputs.push(output);
      }
      validateDistinctLogicalKeys(pipelineContext.issueKey, phase.id, step.id, resolvedPublishableOutputs);
      const publishedOutputPaths = resolvedPublishableOutputs.map((output) => output.path);
      const lineageInputs = collectLineageInputs(
        [result.value],
        [
          ...Object.values(step.params ?? {}).flatMap((value) => collectResolvedArtifactPathCandidates(value, stepContext)),
          ...collectResolvedPromptArtifactPathCandidates(step.prompt, stepContext),
        ],
        pipelineContext,
        publishedOutputPaths,
      );
      for (const output of resolvedPublishableOutputs) {
        publishedArtifacts.push(
          pipelineContext.runtime.artifactRegistry.publish({
            scopeKey: pipelineContext.issueKey,
            runId: executionState.runId ?? randomUUID(),
            publicationRunId: executionState.publicationRunId ?? randomUUID(),
            flowId: executionState.flowKind,
            phaseId: phase.id,
            stepId: step.id,
            nodeKind: step.node,
            nodeVersion: 1,
            kind: output.kind,
            payloadPath: output.path,
            ...(output.manifest?.logicalKey ? { logicalKey: output.manifest.logicalKey } : {}),
            ...(output.manifest?.schemaId ? { schemaId: output.manifest.schemaId } : {}),
            ...(output.manifest?.schemaVersion ? { schemaVersion: output.manifest.schemaVersion } : {}),
            ...(output.manifest?.payloadFamily ? { payloadFamily: output.manifest.payloadFamily } : {}),
            inputs: mergeLineageInputs(lineageInputs, output.manifest?.inputRefs ?? []),
            ...producerMetadata(result.value),
          }),
        );
      }
    }
    const allPublishedArtifacts = mergePublishedArtifacts(publishedArtifacts, nestedPublishedArtifacts);
    const stopFlow = step.stopFlowIf ? evaluateCondition(step.stopFlowIf, stepContext) : false;
    stepState.status = "done";
    stepState.finishedAt = nowIso8601();
    stepState.stopFlow = stopFlow;
    if (allPublishedArtifacts.length > 0) {
      stepState.publishedArtifacts = allPublishedArtifacts;
    } else {
      delete stepState.publishedArtifacts;
    }
    await options.onStateChange?.(executionState);
    steps.push({
      id: step.id,
      status: "done",
      ...(stepState.outputs ? { outputs: stepState.outputs } : {}),
      ...(stepState.publishedArtifacts ? { publishedArtifacts: stepState.publishedArtifacts } : {}),
    });
    if (stopFlow) {
      executionState.terminated = true;
      executionState.terminationReason = `Stopped by ${phase.id}:${step.id}`;
      executionState.terminationOutcome = step.stopFlowOutcome ?? "success";
      phaseState.status = "done";
      phaseState.finishedAt = nowIso8601();
      await options.onStateChange?.(executionState);
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
  await options.onStateChange?.(executionState);
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
