import type { JiraFetchExecutorConfig } from "../jira-fetch-executor.js";

export const jiraFetchExecutorDefaultConfig: JiraFetchExecutorConfig = {
  authEnvVar: "JIRA_API_KEY",
  acceptHeader: "application/json",
};
