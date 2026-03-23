import { readFileSync } from "node:fs";

import { printSummary } from "../../tui.js";
import type { PipelineNodeDefinition } from "../types.js";

export type SummaryFileLoadNodeParams = {
  path: string;
  title?: string;
};

export type SummaryFileLoadNodeResult = {
  text: string;
};

export const summaryFileLoadNode: PipelineNodeDefinition<SummaryFileLoadNodeParams, SummaryFileLoadNodeResult> = {
  kind: "summary-file-load",
  version: 1,
  async run(context, params) {
    const text = readFileSync(params.path, "utf8").trim();
    context.setSummary?.(text);
    if (params.title) {
      printSummary(params.title, text);
    }
    return {
      value: { text },
    };
  },
};
