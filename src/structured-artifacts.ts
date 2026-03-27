import { existsSync, readFileSync } from "node:fs";

import { TaskRunnerError } from "./errors.js";

export type StructuredArtifactSchemaId =
  | "bug-analysis/v1"
  | "bug-fix-design/v1"
  | "bug-fix-plan/v1"
  | "implementation-design/v1"
  | "implementation-plan/v1"
  | "jira-description/v1"
  | "mr-description/v1"
  | "qa-plan/v1"
  | "review-findings/v1"
  | "review-fix-report/v1"
  | "review-reply/v1"
  | "task-summary/v1";

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

function expectBoolean(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (typeof value !== "boolean") {
    issues.push(`${path} must be a boolean`);
  }
}

function expectObject(value: unknown, path: string, issues: ValidationIssue[]): value is Record<string, unknown> {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return false;
  }
  return true;
}

function expectStringArray(value: unknown, path: string, issues: ValidationIssue[], allowEmpty = false): void {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array`);
    return;
  }
  if (!allowEmpty && value.length === 0) {
    issues.push(`${path} must not be empty`);
    return;
  }
  value.forEach((item, index) => expectNonEmptyString(item, `${path}[${index}]`, issues));
}

function expectObjectArray(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  validateItem: (item: Record<string, unknown>, itemPath: string, issues: ValidationIssue[]) => void,
  allowEmpty = false,
): void {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array`);
    return;
  }
  if (!allowEmpty && value.length === 0) {
    issues.push(`${path} must not be empty`);
    return;
  }
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!expectObject(item, itemPath, issues)) {
      return;
    }
    validateItem(item, itemPath, issues);
  });
}

function validateBriefText(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!expectObject(value, path, issues)) {
    return;
  }
  expectNonEmptyString(value.summary, `${path}.summary`, issues);
}

function implementationDesignSchema(): StructuredArtifactSchema {
  return {
    id: "implementation-design/v1",
    validate({ path, value }) {
      const issues: ValidationIssue[] = [];
      if (!expectObject(value, path, issues)) {
        return issues;
      }
      expectNonEmptyString(value.summary, `${path}.summary`, issues);
      expectStringArray(value.goals, `${path}.goals`, issues);
      expectStringArray(value.non_goals, `${path}.non_goals`, issues, true);
      expectStringArray(value.components, `${path}.components`, issues);
      expectObjectArray(value.decisions, `${path}.decisions`, issues, (item, itemPath, currentIssues) => {
        expectNonEmptyString(item.component, `${itemPath}.component`, currentIssues);
        expectNonEmptyString(item.decision, `${itemPath}.decision`, currentIssues);
        expectNonEmptyString(item.rationale, `${itemPath}.rationale`, currentIssues);
      });
      expectStringArray(value.risks, `${path}.risks`, issues, true);
      expectStringArray(value.open_questions, `${path}.open_questions`, issues, true);
      return issues;
    },
  };
}

function implementationPlanSchema(): StructuredArtifactSchema {
  return {
    id: "implementation-plan/v1",
    validate({ path, value }) {
      const issues: ValidationIssue[] = [];
      if (!expectObject(value, path, issues)) {
        return issues;
      }
      expectNonEmptyString(value.summary, `${path}.summary`, issues);
      expectStringArray(value.prerequisites, `${path}.prerequisites`, issues, true);
      expectObjectArray(value.implementation_steps, `${path}.implementation_steps`, issues, (item, itemPath, currentIssues) => {
        expectNonEmptyString(item.id, `${itemPath}.id`, currentIssues);
        expectNonEmptyString(item.title, `${itemPath}.title`, currentIssues);
        expectNonEmptyString(item.details, `${itemPath}.details`, currentIssues);
      });
      expectStringArray(value.tests, `${path}.tests`, issues);
      expectStringArray(value.rollout_notes, `${path}.rollout_notes`, issues, true);
      return issues;
    },
  };
}

function qaPlanSchema(): StructuredArtifactSchema {
  return {
    id: "qa-plan/v1",
    validate({ path, value }) {
      const issues: ValidationIssue[] = [];
      if (!expectObject(value, path, issues)) {
        return issues;
      }
      expectNonEmptyString(value.summary, `${path}.summary`, issues);
      expectObjectArray(value.test_scenarios, `${path}.test_scenarios`, issues, (item, itemPath, currentIssues) => {
        expectNonEmptyString(item.id, `${itemPath}.id`, currentIssues);
        expectNonEmptyString(item.title, `${itemPath}.title`, currentIssues);
        expectNonEmptyString(item.expected_result, `${itemPath}.expected_result`, currentIssues);
      });
      expectStringArray(value.non_functional_checks, `${path}.non_functional_checks`, issues, true);
      return issues;
    },
  };
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
      expectStringArray(value.risks, `${path}.risks`, issues, true);
      expectStringArray(value.open_questions, `${path}.open_questions`, issues, true);
      return issues;
    },
  };
}

function bugFixDesignSchema(): StructuredArtifactSchema {
  return {
    id: "bug-fix-design/v1",
    validate: implementationDesignSchema().validate,
  };
}

function bugFixPlanSchema(): StructuredArtifactSchema {
  return {
    id: "bug-fix-plan/v1",
    validate: implementationPlanSchema().validate,
  };
}

function reviewFindingsSchema(): StructuredArtifactSchema {
  return {
    id: "review-findings/v1",
    validate({ path, value }) {
      const issues: ValidationIssue[] = [];
      if (!expectObject(value, path, issues)) {
        return issues;
      }
      expectNonEmptyString(value.summary, `${path}.summary`, issues);
      expectBoolean(value.ready_to_merge, `${path}.ready_to_merge`, issues);
      expectObjectArray(value.findings, `${path}.findings`, issues, (item, itemPath, currentIssues) => {
        expectNonEmptyString(item.severity, `${itemPath}.severity`, currentIssues);
        expectNonEmptyString(item.title, `${itemPath}.title`, currentIssues);
        expectNonEmptyString(item.description, `${itemPath}.description`, currentIssues);
      }, true);
      return issues;
    },
  };
}

function reviewReplySchema(): StructuredArtifactSchema {
  return {
    id: "review-reply/v1",
    validate({ path, value }) {
      const issues: ValidationIssue[] = [];
      if (!expectObject(value, path, issues)) {
        return issues;
      }
      expectNonEmptyString(value.summary, `${path}.summary`, issues);
      expectObjectArray(value.responses, `${path}.responses`, issues, (item, itemPath, currentIssues) => {
        expectNonEmptyString(item.finding_title, `${itemPath}.finding_title`, currentIssues);
        expectNonEmptyString(item.disposition, `${itemPath}.disposition`, currentIssues);
        expectNonEmptyString(item.action, `${itemPath}.action`, currentIssues);
      }, true);
      expectBoolean(value.ready_to_merge, `${path}.ready_to_merge`, issues);
      return issues;
    },
  };
}

function reviewFixReportSchema(): StructuredArtifactSchema {
  return {
    id: "review-fix-report/v1",
    validate({ path, value }) {
      const issues: ValidationIssue[] = [];
      if (!expectObject(value, path, issues)) {
        return issues;
      }
      expectNonEmptyString(value.summary, `${path}.summary`, issues);
      expectStringArray(value.completed_actions, `${path}.completed_actions`, issues);
      expectStringArray(value.validation_steps, `${path}.validation_steps`, issues, true);
      return issues;
    },
  };
}

const schemas: Record<StructuredArtifactSchemaId, StructuredArtifactSchema> = {
  "bug-analysis/v1": bugAnalysisSchema(),
  "bug-fix-design/v1": bugFixDesignSchema(),
  "bug-fix-plan/v1": bugFixPlanSchema(),
  "implementation-design/v1": implementationDesignSchema(),
  "implementation-plan/v1": implementationPlanSchema(),
  "jira-description/v1": { id: "jira-description/v1", validate: ({ path, value }) => {
    const issues: ValidationIssue[] = [];
    validateBriefText(value, path, issues);
    return issues;
  } },
  "mr-description/v1": { id: "mr-description/v1", validate: ({ path, value }) => {
    const issues: ValidationIssue[] = [];
    validateBriefText(value, path, issues);
    return issues;
  } },
  "qa-plan/v1": qaPlanSchema(),
  "review-findings/v1": reviewFindingsSchema(),
  "review-fix-report/v1": reviewFixReportSchema(),
  "review-reply/v1": reviewReplySchema(),
  "task-summary/v1": { id: "task-summary/v1", validate: ({ path, value }) => {
    const issues: ValidationIssue[] = [];
    validateBriefText(value, path, issues);
    return issues;
  } },
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
