import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TaskRunnerError } from "./errors.js";

export const STRUCTURED_ARTIFACT_SCHEMA_IDS = [
  "artifact-manifest/v1",
  "bug-analysis/v1",
  "bug-fix-design/v1",
  "bug-fix-plan/v1",
  "design-review/v1",
  "gitlab-mr-diff/v1",
  "gitlab-review/v1",
  "implementation-design/v1",
  "implementation-plan/v1",
  "jira-description/v1",
  "mr-description/v1",
  "planning-questions/v1",
  "playbook-answers/v1",
  "playbook-draft/v1",
  "playbook-final/v1",
  "playbook-questions/v1",
  "playbook-write-result/v1",
  "practice-candidates/v1",
  "project-guidance/v1",
  "qa-plan/v1",
  "repo-inventory/v1",
  "review-assessment/v1",
  "review-findings/v1",
  "review-fix-report/v1",
  "task-context/v1",
  "task-summary/v1",
  "user-input/v1",
] as const;

export const ARTIFACT_PAYLOAD_SCHEMA_IDS = [
  ...STRUCTURED_ARTIFACT_SCHEMA_IDS,
  "helper-json/v1",
  "markdown/v1",
  "opaque-file/v1",
  "plain-text/v1",
] as const;

export type StructuredArtifactSchemaId = (typeof STRUCTURED_ARTIFACT_SCHEMA_IDS)[number];
export type ArtifactPayloadSchemaId = (typeof ARTIFACT_PAYLOAD_SCHEMA_IDS)[number];

export type StructuredArtifactSchemaNode =
  | {
      anyOf: StructuredArtifactSchemaNode[];
      type?: never;
    }
  | {
      type: "string";
      nonEmpty?: boolean;
      enum?: string[];
      pattern?: string;
      anyOf?: never;
    }
  | {
      type: "boolean" | "number" | "null";
      minimum?: number;
      anyOf?: never;
    }
  | {
      type: "bytes" | "json";
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

export type ArtifactPayloadSchemaRegistry = Record<ArtifactPayloadSchemaId, StructuredArtifactSchemaNode>;

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SCHEMA_REGISTRY_PATH = path.join(MODULE_DIR, "structured-artifact-schemas.json");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function loadStructuredArtifactSchemaRegistry(): ArtifactPayloadSchemaRegistry {
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

  return parsed as ArtifactPayloadSchemaRegistry;
}

const schemaRegistry = loadStructuredArtifactSchemaRegistry();

export function getStructuredArtifactSchema(schemaId: ArtifactPayloadSchemaId): StructuredArtifactSchemaNode {
  const schema = schemaRegistry[schemaId];
  if (!schema) {
    throw new TaskRunnerError(`Structured artifact schema is not registered: ${schemaId}`);
  }
  return schema;
}

export function renderStructuredArtifactSchema(schemaId: ArtifactPayloadSchemaId): string {
  return JSON.stringify(getStructuredArtifactSchema(schemaId), null, 2);
}
