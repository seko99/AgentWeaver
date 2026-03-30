import type { JsonValue } from "../executors/types.js";
import type { StructuredArtifactSchemaId } from "../structured-artifacts.js";
import type { NodeKind } from "./node-registry.js";
import type { PromptTemplateRef } from "./prompt-registry.js";

export type ValueSpec =
  | { const: JsonValue }
  | { ref: string }
  | { artifact: ArtifactRefSpec }
  | { artifactList: ArtifactListRefSpec }
  | { template: string; vars?: Record<string, ValueSpec> }
  | { appendPrompt: { base?: ValueSpec; suffix: ValueSpec } }
  | { concat: ValueSpec[] }
  | { list: ValueSpec[] };

export type ArtifactRefSpec = {
  kind:
    | "bug-analyze-file"
    | "bug-analyze-json-file"
    | "bug-fix-design-file"
    | "bug-fix-design-json-file"
    | "bug-fix-plan-file"
    | "bug-fix-plan-json-file"
    | "design-file"
    | "design-json-file"
    | "gitlab-review-file"
    | "gitlab-review-input-json-file"
    | "gitlab-review-json-file"
    | "jira-description-file"
    | "jira-description-json-file"
    | "jira-task-file"
    | "mr-description-file"
    | "mr-description-json-file"
    | "plan-file"
    | "plan-json-file"
    | "qa-file"
    | "qa-json-file"
    | "ready-to-merge-file"
    | "review-file"
    | "review-json-file"
    | "review-fix-file"
    | "review-fix-json-file"
    | "review-reply-file"
    | "review-reply-json-file"
    | "run-go-linter-result-json-file"
    | "review-reply-summary-file"
    | "review-summary-file"
    | "task-summary-file"
    | "task-summary-json-file";
  taskKey: ValueSpec;
  iteration?: ValueSpec;
};

export type ArtifactListRefSpec = {
  kind: "bug-analyze-artifacts" | "plan-artifacts";
  taskKey: ValueSpec;
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
  when?: ConditionSpec;
  prompt?: PromptBindingSpec;
  params?: Record<string, ValueSpec>;
  expect?: ExpectationSpec[];
  stopFlowIf?: ConditionSpec;
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
  when?: ConditionSpec;
  prompt?: PromptBindingSpec;
  params?: Record<string, ValueSpec>;
  expect?: ExpectationSpec[];
  stopFlowIf?: ConditionSpec;
  after?: StepAfterActionSpec[];
  repeatVars: Record<string, JsonValue>;
};

export type ExpandedStepExecutionState = {
  id: string;
  status: "pending" | "running" | "done" | "skipped";
  outputs?: Record<string, JsonValue>;
  value?: JsonValue;
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
  flowKind: string;
  flowVersion: number;
  terminated: boolean;
  terminationReason?: string;
  phases: ExpandedPhaseExecutionState[];
};
