import { existsSync, readFileSync } from "node:fs";

import { TaskRunnerError } from "../../errors.js";
import { validateStructuredArtifacts } from "../../structured-artifacts.js";
import { designReviewJsonFile, latestArtifactIteration } from "../../artifacts.js";
import type { PipelineNodeDefinition } from "../types.js";

export type DesignReviewVerdictNodeParams = {
  taskKey: string;
  iteration?: number;
};

export type DesignReviewVerdictNodeResult = {
  status: "approved" | "approved_with_warnings" | "needs_revision";
  canProceed: boolean;
  needsRevision: boolean;
  verdict: string;
};

function readVerdictFile(path: string): unknown {
  if (!existsSync(path)) {
    throw new TaskRunnerError(`Design review verdict file not found: ${path}`);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new TaskRunnerError(`Failed to parse design review verdict JSON: ${path}`);
  }
}

export const designReviewVerdictNode: PipelineNodeDefinition<DesignReviewVerdictNodeParams, DesignReviewVerdictNodeResult> = {
  kind: "design-review-verdict",
  version: 1,
  async run(_context, params) {
    const iteration = params.iteration ?? latestArtifactIteration(params.taskKey, "design-review", "json") ?? 1;
    const jsonPath = designReviewJsonFile(params.taskKey, iteration);

    validateStructuredArtifacts(
      [{ path: jsonPath, schemaId: "design-review/v1" }],
      "Design review verdict is invalid or missing.",
    );

    const verdict = readVerdictFile(jsonPath) as {
      status?: string;
      summary?: string;
    };

    const status = (verdict?.status ?? "needs_revision") as "approved" | "approved_with_warnings" | "needs_revision";
    const canProceed = status === "approved" || status === "approved_with_warnings";
    const needsRevision = status === "needs_revision";

    return {
      value: {
        status,
        canProceed,
        needsRevision,
        verdict: verdict?.summary ?? `Design review status: ${status}`,
      },
    };
  },
};