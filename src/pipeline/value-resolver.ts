import { existsSync } from "node:fs";

import {
  artifactFile,
  bugAnalyzeArtifacts,
  bugAnalyzeFile,
  bugAnalyzeJsonFile,
  bugFixDesignFile,
  bugFixDesignJsonFile,
  bugFixPlanFile,
  bugFixPlanJsonFile,
  designFile,
  jiraDescriptionFile,
  jiraTaskFile,
  mrDescriptionFile,
  planArtifacts,
  planFile,
  qaFile,
  readyToMergeFile,
  taskSummaryFile,
} from "../artifacts.js";
import { TaskRunnerError } from "../errors.js";
import { formatTemplate } from "../prompts.js";
import type { FlowExecutionState } from "./spec-types.js";
import type { PipelineContext } from "./types.js";
import type { ArtifactListRefSpec, ArtifactRefSpec, ConditionSpec, ValueSpec } from "./spec-types.js";

type ResolverContext = {
  flowParams: Record<string, unknown>;
  flowConstants: Record<string, unknown>;
  pipelineContext: PipelineContext;
  repeatVars: Record<string, unknown>;
  executionState?: FlowExecutionState;
};

function readStepRef(segments: string[], context: ResolverContext, originalPath: string): unknown {
  const [phaseId, stepId, scope, ...rest] = segments;
  if (!phaseId || !stepId || !scope) {
    throw new TaskRunnerError(`Invalid step ref '${originalPath}'`);
  }
  const phase = context.executionState?.phases.find((candidate) => candidate.id === phaseId);
  if (!phase) {
    throw new TaskRunnerError(`Unable to resolve step ref '${originalPath}': unknown phase '${phaseId}'`);
  }
  const step = phase.steps.find((candidate) => candidate.id === stepId);
  if (!step) {
    throw new TaskRunnerError(`Unable to resolve step ref '${originalPath}': unknown step '${stepId}' in phase '${phaseId}'`);
  }
  let current: unknown;
  if (scope === "outputs") {
    current = step.outputs;
  } else if (scope === "value") {
    current = step.value;
  } else if (scope === "status") {
    current = step.status;
  } else {
    throw new TaskRunnerError(`Unsupported step ref scope in '${originalPath}'`);
  }
  for (const segment of rest) {
    if (!segment) {
      continue;
    }
    if (!current || typeof current !== "object" || !(segment in current)) {
      throw new TaskRunnerError(`Unable to resolve ref '${originalPath}'`);
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function readRef(path: string, context: ResolverContext): unknown {
  const [scope, ...rest] = path.split(".");
  if (scope === "steps") {
    return readStepRef(rest, context, path);
  }
  const root =
    scope === "params"
      ? context.flowParams
      : scope === "flow"
        ? context.flowConstants
        : scope === "context"
          ? context.pipelineContext
          : scope === "repeat"
            ? context.repeatVars
            : undefined;
  if (root === undefined) {
    throw new TaskRunnerError(`Unsupported ref scope in '${path}'`);
  }
  let current: unknown = root;
  for (const segment of rest) {
    if (!segment) {
      continue;
    }
    if (!current || typeof current !== "object" || !(segment in current)) {
      throw new TaskRunnerError(`Unable to resolve ref '${path}'`);
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function resolveArtifact(spec: ArtifactRefSpec, context: ResolverContext): string {
  const taskKey = String(resolveValue(spec.taskKey, context));
  const iteration = spec.iteration === undefined ? undefined : Number(resolveValue(spec.iteration, context));
  switch (spec.kind) {
    case "bug-analyze-file":
      return bugAnalyzeFile(taskKey);
    case "bug-analyze-json-file":
      return bugAnalyzeJsonFile(taskKey);
    case "bug-fix-design-file":
      return bugFixDesignFile(taskKey);
    case "bug-fix-design-json-file":
      return bugFixDesignJsonFile(taskKey);
    case "bug-fix-plan-file":
      return bugFixPlanFile(taskKey);
    case "bug-fix-plan-json-file":
      return bugFixPlanJsonFile(taskKey);
    case "design-file":
      return designFile(taskKey);
    case "jira-description-file":
      return jiraDescriptionFile(taskKey);
    case "jira-task-file":
      return jiraTaskFile(taskKey);
    case "mr-description-file":
      return mrDescriptionFile(taskKey);
    case "plan-file":
      return planFile(taskKey);
    case "qa-file":
      return qaFile(taskKey);
    case "ready-to-merge-file":
      return readyToMergeFile(taskKey);
    case "review-file":
      if (iteration === undefined) {
        throw new TaskRunnerError("review-file requires iteration");
      }
      return artifactFile("review", taskKey, iteration);
    case "review-fix-file":
      if (iteration === undefined) {
        throw new TaskRunnerError("review-fix-file requires iteration");
      }
      return artifactFile("review-fix", taskKey, iteration);
    case "review-reply-file":
      if (iteration === undefined) {
        throw new TaskRunnerError("review-reply-file requires iteration");
      }
      return artifactFile("review-reply", taskKey, iteration);
    case "review-reply-summary-file":
      if (iteration === undefined) {
        throw new TaskRunnerError("review-reply-summary-file requires iteration");
      }
      return artifactFile("review-reply-summary", taskKey, iteration);
    case "review-summary-file":
      if (iteration === undefined) {
        throw new TaskRunnerError("review-summary-file requires iteration");
      }
      return artifactFile("review-summary", taskKey, iteration);
    case "task-summary-file":
      return taskSummaryFile(taskKey);
  }
}

function resolveArtifactList(spec: ArtifactListRefSpec, context: ResolverContext): string[] {
  const taskKey = String(resolveValue(spec.taskKey, context));
  switch (spec.kind) {
    case "bug-analyze-artifacts":
      return bugAnalyzeArtifacts(taskKey);
    case "plan-artifacts":
      return planArtifacts(taskKey);
  }
}

export function resolveValue(value: ValueSpec, context: ResolverContext): unknown {
  if ("const" in value) {
    return value.const;
  }
  if ("ref" in value) {
    return readRef(value.ref, context);
  }
  if ("artifact" in value) {
    return resolveArtifact(value.artifact, context);
  }
  if ("artifactList" in value) {
    return resolveArtifactList(value.artifactList, context);
  }
  if ("template" in value) {
    const vars = Object.fromEntries(
      Object.entries(value.vars ?? {}).map(([key, candidate]) => [key, String(resolveValue(candidate, context))]),
    );
    return formatTemplate(value.template, vars);
  }
  if ("appendPrompt" in value) {
    const base = value.appendPrompt.base === undefined ? null : resolveValue(value.appendPrompt.base, context);
    const suffix = resolveValue(value.appendPrompt.suffix, context);
    const baseText = base === null || base === undefined ? "" : String(base).trim();
    const suffixText = String(suffix).trim();
    if (!baseText) {
      return suffixText;
    }
    if (!suffixText) {
      return baseText;
    }
    return `${baseText}\n${suffixText}`;
  }
  if ("concat" in value) {
    return value.concat
      .map((candidate) => resolveValue(candidate, context))
      .filter((chunk) => chunk !== null && chunk !== undefined)
      .map((chunk) => String(chunk))
      .join("");
  }
  if ("list" in value) {
    return value.list.map((candidate) => resolveValue(candidate, context));
  }
  throw new TaskRunnerError("Unsupported value spec");
}

export function resolveParams(
  params: Record<string, ValueSpec> | undefined,
  context: ResolverContext,
): Record<string, unknown> {
  if (!params) {
    return {};
  }
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, resolveValue(value, context)]));
}

function truthy(value: unknown): boolean {
  return Boolean(value);
}

export function evaluateCondition(condition: ConditionSpec | undefined, context: ResolverContext): boolean {
  if (!condition) {
    return true;
  }
  if ("ref" in condition) {
    return truthy(readRef(condition.ref, context));
  }
  if ("not" in condition) {
    return !evaluateCondition(condition.not, context);
  }
  if ("all" in condition) {
    return condition.all.every((candidate) => evaluateCondition(candidate, context));
  }
  if ("any" in condition) {
    return condition.any.some((candidate) => evaluateCondition(candidate, context));
  }
  if ("equals" in condition) {
    return resolveValue(condition.equals[0], context) === resolveValue(condition.equals[1], context);
  }
  if ("exists" in condition) {
    const value = resolveValue(condition.exists, context);
    if (typeof value !== "string") {
      throw new TaskRunnerError("exists condition requires string path");
    }
    return existsSync(value);
  }
  return false;
}

export type DeclarativeResolverContext = ResolverContext;
