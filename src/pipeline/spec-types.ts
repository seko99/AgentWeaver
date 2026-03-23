import type { JsonValue } from "../executors/types.js";
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
    | "design-file"
    | "jira-task-file"
    | "plan-file"
    | "qa-file"
    | "ready-to-merge-file"
    | "review-file"
    | "review-fix-file"
    | "review-reply-file"
    | "review-reply-summary-file"
    | "review-summary-file"
    | "task-summary-file";
  taskKey: ValueSpec;
  iteration?: ValueSpec;
};

export type ArtifactListRefSpec = {
  kind: "plan-artifacts";
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
      kind: "require-file";
      when?: ConditionSpec;
      path: ValueSpec;
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
  after?: StepAfterActionSpec[];
  repeatVars: Record<string, JsonValue>;
};
