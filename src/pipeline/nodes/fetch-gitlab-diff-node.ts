import type {
  FetchGitLabDiffExecutorConfig,
  FetchGitLabDiffExecutorInput,
  FetchGitLabDiffExecutorResult,
} from "../../executors/fetch-gitlab-diff-executor.js";
import { buildLogicalKeyForPayload } from "../../artifact-manifest.js";
import type { PipelineNodeDefinition } from "../types.js";
import { toExecutorContext } from "../types.js";

export type FetchGitLabDiffNodeParams = {
  mergeRequestUrl: string;
  outputFile: string;
  outputJsonFile: string;
};

export const fetchGitLabDiffNode: PipelineNodeDefinition<
  FetchGitLabDiffNodeParams,
  FetchGitLabDiffExecutorResult
> = {
  kind: "fetch-gitlab-diff",
  version: 1,
  async run(context, params) {
    const executor = context.executors.get<
      FetchGitLabDiffExecutorConfig,
      FetchGitLabDiffExecutorInput,
      FetchGitLabDiffExecutorResult
    >("fetch-gitlab-diff");
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
        {
          kind: "artifact",
          path: params.outputFile,
          required: true,
          manifest: {
            publish: true,
            logicalKey: buildLogicalKeyForPayload(context.issueKey, params.outputFile),
          },
        },
        {
          kind: "artifact",
          path: params.outputJsonFile,
          required: true,
          manifest: {
            publish: true,
            logicalKey: buildLogicalKeyForPayload(context.issueKey, params.outputJsonFile),
          },
        },
      ],
    };
  },
  checks(_context, params) {
    return [
      {
        kind: "require-file",
        path: params.outputFile,
        message: `Fetch GitLab diff node did not produce ${params.outputFile}.`,
      },
      {
        kind: "require-file",
        path: params.outputJsonFile,
        message: `Fetch GitLab diff node did not produce ${params.outputJsonFile}.`,
      },
    ];
  },
};
