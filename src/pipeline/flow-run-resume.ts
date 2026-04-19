import type { PublishedArtifactRecord } from "../runtime/artifact-registry.js";
import type { FlowExecutionState } from "./spec-types.js";

export type FlowRunResumeEnvelope = {
  resumeKind: "flow-run";
  flowKind: string;
  flowVersion: number;
  executionState: FlowExecutionState;
  publishedArtifacts: PublishedArtifactRecord[];
};

function isFlowExecutionState(value: unknown): value is FlowExecutionState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record["flowKind"] === "string"
    && typeof record["flowVersion"] === "number"
    && typeof record["terminated"] === "boolean"
    && Array.isArray(record["phases"])
  );
}

function isPublishedArtifactRecord(value: unknown): value is PublishedArtifactRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record["artifact_id"] === "string" && typeof record["payload_path"] === "string";
}

export function isFlowRunResumeEnvelope(value: unknown): value is FlowRunResumeEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record["resumeKind"] === "flow-run"
    && typeof record["flowKind"] === "string"
    && typeof record["flowVersion"] === "number"
    && isFlowExecutionState(record["executionState"])
    && Array.isArray(record["publishedArtifacts"])
    && record["publishedArtifacts"].every((artifact) => isPublishedArtifactRecord(artifact))
  );
}
