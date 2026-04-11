import { readFileSync } from "node:fs";

import { TaskRunnerError } from "../../errors.js";
import type { PipelineNodeDefinition } from "../types.js";

export type BuildReviewFixPromptNodeParams = {
  selectionFile: string | undefined;
  autoMode: boolean;
};

export type BuildReviewFixPromptNodeResult = {
  promptSuffix: string;
  selectionMode: "interactive" | "auto";
  applyAll: boolean;
  selectedFindings: string[];
};

export const buildReviewFixPromptNode: PipelineNodeDefinition<BuildReviewFixPromptNodeParams, BuildReviewFixPromptNodeResult> = {
  kind: "build-review-fix-prompt",
  version: 1,
  async run(_context, params) {
    if (!params.selectionFile) {
      throw new TaskRunnerError("build-review-fix-prompt requires selectionFile param");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(params.selectionFile, "utf8"));
    } catch (error) {
      throw new TaskRunnerError(
        `Failed to read selection file ${params.selectionFile}: ${(error as Error).message}`,
      );
    }

    const artifact = parsed as { form_id?: string; submitted_at?: string; values?: { apply_all?: boolean; selected_findings?: string[]; extra_notes?: string } };
    const values = artifact.values ?? {};
    const applyAll = values.apply_all === true;
    const selectedFindings = Array.isArray(values.selected_findings) ? values.selected_findings.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];

    const promptSuffix = [
      "Use the user selection below as source of truth for the current review-fix scope.",
      `Selection file: ${params.selectionFile}`,
      `apply_all: ${applyAll ? "true" : "false"}`,
      applyAll ? "Fix all findings in the current iteration." : `Fix only selected findings:\n- ${selectedFindings.join("\n- ")}`,
    ].join("\n\n");

    return {
      value: {
        promptSuffix,
        selectionMode: params.autoMode ? "auto" : "interactive",
        applyAll,
        selectedFindings,
      },
    };
  },
};