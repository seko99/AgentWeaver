import type { FlowDefinition, FlowRunOptions, FlowRunResult } from "./flow-types.js";
import type { PipelineContext } from "./types.js";

export async function runFlow<TParams>(
  definition: FlowDefinition<TParams>,
  context: PipelineContext,
  params: TParams,
  options: FlowRunOptions<TParams> = {},
): Promise<FlowRunResult> {
  const steps: FlowRunResult["steps"] = [];
  for (const step of definition.steps) {
    await options.onStepStart?.(step);
    const result = await step.run(context, params);
    await options.onStepComplete?.(step, result);
    steps.push({
      id: step.id,
      result,
    });
  }
  return { steps };
}
