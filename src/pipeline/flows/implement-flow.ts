import { runNode } from "../node-runner.js";
import { implementCodexNode } from "../nodes/implement-codex-node.js";
import { verifyBuildNode } from "../nodes/verify-build-node.js";
import type { PipelineContext } from "../types.js";

export type ImplementFlowParams = {
  dockerComposeFile: string;
  prompt: string;
  runFollowupVerify: boolean;
  onVerifyBuildFailure?: (output: string) => Promise<void>;
};

export async function runImplementFlow(context: PipelineContext, params: ImplementFlowParams): Promise<void> {
  await runNode(implementCodexNode, context, {
    dockerComposeFile: params.dockerComposeFile,
    prompt: params.prompt,
    labelText: "Running Codex implementation mode in isolated Docker",
  });
  if (!params.runFollowupVerify) {
    return;
  }
  try {
    await runNode(verifyBuildNode, context, {
      dockerComposeFile: params.dockerComposeFile,
      labelText: "Running build verification in isolated Docker",
    });
  } catch (error) {
    if (params.onVerifyBuildFailure) {
      await params.onVerifyBuildFailure(String((error as { output?: string }).output ?? ""));
    }
    throw error;
  }
}
