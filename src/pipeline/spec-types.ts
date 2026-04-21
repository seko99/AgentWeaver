import type { JsonValue } from "../executors/types.js";
import type { StructuredArtifactSchemaId } from "../structured-artifacts.js";
import type { PublishedArtifactRecord } from "../runtime/artifact-registry.js";
import type { NodeKind } from "./node-registry.js";
import type { PromptTemplateRef } from "./prompt-registry.js";
import type { ExecutionRoutingGroup } from "./execution-routing-config.js";

export const ARTIFACT_REF_KINDS = [
  "bug-analyze-file",
  "bug-analyze-json-file",
  "bug-fix-design-file",
  "bug-fix-design-json-file",
  "bug-fix-plan-file",
  "bug-fix-plan-json-file",
  "design-file",
  "design-json-file",
  "design-review-file",
  "design-review-json-file",
  "gitlab-diff-file",
  "gitlab-diff-json-file",
  "gitlab-diff-review-input-json-file",
  "gitlab-review-file",
  "gitlab-review-input-json-file",
  "gitlab-review-json-file",
  "jira-attachments-context-file",
  "jira-attachments-manifest-file",
  "jira-description-file",
  "jira-description-json-file",
  "jira-task-file",
  "instant-task-input-json-file",
  "mr-description-file",
  "mr-description-json-file",
  "planning-answers-json-file",
  "planning-questions-json-file",
  "plan-file",
  "plan-json-file",
  "qa-file",
  "qa-json-file",
  "ready-to-merge-file",
  "review-file",
  "review-json-file",
  "review-assessment-file",
  "review-assessment-json-file",
  "review-fix-file",
  "review-fix-json-file",
  "run-go-linter-result-json-file",
  "run-go-tests-result-json-file",
  "review-summary-file",
  "task-context-file",
  "task-context-json-file",
  "task-summary-file",
  "task-summary-json-file",
  "task-describe-input-json-file",
  "git-status-json-file",
  "git-diff-file",
  "git-commit-message-json-file",
  "git-commit-input-json-file",
  "select-files-output-json-file",
  "commit-message-output-json-file",
] as const;

export const ARTIFACT_LIST_REF_KINDS = ["bug-analyze-artifacts", "plan-artifacts"] as const;

export type ValueSpec =
  | { const: JsonValue }
  | { ref: string }
  | { artifact: ArtifactRefSpec }
  | { artifactList: ArtifactListRefSpec }
  | { template: string; vars?: Record<string, ValueSpec> }
  | { appendPrompt: { base?: ValueSpec; suffix: ValueSpec } }
  | { add: ValueSpec[] }
  | { concat: ValueSpec[] }
  | { list: ValueSpec[] };

export type ArtifactRefSpec = {
  kind: (typeof ARTIFACT_REF_KINDS)[number];
  taskKey: ValueSpec;
  iteration?: ValueSpec;
};

export type ArtifactListRefSpec = {
  kind: (typeof ARTIFACT_LIST_REF_KINDS)[number];
  taskKey: ValueSpec;
  iteration?: ValueSpec;
};

export type ConditionSpec =
  | { ref: string }
  | { not: ConditionSpec }
  | { all: ConditionSpec[] }
  | { any: ConditionSpec[] }
  | { equals: [ValueSpec, ValueSpec] }
  | { exists: ValueSpec };

export type PromptBindingSpec = {
  templateRef?: PromptTemplateRef;
  inlineTemplate?: string;
  vars?: Record<string, ValueSpec>;
  extraPrompt?: ValueSpec;
  format?: "plain" | "task-prompt";
};

export type ExpectationSpec =
  | {
      kind: "require-artifacts";
      when?: ConditionSpec;
      paths: ValueSpec;
      message: string;
    }
  | {
      kind: "require-structured-artifacts";
      when?: ConditionSpec;
      items: Array<{
        path: ValueSpec;
        schemaId: StructuredArtifactSchemaId;
      }>;
      message: string;
    }
  | {
      kind: "require-file";
      when?: ConditionSpec;
      path: ValueSpec;
      message: string;
    }
  | {
      kind: "step-output";
      when?: ConditionSpec;
      value: ValueSpec;
      equals?: ValueSpec;
      message: string;
    };

export type StepAfterActionSpec = {
  kind: "set-summary-from-file";
  when?: ConditionSpec;
  path: ValueSpec;
};

export type DeclarativeStepSpec = {
  id: string;
  node: NodeKind;
  routingGroup?: ExecutionRoutingGroup;
  when?: ConditionSpec;
  prompt?: PromptBindingSpec;
  params?: Record<string, ValueSpec>;
  expect?: ExpectationSpec[];
  stopFlowIf?: ConditionSpec;
  stopFlowOutcome?: "success" | "stopped";
  after?: StepAfterActionSpec[];
};

export type DeclarativePhaseSpec = {
  id: string;
  when?: ConditionSpec;
  steps: DeclarativeStepSpec[];
};

export type RepeatPhaseSpec = {
  repeat: {
    var: string;
    from: number;
    to: number;
  };
  phases: DeclarativePhaseSpec[];
};

export type DeclarativeFlowSpec = {
  kind: string;
  version: number;
  description?: string;
  catalogVisibility?: "visible" | "hidden";
  constants?: Record<string, JsonValue>;
  phases: Array<DeclarativePhaseSpec | RepeatPhaseSpec>;
};

export type ExpandedPhaseSpec = {
  id: string;
  when?: ConditionSpec;
  repeatVars: Record<string, JsonValue>;
  steps: ExpandedStepSpec[];
};

export type ExpandedStepSpec = {
  id: string;
  node: NodeKind;
  routingGroup?: ExecutionRoutingGroup;
  when?: ConditionSpec;
  prompt?: PromptBindingSpec;
  params?: Record<string, ValueSpec>;
  expect?: ExpectationSpec[];
  stopFlowIf?: ConditionSpec;
  stopFlowOutcome?: "success" | "stopped";
  after?: StepAfterActionSpec[];
  repeatVars: Record<string, JsonValue>;
};

export type ExpandedStepExecutionState = {
  id: string;
  status: "pending" | "running" | "done" | "skipped";
  outputs?: Record<string, JsonValue>;
  value?: JsonValue;
  publishedArtifacts?: PublishedArtifactRecord[];
  startedAt?: string;
  finishedAt?: string;
  stopFlow?: boolean;
};

export type ExpandedPhaseExecutionState = {
  id: string;
  status: "pending" | "running" | "done" | "skipped";
  repeatVars: Record<string, JsonValue>;
  steps: ExpandedStepExecutionState[];
  startedAt?: string;
  finishedAt?: string;
};

export type FlowExecutionState = {
  runId?: string;
  publicationRunId?: string;
  flowKind: string;
  flowVersion: number;
  terminated: boolean;
  terminationReason?: string;
  terminationOutcome?: "success" | "stopped";
  phases: ExpandedPhaseExecutionState[];
};
