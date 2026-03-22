import { artifactFile, planArtifacts, requireArtifacts } from "../../artifacts.js";
import { TaskRunnerError } from "../../errors.js";
import { REVIEW_FIX_PROMPT_TEMPLATE, formatPrompt, formatTemplate } from "../../prompts.js";
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

export async function runReviewFixFlow(context: PipelineContext, params: ReviewFixFlowParams): Promise<void> {
  requireArtifacts(planArtifacts(params.taskKey), "Review-fix mode requires plan artifacts from the planning phase.");
  if (params.latestIteration === null) {
    throw new TaskRunnerError(`Review-fix mode requires at least one review-reply-${params.taskKey}-N.md artifact.`);
  }

  const reviewReplyFile = artifactFile("review-reply", params.taskKey, params.latestIteration);
  const reviewFixFile = artifactFile("review-fix", params.taskKey, params.latestIteration);
  const prompt = formatPrompt(
    formatTemplate(REVIEW_FIX_PROMPT_TEMPLATE, {
      review_reply_file: reviewReplyFile,
      items: params.reviewFixPoints ?? "",
      review_fix_file: reviewFixFile,
    }),
    params.extraPrompt,
  );

  await runNode(codexDockerPromptNode, context, {
    dockerComposeFile: params.dockerComposeFile,
    prompt,
    labelText: `Running Codex review-fix mode in isolated Docker (iteration ${params.latestIteration})`,
    requiredArtifacts: context.dryRun ? [] : [reviewFixFile],
    missingArtifactsMessage: "Review-fix mode did not produce the required review-fix artifact.",
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
