import type { FlowDefinition, FlowRunResult } from "./flow-types.js";
import type { PipelineContext } from "./types.js";

export async function runFlow<TParams>(
  definition: FlowDefinition<TParams>,
  context: PipelineContext,
  params: TParams,
): Promise<FlowRunResult> {
  const steps: FlowRunResult["steps"] = [];
  for (const step of definition.steps) {
    const result = await step.run(context, params);
    steps.push({
      id: step.id,
      result,
    });
  }
  return { steps };
}
