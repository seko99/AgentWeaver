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
    designJsonFile,
    gitlabDiffFile,
    gitlabDiffJsonFile,
    gitlabDiffReviewInputJsonFile,
    gitlabReviewFile,
    gitlabReviewInputJsonFile,
    gitlabReviewJsonFile,
  jiraAttachmentsContextFile,
  jiraAttachmentsManifestFile,
  jiraDescriptionFile,
  jiraDescriptionJsonFile,
  jiraTaskFile,
  mrDescriptionFile,
  mrDescriptionJsonFile,
  planningAnswersJsonFile,
  planningQuestionsJsonFile,
  planArtifacts,
  planFile,
  planJsonFile,
  qaFile,
  qaJsonFile,
  readyToMergeFile,
  reviewFile,
  reviewFixFile,
  reviewFixJsonFile,
  reviewJsonFile,
  runGoLinterResultJsonFile,
  runGoTestsResultJsonFile,
  taskSummaryFile,
  taskDescribeInputJsonFile,
  taskSummaryJsonFile,
  gitStatusJsonFile,
  gitCommitMessageJsonFile,
  gitCommitInputJsonFile,
  gitDiffFile as gitDiffFileHelper,
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
      return bugAnalyzeFile(taskKey, iteration);
    case "bug-analyze-json-file":
      return bugAnalyzeJsonFile(taskKey, iteration);
    case "bug-fix-design-file":
      return bugFixDesignFile(taskKey, iteration);
    case "bug-fix-design-json-file":
      return bugFixDesignJsonFile(taskKey, iteration);
    case "bug-fix-plan-file":
      return bugFixPlanFile(taskKey, iteration);
    case "bug-fix-plan-json-file":
      return bugFixPlanJsonFile(taskKey, iteration);
    case "design-file":
      return designFile(taskKey, iteration);
    case "design-json-file":
      return designJsonFile(taskKey, iteration);
    case "gitlab-diff-file":
      return gitlabDiffFile(taskKey, iteration);
    case "gitlab-diff-json-file":
      return gitlabDiffJsonFile(taskKey, iteration);
    case "gitlab-diff-review-input-json-file":
      return gitlabDiffReviewInputJsonFile(taskKey);
    case "gitlab-review-file":
      return gitlabReviewFile(taskKey, iteration);
    case "gitlab-review-input-json-file":
      return gitlabReviewInputJsonFile(taskKey);
    case "gitlab-review-json-file":
      return gitlabReviewJsonFile(taskKey, iteration);
    case "jira-attachments-context-file":
      return jiraAttachmentsContextFile(taskKey);
    case "jira-attachments-manifest-file":
      return jiraAttachmentsManifestFile(taskKey);
    case "jira-description-file":
      return jiraDescriptionFile(taskKey, iteration);
    case "jira-description-json-file":
      return jiraDescriptionJsonFile(taskKey, iteration);
    case "jira-task-file":
      return jiraTaskFile(taskKey);
    case "mr-description-file":
      return mrDescriptionFile(taskKey, iteration);
    case "mr-description-json-file":
      return mrDescriptionJsonFile(taskKey, iteration);
    case "planning-answers-json-file":
      return planningAnswersJsonFile(taskKey);
    case "planning-questions-json-file":
      return planningQuestionsJsonFile(taskKey);
    case "plan-file":
      return planFile(taskKey, iteration);
    case "plan-json-file":
      return planJsonFile(taskKey, iteration);
    case "qa-file":
      return qaFile(taskKey, iteration);
    case "qa-json-file":
      return qaJsonFile(taskKey, iteration);
    case "ready-to-merge-file":
      return readyToMergeFile(taskKey);
    case "review-file":
      if (iteration === undefined) {
        throw new TaskRunnerError("review-file requires iteration");
      }
      return reviewFile(taskKey, iteration);
    case "review-json-file":
      if (iteration === undefined) {
        throw new TaskRunnerError("review-json-file requires iteration");
      }
      return reviewJsonFile(taskKey, iteration);
    case "review-fix-file":
      if (iteration === undefined) {
        throw new TaskRunnerError("review-fix-file requires iteration");
      }
      return reviewFixFile(taskKey, iteration);
    case "review-fix-json-file":
      if (iteration === undefined) {
        throw new TaskRunnerError("review-fix-json-file requires iteration");
      }
      return reviewFixJsonFile(taskKey, iteration);
    case "run-go-linter-result-json-file":
      if (iteration === undefined) {
        throw new TaskRunnerError("run-go-linter-result-json-file requires iteration");
      }
      return runGoLinterResultJsonFile(taskKey, iteration);
    case "run-go-tests-result-json-file":
      if (iteration === undefined) {
        throw new TaskRunnerError("run-go-tests-result-json-file requires iteration");
      }
      return runGoTestsResultJsonFile(taskKey, iteration);
    case "review-summary-file":
      if (iteration === undefined) {
        throw new TaskRunnerError("review-summary-file requires iteration");
      }
      return artifactFile("review-summary", taskKey, iteration);
    case "task-summary-file":
      return taskSummaryFile(taskKey, iteration);
    case "task-summary-json-file":
      return taskSummaryJsonFile(taskKey, iteration);
    case "task-describe-input-json-file":
      return taskDescribeInputJsonFile(taskKey);
    case "git-status-json-file":
      return gitStatusJsonFile(taskKey);
    case "git-diff-file":
      return gitDiffFileHelper(taskKey);
    case "git-commit-message-json-file":
      return gitCommitMessageJsonFile(taskKey);
    case "git-commit-input-json-file":
      return gitCommitInputJsonFile(taskKey);
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
  if ("add" in value) {
    return value.add.reduce((sum, candidate) => sum + Number(resolveValue(candidate, context)), 0);
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
