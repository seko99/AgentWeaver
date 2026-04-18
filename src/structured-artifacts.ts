import { existsSync, readFileSync } from "node:fs";

import { TaskRunnerError } from "./errors.js";
import {
  ARTIFACT_PAYLOAD_SCHEMA_IDS,
  STRUCTURED_ARTIFACT_SCHEMA_IDS,
  getStructuredArtifactSchema,
  type ArtifactPayloadSchemaId,
  type StructuredArtifactSchemaId,
  type StructuredArtifactSchemaNode,
} from "./structured-artifact-schema-registry.js";

export { ARTIFACT_PAYLOAD_SCHEMA_IDS, STRUCTURED_ARTIFACT_SCHEMA_IDS };
export type { ArtifactPayloadSchemaId, StructuredArtifactSchemaId } from "./structured-artifact-schema-registry.js";

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
      if (node.enum && node.enum.length > 0) {
        return `one of: ${node.enum.join(", ")}`;
      }
      if (node.pattern) {
        return "a string with the expected format";
      }
      return node.nonEmpty ? "a non-empty string" : "a string";
    case "boolean":
      return "a boolean";
    case "bytes":
      return "a binary file";
    case "json":
      return "valid JSON";
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
      if (schema.enum && !schema.enum.includes(value)) {
        return [`${currentPath} must be ${schemaLabel(schema)}`];
      }
      if (schema.pattern) {
        try {
          const pattern = new RegExp(schema.pattern);
          if (!pattern.test(value)) {
            return [`${currentPath} must be ${schemaLabel(schema)}`];
          }
        } catch {
          return [`${currentPath} uses an invalid schema pattern`];
        }
      }
      return [];
    case "boolean":
      return typeof value === "boolean" ? [] : [`${currentPath} must be a boolean`];
    case "bytes":
      return value instanceof Uint8Array ? [] : [`${currentPath} must be a binary file`];
    case "json":
      return validateJsonValue(value, currentPath);
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

function validateJsonValue(value: unknown, currentPath: string): ValidationIssue[] {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => validateJsonValue(item, `${currentPath}[${index}]`));
  }
  if (!isRecord(value)) {
    return [`${currentPath} must be valid JSON`];
  }
  return Object.entries(value).flatMap(([key, candidate]) => validateJsonValue(candidate, `${currentPath}.${key}`));
}

function validateArtifactPayloadValue(value: unknown, schemaId: ArtifactPayloadSchemaId, label = "$"): void {
  const schema = getStructuredArtifactSchema(schemaId);
  const issues = validateNode(value, schema, label);
  if (issues.length > 0) {
    throw new TaskRunnerError(`Structured artifact ${label} failed schema ${schemaId} validation:\n${issues.join("\n")}`);
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

  validateArtifactPayloadValue(parsed, schemaId, path);
}

export function validateStructuredArtifactValue(value: unknown, schemaId: StructuredArtifactSchemaId, label = "$"): void {
  validateArtifactPayloadValue(value, schemaId, label);
}

export function isArtifactPayloadSchemaId(schemaId: string): schemaId is ArtifactPayloadSchemaId {
  return ARTIFACT_PAYLOAD_SCHEMA_IDS.includes(schemaId as ArtifactPayloadSchemaId);
}

export function validateArtifactPayload(path: string, schemaId: ArtifactPayloadSchemaId): void {
  if (!existsSync(path)) {
    throw new TaskRunnerError(`Structured artifact file not found: ${path}`);
  }

  if (schemaId === "markdown/v1" || schemaId === "plain-text/v1") {
    validateArtifactPayloadValue(readFileSync(path, "utf8"), schemaId, path);
    return;
  }

  if (schemaId === "helper-json/v1") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      throw new TaskRunnerError(`Structured artifact ${path} is not valid JSON: ${(error as Error).message}`);
    }
    validateArtifactPayloadValue(parsed, schemaId, path);
    return;
  }

  if (schemaId === "opaque-file/v1") {
    validateArtifactPayloadValue(readFileSync(path), schemaId, path);
    return;
  }

  validateStructuredArtifact(path, schemaId);
}

export function validateStructuredArtifacts(items: StructuredArtifactCheck[], message: string): void {
  try {
    items.forEach((item) => validateStructuredArtifact(item.path, item.schemaId));
  } catch (error) {
    throw new TaskRunnerError(`${message}\n${(error as Error).message}`);
  }
}
