import path from "node:path";

import { TaskRunnerError } from "./errors.js";
import { validateStructuredArtifactValue, type StructuredArtifactSchemaId } from "./structured-artifacts.js";

export const ARTIFACT_MANIFEST_SCHEMA_ID = "artifact-manifest/v1";
export const ARTIFACT_MANIFEST_SCHEMA_VERSION = 1;

export const ARTIFACT_LIFECYCLE_STATUSES = ["ready", "superseded", "stale"] as const;
export type ArtifactLifecycleStatus = (typeof ARTIFACT_LIFECYCLE_STATUSES)[number];

export const ARTIFACT_PAYLOAD_FAMILIES = [
  "structured-json",
  "markdown",
  "plain-text",
  "helper-json",
  "opaque-file",
] as const;
export type ArtifactPayloadFamily = (typeof ARTIFACT_PAYLOAD_FAMILIES)[number];

export type ArtifactManifestDiagnostic = {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
};

export type ArtifactProducer = {
  node: string;
  executor?: string;
  model?: string;
  summary?: string;
};

export type ArtifactLineageInput = {
  source: "manifest" | "external-path";
  path: string;
  artifact_id?: string;
  logical_key?: string;
  schema_id?: string;
  schema_version?: number;
};

export type ArtifactManifest = {
  artifact_id: string;
  logical_key: string;
  scope: string;
  run_id: string;
  flow_id: string;
  phase_id: string;
  step_id: string;
  kind: "artifact" | "file";
  version: number;
  payload_family: ArtifactPayloadFamily;
  schema_id: string;
  schema_version: number;
  created_at: string;
  producer: ArtifactProducer;
  inputs: ArtifactLineageInput[];
  content_hash: string;
  status: ArtifactLifecycleStatus;
  payload_path: string;
  manifest_path: string;
  publication_key: string;
  supersedes?: string;
  status_reason?: string;
  diagnostics?: ArtifactManifestDiagnostic[];
};

export type ArtifactIndexRecord = {
  artifact_id: string;
  logical_key: string;
  payload_path: string;
  manifest_path: string;
  version: number;
  status: ArtifactLifecycleStatus;
  schema_id: string;
  schema_version: number;
  created_at: string;
  content_hash: string;
  producer_summary: string;
  supersedes?: string;
  is_latest: boolean;
};

export type PayloadContract = {
  payloadFamily: ArtifactPayloadFamily;
  schemaId: string;
  schemaVersion: number;
};

const STRUCTURED_JSON_SCHEMAS_BY_PREFIX: Array<{ prefix: string; schemaId: StructuredArtifactSchemaId }> = [
  { prefix: "bug-analyze-", schemaId: "bug-analysis/v1" },
  { prefix: "bug-fix-design-", schemaId: "bug-fix-design/v1" },
  { prefix: "bug-fix-plan-", schemaId: "bug-fix-plan/v1" },
  { prefix: "design-review-", schemaId: "design-review/v1" },
  { prefix: "design-", schemaId: "implementation-design/v1" },
  { prefix: "gitlab-diff-", schemaId: "gitlab-mr-diff/v1" },
  { prefix: "gitlab-review-", schemaId: "gitlab-review/v1" },
  { prefix: "jira-description-", schemaId: "jira-description/v1" },
  { prefix: "mr-description-", schemaId: "mr-description/v1" },
  { prefix: "plan-", schemaId: "implementation-plan/v1" },
  { prefix: "planning-questions-", schemaId: "planning-questions/v1" },
  { prefix: "qa-", schemaId: "qa-plan/v1" },
  { prefix: "review-assessment-", schemaId: "review-assessment/v1" },
  { prefix: "review-fix-", schemaId: "review-fix-report/v1" },
  { prefix: "review-", schemaId: "review-findings/v1" },
  { prefix: "task-", schemaId: "task-summary/v1" },
];

const LOGICAL_KEY_PATTERN = "^[a-z0-9][a-z0-9._/-]*$";
const CONTENT_HASH_PATTERN = "^sha256:[a-f0-9]{64}$";

export function parseSchemaVersion(schemaId: string): number {
  const match = /\/v(\d+)$/.exec(schemaId);
  return match ? Number.parseInt(match[1] ?? "1", 10) : 1;
}

function normalizePathSeparators(value: string): string {
  return value.replace(/\\/g, "/");
}

function removeScopeSuffix(baseName: string, scopeKey?: string | null): string {
  if (!scopeKey) {
    return baseName;
  }
  const ext = path.extname(baseName);
  const stem = ext ? baseName.slice(0, -ext.length) : baseName;
  const escapedScope = scopeKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`-${escapedScope}-iter-\\d+$`),
    new RegExp(`-${escapedScope}-\\d+$`),
    new RegExp(`-${escapedScope}$`),
  ];
  for (const pattern of patterns) {
    if (pattern.test(stem)) {
      return `${stem.replace(pattern, "")}${ext}`;
    }
  }
  if (stem === scopeKey) {
    return `scope${ext}`;
  }
  return baseName;
}

export function buildLogicalKeyForPayload(scopeKey: string | undefined, payloadPath: string): string {
  const normalized = normalizePathSeparators(payloadPath);
  const normalizedScopeKey = typeof scopeKey === "string" && scopeKey.trim().length > 0 ? scopeKey : null;
  const scopeMarker = normalizedScopeKey
    ? normalizePathSeparators(`/.agentweaver/scopes/${normalizedScopeKey}/`)
    : null;
  const markerIndex = scopeMarker ? normalized.lastIndexOf(scopeMarker) : -1;
  const artifactsMarker = normalizePathSeparators("/.artifacts/");
  const artifactsIndex = normalized.lastIndexOf(artifactsMarker);
  const relative = markerIndex >= 0 && scopeMarker
    ? normalized.slice(markerIndex + scopeMarker.length)
    : artifactsIndex >= 0
      ? normalized.slice(artifactsIndex + 1)
    : path.basename(normalized);
  const directory = path.posix.dirname(relative);
  const baseName = path.posix.basename(relative);
  const normalizedBaseName = removeScopeSuffix(baseName, normalizedScopeKey)
    .replace(/-\d+(?=\.[^.]+$)/, "")
    .replace(/[^a-zA-Z0-9._/-]+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
  const combined = directory === "." ? normalizedBaseName : `${directory}/${normalizedBaseName}`;
  return combined.replace(/^\.artifacts\//, "artifacts/");
}

export function buildPublicationKey(input: {
  runId: string;
  publicationRunId?: string;
  flowId: string;
  phaseId: string;
  stepId: string;
  logicalKey: string;
}): string {
  return `${input.publicationRunId ?? input.runId}:${input.flowId}:${input.phaseId}:${input.stepId}:${input.logicalKey}`;
}

export function buildArtifactId(scopeKey: string, logicalKey: string, version: number): string {
  return `${scopeKey}:${logicalKey}:v${version}`;
}

export function inferPayloadContract(scopeKey: string, payloadPath: string, override?: Partial<PayloadContract>): PayloadContract {
  if (override?.payloadFamily && override.schemaId && override.schemaVersion) {
    return {
      payloadFamily: override.payloadFamily,
      schemaId: override.schemaId,
      schemaVersion: override.schemaVersion,
    };
  }

  const baseName = path.basename(payloadPath);
  if (override?.schemaId) {
    return {
      payloadFamily: override.payloadFamily ?? "structured-json",
      schemaId: override.schemaId,
      schemaVersion: override.schemaVersion ?? parseSchemaVersion(override.schemaId),
    };
  }

  if (payloadPath.endsWith(".json")) {
    if (baseName === `${scopeKey}.json` || baseName === `${scopeKey}-enriched.json`) {
      return { payloadFamily: "helper-json", schemaId: "helper-json/v1", schemaVersion: 1 };
    }
    if (baseName.startsWith("jira-attachments-")) {
      return { payloadFamily: "helper-json", schemaId: "helper-json/v1", schemaVersion: 1 };
    }
    if (baseName.startsWith("planning-answers-")) {
      return { payloadFamily: "structured-json", schemaId: "user-input/v1", schemaVersion: 1 };
    }
    for (const candidate of STRUCTURED_JSON_SCHEMAS_BY_PREFIX) {
      if (baseName.startsWith(candidate.prefix)) {
        return {
          payloadFamily: "structured-json",
          schemaId: candidate.schemaId,
          schemaVersion: parseSchemaVersion(candidate.schemaId),
        };
      }
    }
    return { payloadFamily: "helper-json", schemaId: "helper-json/v1", schemaVersion: 1 };
  }
  if (payloadPath.endsWith(".md")) {
    return { payloadFamily: "markdown", schemaId: "markdown/v1", schemaVersion: 1 };
  }
  if (payloadPath.endsWith(".txt")) {
    return { payloadFamily: "plain-text", schemaId: "plain-text/v1", schemaVersion: 1 };
  }
  return { payloadFamily: "opaque-file", schemaId: "opaque-file/v1", schemaVersion: 1 };
}

export function createProducerSummary(input: {
  node: string;
  executor?: string;
  model?: string;
}): string {
  const parts = [input.node];
  if (input.executor) {
    parts.push(`via ${input.executor}`);
  }
  if (input.model) {
    parts.push(`model ${input.model}`);
  }
  return parts.join(" ");
}

export function validateArtifactManifest(manifest: ArtifactManifest, label = "$"): void {
  validateStructuredArtifactValue(manifest, ARTIFACT_MANIFEST_SCHEMA_ID, label);
  if (!new RegExp(LOGICAL_KEY_PATTERN).test(manifest.logical_key)) {
    throw new TaskRunnerError(`Structured artifact ${label} failed schema ${ARTIFACT_MANIFEST_SCHEMA_ID} validation:\n${label}.logical_key must be a string with the expected format`);
  }
  if (!new RegExp(CONTENT_HASH_PATTERN).test(manifest.content_hash)) {
    throw new TaskRunnerError(`Structured artifact ${label} failed schema ${ARTIFACT_MANIFEST_SCHEMA_ID} validation:\n${label}.content_hash must be a string with the expected format`);
  }
}

export function diagnosticsForManifest(manifest: ArtifactManifest, validatePayload: (schemaId: string, payloadPath: string) => void): ArtifactManifestDiagnostic[] {
  try {
    validatePayload(manifest.schema_id, manifest.payload_path);
    return [];
  } catch (error) {
    const message = (error as Error).message;
    return [
      {
        code: message.includes("not registered") ? "missing-schema" : "invalid-schema",
        severity: "error",
        message,
      },
    ];
  }
}
