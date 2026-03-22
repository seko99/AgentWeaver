import { fetchJiraIssue } from "../jira.js";
import type { ExecutorContext, ExecutorDefinition, JsonObject } from "./types.js";

export type JiraFetchExecutorConfig = JsonObject & {
  authEnvVar: string;
  acceptHeader: string;
};

export type JiraFetchExecutorInput = {
  jiraApiUrl: string;
  outputFile: string;
};

export type JiraFetchExecutorResult = {
  outputFile: string;
};

export const jiraFetchExecutor: ExecutorDefinition<
  JiraFetchExecutorConfig,
  JiraFetchExecutorInput,
  JiraFetchExecutorResult
> = {
  kind: "jira-fetch",
  version: 1,
  defaultConfig: {
    authEnvVar: "JIRA_API_KEY",
    acceptHeader: "application/json",
  },
  async execute(_context: ExecutorContext, input: JiraFetchExecutorInput) {
    await fetchJiraIssue(input.jiraApiUrl, input.outputFile);
    return { outputFile: input.outputFile };
  },
};
