import { existsSync, readFileSync } from "node:fs";

import { TaskRunnerError } from "./errors.js";
import {
  STRUCTURED_ARTIFACT_SCHEMA_IDS,
  getStructuredArtifactSchema,
  type StructuredArtifactSchemaId,
  type StructuredArtifactSchemaNode,
} from "./structured-artifact-schema-registry.js";

export { STRUCTURED_ARTIFACT_SCHEMA_IDS };
export type { StructuredArtifactSchemaId } from "./structured-artifact-schema-registry.js";

type ValidationIssue = string;

export type StructuredArtifactCheck = {
  path: string;
  schemaId: StructuredArtifactSchemaId;
};

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

  const schema = getStructuredArtifactSchema(schemaId);

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
