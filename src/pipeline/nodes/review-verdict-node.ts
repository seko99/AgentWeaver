import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { reviewJsonFile, latestArtifactIteration, readyToMergeFile } from "../../artifacts.js";
import { TaskRunnerError } from "../../errors.js";
import { resolveBlockingReviewSeverities, normalizeReviewSeverity, type ReviewSeverity } from "../../review-severity.js";
import { validateStructuredArtifacts } from "../../structured-artifacts.js";
import { clearReadyToMergeFile, writeReadyToMergeFile } from "../../runtime/ready-to-merge.js";
import type { PipelineNodeDefinition } from "../types.js";

type ReviewFinding = {
  severity?: unknown;
  title?: unknown;
  description?: unknown;
};

type ReviewFindingsArtifact = {
  summary?: unknown;
  ready_to_merge?: unknown;
  findings?: ReviewFinding[];
};

export type ReviewVerdictNodeParams = {
  taskKey: string;
  iteration?: number;
  blockingSeverities?: string[] | null;
};

export type ReviewVerdictNodeResult = {
  readyToMerge: boolean;
  blockingSeverities: ReviewSeverity[];
  blockingFindingTitles: string[];
  blockingFindingsCount: number;
  summary: string;
  reviewJsonFile: string;
};

function readReviewVerdictFile(path: string): ReviewFindingsArtifact {
  if (!existsSync(path)) {
    throw new TaskRunnerError(`Review findings file not found: ${path}`);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ReviewFindingsArtifact;
  } catch {
    throw new TaskRunnerError(`Failed to parse review findings JSON: ${path}`);
  }
}

export const reviewVerdictNode: PipelineNodeDefinition<ReviewVerdictNodeParams, ReviewVerdictNodeResult> = {
  kind: "review-verdict",
  version: 1,
  async run(context, params) {
    const iteration = params.iteration ?? latestArtifactIteration(params.taskKey, "review", "json") ?? 1;
    const jsonPath = reviewJsonFile(params.taskKey, iteration);

    validateStructuredArtifacts(
      [{ path: jsonPath, schemaId: "review-findings/v1" }],
      "Review findings are invalid or missing.",
    );

    const report = readReviewVerdictFile(jsonPath);
    const findings = Array.isArray(report.findings) ? report.findings : [];
    const blockingSeverities = resolveBlockingReviewSeverities(params.blockingSeverities);
    const blockingSeveritySet = new Set(blockingSeverities);
    const blockingFindingTitles = findings
      .filter((finding) => {
        const severity = normalizeReviewSeverity(finding.severity);
        return severity !== null && blockingSeveritySet.has(severity);
      })
      .map((finding) => (typeof finding.title === "string" ? finding.title.trim() : ""))
      .filter((title) => title.length > 0);
    const readyToMerge = blockingFindingTitles.length === 0;
    const summary = typeof report.summary === "string" && report.summary.trim().length > 0
      ? report.summary.trim()
      : readyToMerge
        ? "No blocking findings."
        : `Blocking findings: ${blockingFindingTitles.join(", ")}`;

    const normalizedReport = {
      ...report,
      ready_to_merge: readyToMerge,
    };
    writeFileSync(jsonPath, `${JSON.stringify(normalizedReport, null, 2)}\n`, "utf8");

    if (readyToMerge) {
      writeReadyToMergeFile(params.taskKey, {
        ...(context.mdLang !== undefined ? { mdLang: context.mdLang } : {}),
        summary,
      });
    } else {
      clearReadyToMergeFile(params.taskKey);
    }

    return {
      value: {
        readyToMerge,
        blockingSeverities,
        blockingFindingTitles,
        blockingFindingsCount: blockingFindingTitles.length,
        summary,
        reviewJsonFile: jsonPath,
      },
      outputs: [
        {
          kind: "artifact",
          path: jsonPath,
          required: true,
          manifest: {
            publish: true,
            schemaId: "review-findings/v1",
          },
        },
        {
          kind: "file",
          path: readyToMergeFile(params.taskKey),
          required: false,
          manifest: {
            publish: true,
          },
        },
      ],
    };
  },
};
