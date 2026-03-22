import { artifactFile, planArtifacts, requireArtifacts } from "../../artifacts.js";
import { TaskRunnerError } from "../../errors.js";
import { REVIEW_FIX_PROMPT_TEMPLATE, formatPrompt, formatTemplate } from "../../prompts.js";
import { runFlow } from "../flow-runner.js";
import type { FlowDefinition } from "../flow-types.js";
import { runNode } from "../node-runner.js";
import { codexDockerPromptNode } from "../nodes/codex-docker-prompt-node.js";
import { verifyBuildNode } from "../nodes/verify-build-node.js";
import type { PipelineContext } from "../types.js";

export type ReviewFixFlowParams = {
  taskKey: string;
  dockerComposeFile: string;
  latestIteration: number | null;
  reviewFixPoints?: string | null;
  extraPrompt?: string | null;
  runFollowupVerify: boolean;
  onVerifyBuildFailure?: (output: string) => Promise<void>;
};

export function createReviewFixFlowDefinition(iteration: number): FlowDefinition<ReviewFixFlowParams> {
  return {
    kind: "review-fix-flow",
    version: 1,
    steps: [
      {
        id: "run_codex_review_fix",
        async run(stepContext, stepParams) {
          const reviewReplyFile = artifactFile("review-reply", stepParams.taskKey, iteration);
          const reviewFixFile = artifactFile("review-fix", stepParams.taskKey, iteration);
          const prompt = formatPrompt(
            formatTemplate(REVIEW_FIX_PROMPT_TEMPLATE, {
              review_reply_file: reviewReplyFile,
              items: stepParams.reviewFixPoints ?? "",
              review_fix_file: reviewFixFile,
            }),
            stepParams.extraPrompt,
          );

          await runNode(codexDockerPromptNode, stepContext, {
            dockerComposeFile: stepParams.dockerComposeFile,
            prompt,
            labelText: `Running Codex review-fix mode in isolated Docker (iteration ${iteration})`,
            requiredArtifacts: stepContext.dryRun ? [] : [reviewFixFile],
            missingArtifactsMessage: "Review-fix mode did not produce the required review-fix artifact.",
          });
          return { completed: true, metadata: { iteration } };
        },
      },
      {
        id: "verify_build_after_review_fix",
        async run(stepContext, stepParams) {
          if (!stepParams.runFollowupVerify) {
            return { completed: true, metadata: { skipped: true } };
          }
          try {
            await runNode(verifyBuildNode, stepContext, {
              dockerComposeFile: stepParams.dockerComposeFile,
              labelText: "Running build verification in isolated Docker",
            });
          } catch (error) {
            if (stepParams.onVerifyBuildFailure) {
              await stepParams.onVerifyBuildFailure(String((error as { output?: string }).output ?? ""));
            }
            throw error;
          }
          return { completed: true };
        },
      },
    ],
  };
}

export async function runReviewFixFlow(context: PipelineContext, params: ReviewFixFlowParams): Promise<void> {
  requireArtifacts(planArtifacts(params.taskKey), "Review-fix mode requires plan artifacts from the planning phase.");
  if (params.latestIteration === null) {
    throw new TaskRunnerError(`Review-fix mode requires at least one review-reply-${params.taskKey}-N.md artifact.`);
  }
  await runFlow(createReviewFixFlowDefinition(params.latestIteration), context, params);
}
