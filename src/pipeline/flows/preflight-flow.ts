import { loadDeclarativeFlow } from "../declarative-flows.js";
import { runExpandedPhase } from "../declarative-flow-runner.js";
import type { FlowExecutionState } from "../spec-types.js";
import type { PipelineContext } from "../types.js";

export type PreflightFlowParams = {
  jiraApiUrl: string;
  jiraTaskFile: string;
  taskKey: string;
  forceRefresh: boolean;
};

export async function runPreflightFlow(context: PipelineContext, params: PreflightFlowParams): Promise<FlowExecutionState> {
  const flow = loadDeclarativeFlow("preflight.json");
  const executionState: FlowExecutionState = {
    flowKind: flow.kind,
    flowVersion: flow.version,
    terminated: false,
    phases: [],
  };
  for (const phase of flow.phases) {
    await runExpandedPhase(phase, context, params, flow.constants, {
      executionState,
      flowKind: flow.kind,
      flowVersion: flow.version,
    });
  }
  return executionState;
}
