import { runNodeChecks } from "./checks.js";
import type { PipelineContext, PipelineNodeDefinition, PipelineNodeResult } from "./types.js";

export async function runNode<TParams, TResult>(
  node: PipelineNodeDefinition<TParams, TResult>,
  context: PipelineContext,
  params: TParams,
): Promise<PipelineNodeResult<TResult>> {
  const result = await node.run(context, params);
  const checks = node.checks?.(context, params, result) ?? [];
  runNodeChecks(checks);
  return result;
}
