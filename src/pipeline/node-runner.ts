import { setCurrentNode } from "../tui.js";
import { runNodeChecks } from "./checks.js";
import type { PipelineContext, PipelineNodeDefinition, PipelineNodeResult } from "./types.js";

export type RunNodeOptions = {
  skipChecks?: boolean;
  contextOverrides?: Partial<Pick<PipelineContext, "resumeStepValue" | "persistRunningStepValue">>;
};

export async function runNode<TParams, TResult>(
  node: PipelineNodeDefinition<TParams, TResult>,
  context: PipelineContext,
  params: TParams,
  options: RunNodeOptions = {},
): Promise<PipelineNodeResult<TResult>> {
  const effectiveContext = options.contextOverrides ? { ...context, ...options.contextOverrides } : context;
  setCurrentNode(node.kind);
  try {
    const result = await node.run(effectiveContext, params);
    if (!options.skipChecks) {
      const checks = node.checks?.(effectiveContext, params, result) ?? [];
      runNodeChecks(checks);
    }
    return result;
  } finally {
    setCurrentNode(null);
  }
}

export async function runNodeByKind<TResult = unknown>(
  kind: string,
  context: PipelineContext,
  params: Record<string, unknown>,
  options: RunNodeOptions = {},
): Promise<PipelineNodeResult<TResult>> {
  const node = context.nodes.get<Record<string, unknown>, TResult>(kind);
  return runNode(node, context, params, options);
}
