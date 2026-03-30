import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TaskRunnerError } from "./errors.js";

export const STRUCTURED_ARTIFACT_SCHEMA_IDS = [
  "bug-analysis/v1",
  "bug-fix-design/v1",
  "bug-fix-plan/v1",
  "gitlab-review/v1",
  "implementation-design/v1",
  "implementation-plan/v1",
  "jira-description/v1",
  "mr-description/v1",
  "qa-plan/v1",
  "review-findings/v1",
  "review-fix-report/v1",
  "review-reply/v1",
  "task-summary/v1",
  "user-input/v1",
] as const;

export type StructuredArtifactSchemaId = (typeof STRUCTURED_ARTIFACT_SCHEMA_IDS)[number];

type ValidationIssue = string;

type StructuredArtifactSchemaNode =
  | {
      anyOf: StructuredArtifactSchemaNode[];
      type?: never;
    }
  | {
      type: "string";
      nonEmpty?: boolean;
      anyOf?: never;
    }
  | {
      type: "boolean" | "number" | "null";
      anyOf?: never;
    }
  | {
      type: "array";
      items: StructuredArtifactSchemaNode;
      minItems?: number;
      anyOf?: never;
    }
  | {
      type: "object";
      properties?: Record<string, StructuredArtifactSchemaNode>;
      required?: string[];
      anyOf?: never;
    };

type StructuredArtifactSchemaRegistry = Record<StructuredArtifactSchemaId, StructuredArtifactSchemaNode>;

export type StructuredArtifactCheck = {
  path: string;
  schemaId: StructuredArtifactSchemaId;
};

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_REGISTRY_PATH = path.join(MODULE_DIR, "structured-artifact-schemas.json");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaLabel(node: StructuredArtifactSchemaNode): string {
  if ("anyOf" in node) {
    return "a valid value";
  }
  switch (node.type) {
    case "string":
      return node.nonEmpty ? "a non-empty string" : "a string";
    case "boolean":
      return "a boolean";
    case "number":
      return "a number";
    case "null":
      return "null";
    case "array":
      return "an array";
    case "object":
      return "an object";
  }
}

function validateNode(value: unknown, schema: StructuredArtifactSchemaNode, currentPath: string): ValidationIssue[] {
  if ("anyOf" in schema) {
    let bestIssues: ValidationIssue[] | null = null;
    for (const option of schema.anyOf) {
      const issues = validateNode(value, option, currentPath);
      if (issues.length === 0) {
        return [];
      }
      if (bestIssues === null || issues.length < bestIssues.length) {
        bestIssues = issues;
      }
    }
    return bestIssues ?? [`${currentPath} must be ${schemaLabel(schema)}`];
  }

  switch (schema.type) {
    case "string":
      if (typeof value !== "string" || (schema.nonEmpty && value.trim().length === 0)) {
        return [`${currentPath} must be ${schemaLabel(schema)}`];
      }
      return [];
    case "boolean":
      return typeof value === "boolean" ? [] : [`${currentPath} must be a boolean`];
    case "number":
      return typeof value === "number" && !Number.isNaN(value) ? [] : [`${currentPath} must be a number`];
    case "null":
      return value === null ? [] : [`${currentPath} must be null`];
    case "array": {
      if (!Array.isArray(value)) {
        return [`${currentPath} must be an array`];
      }
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        return [schema.minItems === 1 ? `${currentPath} must not be empty` : `${currentPath} must contain at least ${schema.minItems} items`];
      }
      return value.flatMap((item, index) => validateNode(item, schema.items, `${currentPath}[${index}]`));
    }
    case "object": {
      if (!isRecord(value)) {
        return [`${currentPath} must be an object`];
      }

      const issues: ValidationIssue[] = [];
      const properties = schema.properties ?? {};
      const required = new Set(schema.required ?? []);

      for (const propertyName of required) {
        issues.push(...validateNode(value[propertyName], properties[propertyName] ?? { type: "object" }, `${currentPath}.${propertyName}`));
      }

      for (const [propertyName, propertySchema] of Object.entries(properties)) {
        if (required.has(propertyName) || !(propertyName in value)) {
          continue;
        }
        issues.push(...validateNode(value[propertyName], propertySchema, `${currentPath}.${propertyName}`));
      }

      return issues;
    }
  }
}

function loadSchemaRegistry(): StructuredArtifactSchemaRegistry {
  if (!existsSync(SCHEMA_REGISTRY_PATH)) {
    throw new TaskRunnerError(`Structured artifact schema registry not found: ${SCHEMA_REGISTRY_PATH}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(SCHEMA_REGISTRY_PATH, "utf8"));
  } catch (error) {
    throw new TaskRunnerError(`Failed to parse structured artifact schema registry: ${(error as Error).message}`);
  }

  if (!isRecord(parsed)) {
    throw new TaskRunnerError(`Structured artifact schema registry ${SCHEMA_REGISTRY_PATH} must be a JSON object.`);
  }

  return parsed as StructuredArtifactSchemaRegistry;
}

const schemas = loadSchemaRegistry();

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

  const schema = schemas[schemaId];
  if (!schema) {
    throw new TaskRunnerError(`Structured artifact schema is not registered: ${schemaId}`);
  }

  const issues = validateNode(parsed, schema, path);
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
