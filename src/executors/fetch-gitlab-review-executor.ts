import { fetchGitLabReviewExecutorDefaultConfig } from "./configs/fetch-gitlab-review-config.js";
import { buildGitLabReviewFetchTarget, fetchGitLabReview } from "../gitlab.js";
import type { ExecutorContext, ExecutorDefinition, JsonObject } from "./types.js";

export type FetchGitLabReviewExecutorConfig = JsonObject & {
  authEnvVar: string;
};

export type FetchGitLabReviewExecutorInput = {
  mergeRequestUrl: string;
  outputFile: string;
  outputJsonFile: string;
};

export type FetchGitLabReviewExecutorResult = {
  outputFile: string;
  outputJsonFile: string;
  mergeRequestUrl: string;
  commentsCount: number;
};

export const fetchGitLabReviewExecutor: ExecutorDefinition<
  FetchGitLabReviewExecutorConfig,
  FetchGitLabReviewExecutorInput,
  FetchGitLabReviewExecutorResult
> = {
  kind: "fetch-gitlab-review",
  version: 1,
  defaultConfig: fetchGitLabReviewExecutorDefaultConfig,
  async execute(context: ExecutorContext, input: FetchGitLabReviewExecutorInput) {
    const target = buildGitLabReviewFetchTarget(input.mergeRequestUrl);
    if (context.verbose) {
      context.ui.writeStdout(`GitLab MR URL: ${target.mergeRequestUrl}\n`);
      context.ui.writeStdout(`GitLab project path: ${target.projectPath}\n`);
      context.ui.writeStdout(`GitLab merge request IID: ${target.mergeRequestIid}\n`);
      context.ui.writeStdout(`GitLab discussions API URL: ${target.discussionsApiUrl}\n`);
      context.ui.writeStdout(`Saving GitLab review markdown to: ${input.outputFile}\n`);
      context.ui.writeStdout(`Saving GitLab review JSON to: ${input.outputJsonFile}\n`);
    }
    const artifact = await fetchGitLabReview(input.mergeRequestUrl, input.outputFile, input.outputJsonFile);
    return {
      outputFile: input.outputFile,
      outputJsonFile: input.outputJsonFile,
      mergeRequestUrl: artifact.merge_request_url,
      commentsCount: artifact.comments.length,
    };
  },
};
