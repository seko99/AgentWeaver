import type {
  FetchGitLabReviewExecutorConfig,
  FetchGitLabReviewExecutorInput,
  FetchGitLabReviewExecutorResult,
} from "../../executors/fetch-gitlab-review-executor.js";
import type { PipelineNodeDefinition } from "../types.js";
import { toExecutorContext } from "../types.js";

export type FetchGitLabReviewNodeParams = {
  mergeRequestUrl: string;
  outputFile: string;
  outputJsonFile: string;
};

export const fetchGitLabReviewNode: PipelineNodeDefinition<
  FetchGitLabReviewNodeParams,
  FetchGitLabReviewExecutorResult
> = {
  kind: "fetch-gitlab-review",
  version: 1,
  async run(context, params) {
    const executor = context.executors.get<
      FetchGitLabReviewExecutorConfig,
      FetchGitLabReviewExecutorInput,
      FetchGitLabReviewExecutorResult
    >("fetch-gitlab-review");
    const value = await executor.execute(
      toExecutorContext(context),
      {
        mergeRequestUrl: params.mergeRequestUrl,
        outputFile: params.outputFile,
        outputJsonFile: params.outputJsonFile,
      },
      executor.defaultConfig,
    );
    return {
      value,
      outputs: [
        { kind: "artifact", path: params.outputFile, required: true },
        { kind: "artifact", path: params.outputJsonFile, required: true },
      ],
    };
  },
  checks(_context, params) {
    return [
      {
        kind: "require-file",
        path: params.outputFile,
        message: `Fetch GitLab review node did not produce ${params.outputFile}.`,
      },
      {
        kind: "require-file",
        path: params.outputJsonFile,
        message: `Fetch GitLab review node did not produce ${params.outputJsonFile}.`,
      },
    ];
  },
};
