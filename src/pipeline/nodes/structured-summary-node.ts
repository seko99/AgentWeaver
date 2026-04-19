import { readFileSync } from "node:fs";

import { TaskRunnerError } from "../../errors.js";
import type { PipelineNodeDefinition } from "../types.js";

export type StructuredSummaryNodeParams = {
  path: string;
  maxLength?: number;
};

export type StructuredSummaryNodeResult = {
  summary: string;
};

type SummaryArtifact = {
  summary?: unknown;
};

export const structuredSummaryNode: PipelineNodeDefinition<
  StructuredSummaryNodeParams,
  StructuredSummaryNodeResult
> = {
  kind: "structured-summary",
  version: 1,
  async run(_context, params) {
    let parsed: SummaryArtifact;
    try {
      parsed = JSON.parse(readFileSync(params.path, "utf8")) as SummaryArtifact;
    } catch (error) {
      throw new TaskRunnerError(
        `Structured summary node could not parse JSON from ${params.path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    if (!summary) {
      throw new TaskRunnerError(`Structured summary node did not find a non-empty summary in ${params.path}.`);
    }

    return {
      value: {
        summary,
      },
    };
  },
};
