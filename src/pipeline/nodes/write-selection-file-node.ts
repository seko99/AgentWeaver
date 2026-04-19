import { writeFileSync } from "node:fs";

import { readFileSync } from "node:fs";
import { buildLogicalKeyForPayload } from "../../artifact-manifest.js";
import { TaskRunnerError } from "../../errors.js";
import { normalizeReviewSeverity, resolveBlockingReviewSeverities } from "../../review-severity.js";
import type { PipelineNodeDefinition } from "../types.js";

export type WriteSelectionFileNodeParams = {
  outputFile: string;
  reviewFindingsJsonFile: string;
  selectionMode: "auto-blocking-severities";
  blockingSeverities?: string[] | null;
};

export type WriteSelectionFileNodeResult = {
  outputFile: string;
  findingsCount: number;
  selectedFindings: string[];
  applyAll: boolean;
};

type ReviewFinding = {
  severity?: unknown;
  title?: unknown;
  description?: unknown;
  disposition?: unknown;
};

type ReviewFindingsArtifact = {
  findings?: ReviewFinding[];
};

export const writeSelectionFileNode: PipelineNodeDefinition<WriteSelectionFileNodeParams, WriteSelectionFileNodeResult> = {
  kind: "write-selection-file",
  version: 1,
  async run(_context, params) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(params.reviewFindingsJsonFile, "utf8"));
    } catch (error) {
      throw new TaskRunnerError(
        `Failed to read review findings from ${params.reviewFindingsJsonFile}: ${(error as Error).message}`,
      );
    }

    const reviewFindings = parsed as ReviewFindingsArtifact;
    const findings = Array.isArray(reviewFindings.findings) ? reviewFindings.findings : [];
    const blockingSeverities = resolveBlockingReviewSeverities(params.blockingSeverities);
    const selectedFindings = findings
      .filter((finding) => {
        const severity = normalizeReviewSeverity(finding.severity);
        const disposition = typeof finding.disposition === "string" ? finding.disposition.trim().toLowerCase() : null;
        return severity !== null && blockingSeverities.includes(severity) && disposition !== "resolved";
      })
      .map((finding) => finding.title)
      .filter((title): title is string => typeof title === "string" && title.trim().length > 0);

    const applyAll = false;
    const artifact = {
      form_id: "review-fix-selection",
      submitted_at: new Date().toISOString(),
      values: {
        apply_all: applyAll,
        selected_findings: selectedFindings,
        extra_notes: "",
      },
    };

    writeFileSync(params.outputFile, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

    return {
      value: {
        outputFile: params.outputFile,
        findingsCount: selectedFindings.length,
        selectedFindings,
        applyAll,
      },
      outputs: [
        {
          kind: "artifact",
          path: params.outputFile,
          required: true,
          manifest: {
            publish: true,
            logicalKey: buildLogicalKeyForPayload(_context.issueKey, params.outputFile),
            payloadFamily: "structured-json",
            schemaId: "user-input/v1",
            schemaVersion: 1,
          },
        },
      ],
    };
  },
};
