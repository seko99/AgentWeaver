import { readFileSync } from "node:fs";

import type { PipelineNodeDefinition } from "../types.js";

export type ReadFileNodeParams = {
  path: string;
};

export type ReadFileNodeResult = {
  text: string;
};

export const readFileNode: PipelineNodeDefinition<ReadFileNodeParams, ReadFileNodeResult> = {
  kind: "read-file",
  version: 1,
  async run(_context, params) {
    const text = readFileSync(params.path, "utf8").trim();
    return {
      value: { text },
    };
  },
};