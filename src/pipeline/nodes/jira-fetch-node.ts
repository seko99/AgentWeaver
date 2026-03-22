import type {
  JiraFetchExecutorConfig,
  JiraFetchExecutorInput,
  JiraFetchExecutorResult,
} from "../../executors/jira-fetch-executor.js";
import type { PipelineNodeDefinition } from "../types.js";
import { toExecutorContext } from "../types.js";

export type JiraFetchNodeParams = {
  jiraApiUrl: string;
  outputFile: string;
};

export const jiraFetchNode: PipelineNodeDefinition<JiraFetchNodeParams, JiraFetchExecutorResult> = {
  kind: "jira-fetch",
  version: 1,
  async run(context, params) {
    const executor = context.executors.get<JiraFetchExecutorConfig, JiraFetchExecutorInput, JiraFetchExecutorResult>("jira-fetch");
    const value = await executor.execute(
      toExecutorContext(context),
      {
        jiraApiUrl: params.jiraApiUrl,
        outputFile: params.outputFile,
      },
      executor.defaultConfig,
    );
    return {
      value,
      outputs: [{ kind: "file", path: params.outputFile, required: true }],
    };
  },
  checks(_context, params) {
    return [
      {
        kind: "require-file",
        path: params.outputFile,
        message: `Jira fetch node did not produce ${params.outputFile}.`,
      },
    ];
  },
};
