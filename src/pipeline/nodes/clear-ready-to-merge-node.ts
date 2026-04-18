import { clearReadyToMergeFile } from "../../runtime/ready-to-merge.js";
import type { PipelineNodeDefinition } from "../types.js";

export type ClearReadyToMergeNodeParams = {
  taskKey: string;
};

export type ClearReadyToMergeNodeResult = {
  cleared: boolean;
};

export const clearReadyToMergeNode: PipelineNodeDefinition<
  ClearReadyToMergeNodeParams,
  ClearReadyToMergeNodeResult
> = {
  kind: "clear-ready-to-merge",
  version: 1,
  async run(_context, params) {
    const cleared = clearReadyToMergeFile(params.taskKey);
    return {
      value: { cleared },
    };
  },
};