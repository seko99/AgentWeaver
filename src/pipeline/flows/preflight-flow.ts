import { loadDeclarativeFlow } from "../declarative-flows.js";
import { runExpandedPhase } from "../declarative-flow-runner.js";
import type { PipelineContext } from "../types.js";

export type PreflightFlowParams = {
  jiraApiUrl: string;
  jiraTaskFile: string;
  taskKey: string;
  forceRefresh: boolean;
};

export async function runPreflightFlow(context: PipelineContext, params: PreflightFlowParams): Promise<void> {
  const flow = loadDeclarativeFlow("preflight.json");
  for (const phase of flow.phases) {
    await runExpandedPhase(phase, context, params, flow.constants);
  }
}
