import { existsSync } from "node:fs";

import { printPanel } from "../../tui.js";
import type { PipelineNodeDefinition } from "../types.js";

export type FileCheckNodeParams = {
  path: string;
  panelTitle?: string;
  foundMessage?: string;
  tone?: "green" | "yellow" | "magenta" | "cyan";
};

export type FileCheckNodeResult = {
  exists: boolean;
};

export const fileCheckNode: PipelineNodeDefinition<FileCheckNodeParams, FileCheckNodeResult> = {
  kind: "file-check",
  version: 1,
  async run(_context, params) {
    const exists = existsSync(params.path);
    if (exists && params.panelTitle && params.foundMessage) {
      printPanel(params.panelTitle, params.foundMessage, params.tone ?? "green");
    }
    return {
      value: { exists },
    };
  },
};
