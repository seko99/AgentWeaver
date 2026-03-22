import { runFlow } from "../flow-runner.js";
import type { FlowDefinition } from "../flow-types.js";
import { runNode } from "../node-runner.js";
import { codexDockerPromptNode } from "../nodes/codex-docker-prompt-node.js";
import { verifyBuildNode } from "../nodes/verify-build-node.js";
import type { PipelineContext } from "../types.js";

export type ImplementFlowParams = {
  dockerComposeFile: string;
  prompt: string;
  runFollowupVerify: boolean;
  onVerifyBuildFailure?: (output: string) => Promise<void>;
};

export const implementFlowDefinition: FlowDefinition<ImplementFlowParams> = {
  kind: "implement-flow",
  version: 1,
  steps: [
    {
      id: "run_codex_implement",
      async run(context, params) {
        await runNode(codexDockerPromptNode, context, {
          dockerComposeFile: params.dockerComposeFile,
          prompt: params.prompt,
          labelText: "Running Codex implementation mode in isolated Docker",
        });
        return { completed: true };
      },
    },
    {
      id: "verify_build_after_implement",
      async run(context, params) {
        if (!params.runFollowupVerify) {
          return {
            completed: true,
            metadata: { skipped: true },
          };
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
        return { completed: true };
      },
    },
  ],
};

export async function runImplementFlow(context: PipelineContext, params: ImplementFlowParams): Promise<void> {
  await runFlow(implementFlowDefinition, context, params);
}
