import { runNode } from "./node-runner.js";
import { buildFailureSummaryNode } from "./nodes/build-failure-summary-node.js";
import type { PipelineContext } from "./types.js";

export async function summarizeBuildFailure(context: PipelineContext, output: string): Promise<string> {
  const result = await runNode(buildFailureSummaryNode, context, { output });
  return result.value.summaryText;
}
