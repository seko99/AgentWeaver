import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { TaskRunnerError } from "../../errors.js";
import type { PipelineNodeDefinition } from "../types.js";

export type EnsureSummaryJsonNodeParams = {
  markdownFile: string;
  outputFile: string;
};

export type EnsureSummaryJsonNodeResult = {
  outputFile: string;
  created: boolean;
  repaired: boolean;
};

type SummaryArtifact = {
  summary?: unknown;
};

function toSummaryText(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "- ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hasValidSummaryArtifact(outputFile: string): boolean {
  if (!existsSync(outputFile)) {
    return false;
  }
  try {
    const parsed = JSON.parse(readFileSync(outputFile, "utf8")) as SummaryArtifact;
    return typeof parsed.summary === "string" && parsed.summary.trim().length > 0;
  } catch {
    return false;
  }
}

export const ensureSummaryJsonNode: PipelineNodeDefinition<
  EnsureSummaryJsonNodeParams,
  EnsureSummaryJsonNodeResult
> = {
  kind: "ensure-summary-json",
  version: 1,
  async run(_context, params) {
    if (hasValidSummaryArtifact(params.outputFile)) {
      return {
        value: {
          outputFile: params.outputFile,
          created: false,
          repaired: false,
        },
      };
    }

    if (!existsSync(params.markdownFile)) {
      throw new TaskRunnerError(
        `Cannot create summary JSON ${params.outputFile}: markdown source ${params.markdownFile} was not found.`,
      );
    }

    const summary = toSummaryText(readFileSync(params.markdownFile, "utf8"));
    if (!summary) {
      throw new TaskRunnerError(
        `Cannot create summary JSON ${params.outputFile}: markdown source ${params.markdownFile} is empty.`,
      );
    }

    mkdirSync(path.dirname(params.outputFile), { recursive: true });
    const repaired = existsSync(params.outputFile);
    writeFileSync(params.outputFile, `${JSON.stringify({ summary }, null, 2)}\n`, "utf8");

    return {
      value: {
        outputFile: params.outputFile,
        created: !repaired,
        repaired,
      },
      outputs: [{ kind: "artifact", path: params.outputFile, required: true }],
    };
  },
};
