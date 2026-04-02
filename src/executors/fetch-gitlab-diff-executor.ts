import { fetchGitLabDiffExecutorDefaultConfig } from "./configs/fetch-gitlab-diff-config.js";
import { buildGitLabMergeRequestDiffFetchTarget, fetchGitLabMergeRequestDiff } from "../gitlab.js";
import type { ExecutorContext, ExecutorDefinition, JsonObject } from "./types.js";

export type FetchGitLabDiffExecutorConfig = JsonObject & {
  authEnvVar: string;
};

export type FetchGitLabDiffExecutorInput = {
  mergeRequestUrl: string;
  outputFile: string;
  outputJsonFile: string;
};

export type FetchGitLabDiffExecutorResult = {
  outputFile: string;
  outputJsonFile: string;
  mergeRequestUrl: string;
  filesCount: number;
};

export const fetchGitLabDiffExecutor: ExecutorDefinition<
  FetchGitLabDiffExecutorConfig,
  FetchGitLabDiffExecutorInput,
  FetchGitLabDiffExecutorResult
> = {
  kind: "fetch-gitlab-diff",
  version: 1,
  defaultConfig: fetchGitLabDiffExecutorDefaultConfig,
  async execute(context: ExecutorContext, input: FetchGitLabDiffExecutorInput) {
    const target = buildGitLabMergeRequestDiffFetchTarget(input.mergeRequestUrl);
    if (context.verbose) {
      context.ui.writeStdout(`GitLab MR URL: ${target.mergeRequestUrl}\n`);
      context.ui.writeStdout(`GitLab project path: ${target.projectPath}\n`);
      context.ui.writeStdout(`GitLab merge request IID: ${target.mergeRequestIid}\n`);
      context.ui.writeStdout(`GitLab merge request API URL: ${target.mergeRequestApiUrl}\n`);
      context.ui.writeStdout(`GitLab diffs API URL: ${target.diffsApiUrl}\n`);
      context.ui.writeStdout(`Saving GitLab diff markdown to: ${input.outputFile}\n`);
      context.ui.writeStdout(`Saving GitLab diff JSON to: ${input.outputJsonFile}\n`);
    }
    const artifact = await fetchGitLabMergeRequestDiff(input.mergeRequestUrl, input.outputFile, input.outputJsonFile);
    return {
      outputFile: input.outputFile,
      outputJsonFile: input.outputJsonFile,
      mergeRequestUrl: artifact.merge_request_url,
      filesCount: artifact.files.length,
    };
  },
};
