import { writeFileSync } from "node:fs";

import { readFileSync } from "node:fs";
import { TaskRunnerError } from "../../errors.js";
import type { PipelineNodeDefinition } from "../types.js";

export type WriteSelectionFileNodeParams = {
  outputFile: string;
  reviewFindingsJsonFile: string;
  selectionMode: "auto-blockers-criticals";
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

const SEVERITY_AUTO_SELECT = ["blocker", "critical"];

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
    const selectedFindings = findings
      .filter((finding) => {
        const severity = typeof finding.severity === "string" ? finding.severity.trim().toLowerCase() : "";
        const disposition = typeof finding.disposition === "string" ? finding.disposition.trim().toLowerCase() : null;
        return SEVERITY_AUTO_SELECT.includes(severity) && disposition !== "resolved" && disposition != null;
      })
      .map((finding) => finding.title)
      .filter((title): title is string => typeof title === "string" && title.trim().length > 0);

    const applyAll = selectedFindings.length === 0;
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
    };
  },
};