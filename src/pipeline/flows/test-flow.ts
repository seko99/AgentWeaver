import { planArtifacts, requireArtifacts } from "../../artifacts.js";
import { runNode } from "../node-runner.js";
import { verifyBuildNode } from "../nodes/verify-build-node.js";
import type { PipelineContext } from "../types.js";

export type TestFlowParams = {
  taskKey: string;
  dockerComposeFile: string;
  onVerifyBuildFailure?: (output: string) => Promise<void>;
};

export async function runTestFlow(context: PipelineContext, params: TestFlowParams): Promise<void> {
  requireArtifacts(planArtifacts(params.taskKey), "Test mode requires plan artifacts from the planning phase.");
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
