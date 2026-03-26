import { existsSync, readFileSync } from "node:fs";

import { TaskRunnerError } from "./errors.js";

export type StructuredArtifactSchemaId =
  | "bug-analysis/v1"
  | "bug-fix-design/v1"
  | "bug-fix-plan/v1";

type ValidationIssue = string;

type ValidationContext = {
  path: string;
  value: unknown;
};

type StructuredArtifactSchema = {
  id: StructuredArtifactSchemaId;
  validate: (context: ValidationContext) => ValidationIssue[];
};

export type StructuredArtifactCheck = {
  path: string;
  schemaId: StructuredArtifactSchemaId;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectNonEmptyString(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(`${path} must be a non-empty string`);
  }
}

function expectStringArray(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array`);
    return;
  }
  if (value.length === 0) {
    issues.push(`${path} must not be empty`);
    return;
  }
  value.forEach((item, index) => expectNonEmptyString(item, `${path}[${index}]`, issues));
}

function expectObject(value: unknown, path: string, issues: ValidationIssue[]): value is Record<string, unknown> {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return false;
  }
  return true;
}

function bugAnalysisSchema(): StructuredArtifactSchema {
  return {
    id: "bug-analysis/v1",
    validate({ path, value }) {
      const issues: ValidationIssue[] = [];
      if (!expectObject(value, path, issues)) {
        return issues;
      }
      expectNonEmptyString(value.summary, `${path}.summary`, issues);
      if (expectObject(value.suspected_root_cause, `${path}.suspected_root_cause`, issues)) {
        expectNonEmptyString(value.suspected_root_cause.hypothesis, `${path}.suspected_root_cause.hypothesis`, issues);
        expectNonEmptyString(value.suspected_root_cause.confidence, `${path}.suspected_root_cause.confidence`, issues);
      }
      expectStringArray(value.reproduction_steps, `${path}.reproduction_steps`, issues);
      expectStringArray(value.affected_components, `${path}.affected_components`, issues);
      expectStringArray(value.evidence, `${path}.evidence`, issues);
      expectStringArray(value.risks, `${path}.risks`, issues);
      if (!Array.isArray(value.open_questions)) {
        issues.push(`${path}.open_questions must be an array`);
      } else {
        value.open_questions.forEach((item, index) => expectNonEmptyString(item, `${path}.open_questions[${index}]`, issues));
      }
      return issues;
    },
  };
}

function bugFixDesignSchema(): StructuredArtifactSchema {
  return {
    id: "bug-fix-design/v1",
    validate({ path, value }) {
      const issues: ValidationIssue[] = [];
      if (!expectObject(value, path, issues)) {
        return issues;
      }
      expectNonEmptyString(value.summary, `${path}.summary`, issues);
      expectStringArray(value.goals, `${path}.goals`, issues);
      if (!Array.isArray(value.non_goals)) {
        issues.push(`${path}.non_goals must be an array`);
      } else {
        value.non_goals.forEach((item, index) => expectNonEmptyString(item, `${path}.non_goals[${index}]`, issues));
      }
      expectStringArray(value.target_components, `${path}.target_components`, issues);
      if (!Array.isArray(value.proposed_changes)) {
        issues.push(`${path}.proposed_changes must be an array`);
      } else if (value.proposed_changes.length === 0) {
        issues.push(`${path}.proposed_changes must not be empty`);
      } else {
        value.proposed_changes.forEach((item, index) => {
          if (!expectObject(item, `${path}.proposed_changes[${index}]`, issues)) {
            return;
          }
          expectNonEmptyString(item.component, `${path}.proposed_changes[${index}].component`, issues);
          expectNonEmptyString(item.change, `${path}.proposed_changes[${index}].change`, issues);
          expectNonEmptyString(item.rationale, `${path}.proposed_changes[${index}].rationale`, issues);
        });
      }
      if (!Array.isArray(value.alternatives_considered)) {
        issues.push(`${path}.alternatives_considered must be an array`);
      } else {
        value.alternatives_considered.forEach((item, index) => {
          if (!expectObject(item, `${path}.alternatives_considered[${index}]`, issues)) {
            return;
          }
          expectNonEmptyString(item.option, `${path}.alternatives_considered[${index}].option`, issues);
          expectNonEmptyString(item.decision, `${path}.alternatives_considered[${index}].decision`, issues);
          expectNonEmptyString(item.rationale, `${path}.alternatives_considered[${index}].rationale`, issues);
        });
      }
      expectStringArray(value.risks, `${path}.risks`, issues);
      expectStringArray(value.validation_strategy, `${path}.validation_strategy`, issues);
      return issues;
    },
  };
}

function bugFixPlanSchema(): StructuredArtifactSchema {
  return {
    id: "bug-fix-plan/v1",
    validate({ path, value }) {
      const issues: ValidationIssue[] = [];
      if (!expectObject(value, path, issues)) {
        return issues;
      }
      expectNonEmptyString(value.summary, `${path}.summary`, issues);
      if (!Array.isArray(value.prerequisites)) {
        issues.push(`${path}.prerequisites must be an array`);
      } else {
        value.prerequisites.forEach((item, index) => expectNonEmptyString(item, `${path}.prerequisites[${index}]`, issues));
      }
      if (!Array.isArray(value.implementation_steps)) {
        issues.push(`${path}.implementation_steps must be an array`);
      } else if (value.implementation_steps.length === 0) {
        issues.push(`${path}.implementation_steps must not be empty`);
      } else {
        value.implementation_steps.forEach((item, index) => {
          if (!expectObject(item, `${path}.implementation_steps[${index}]`, issues)) {
            return;
          }
          expectNonEmptyString(item.id, `${path}.implementation_steps[${index}].id`, issues);
          expectNonEmptyString(item.title, `${path}.implementation_steps[${index}].title`, issues);
          expectNonEmptyString(item.details, `${path}.implementation_steps[${index}].details`, issues);
        });
      }
      expectStringArray(value.tests, `${path}.tests`, issues);
      if (!Array.isArray(value.rollout_notes)) {
        issues.push(`${path}.rollout_notes must be an array`);
      } else {
        value.rollout_notes.forEach((item, index) => expectNonEmptyString(item, `${path}.rollout_notes[${index}]`, issues));
      }
      return issues;
    },
  };
}

const schemas: Record<StructuredArtifactSchemaId, StructuredArtifactSchema> = {
  "bug-analysis/v1": bugAnalysisSchema(),
  "bug-fix-design/v1": bugFixDesignSchema(),
  "bug-fix-plan/v1": bugFixPlanSchema(),
};

export function validateStructuredArtifact(path: string, schemaId: StructuredArtifactSchemaId): void {
  if (!existsSync(path)) {
    throw new TaskRunnerError(`Structured artifact file not found: ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new TaskRunnerError(`Structured artifact ${path} is not valid JSON: ${(error as Error).message}`);
  }
  const issues = schemas[schemaId].validate({ path, value: parsed });
  if (issues.length > 0) {
    throw new TaskRunnerError(`Structured artifact ${path} failed schema ${schemaId} validation:\n${issues.join("\n")}`);
  }
}

export function validateStructuredArtifacts(items: StructuredArtifactCheck[], message: string): void {
  try {
    items.forEach((item) => validateStructuredArtifact(item.path, item.schemaId));
  } catch (error) {
    throw new TaskRunnerError(`${message}\n${(error as Error).message}`);
  }
}
