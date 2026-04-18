import { resolveLatestPlanningBundle, type PlanningBundleResolution } from "../../runtime/planning-bundle.js";
import type { PipelineNodeDefinition } from "../types.js";

export type PlanningBundleNodeParams = {
  taskKey: string;
};

export const planningBundleNode: PipelineNodeDefinition<PlanningBundleNodeParams, PlanningBundleResolution> = {
  kind: "planning-bundle",
  version: 1,
  async run(_context, params) {
    return {
      value: resolveLatestPlanningBundle(params.taskKey),
    };
  },
};
