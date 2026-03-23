import { setCurrentNode } from "../tui.js";
import { runNodeChecks } from "./checks.js";
import type { NodeKind } from "./node-registry.js";
import type { PipelineContext, PipelineNodeDefinition, PipelineNodeResult } from "./types.js";

export type RunNodeOptions = {
  skipChecks?: boolean;
};

export async function runNode<TParams, TResult>(
  node: PipelineNodeDefinition<TParams, TResult>,
  context: PipelineContext,
  params: TParams,
  options: RunNodeOptions = {},
): Promise<PipelineNodeResult<TResult>> {
  setCurrentNode(node.kind);
  try {
    const result = await node.run(context, params);
    if (!options.skipChecks) {
      const checks = node.checks?.(context, params, result) ?? [];
      runNodeChecks(checks);
    }
    return result;
  } finally {
    setCurrentNode(null);
  }
}

export async function runNodeByKind<TResult = unknown>(
  kind: NodeKind,
  context: PipelineContext,
  params: Record<string, unknown>,
  options: RunNodeOptions = {},
): Promise<PipelineNodeResult<TResult>> {
  const node = context.nodes.get<Record<string, unknown>, TResult>(kind);
  return runNode(node, context, params, options);
}
