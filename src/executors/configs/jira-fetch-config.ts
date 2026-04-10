import type { JiraFetchExecutorConfig } from "../jira-fetch-executor.js";

export const jiraFetchExecutorDefaultConfig: JiraFetchExecutorConfig = {
  authEnvVar: "JIRA_API_KEY",
  usernameEnvVar: "JIRA_USERNAME",
  authModeEnvVar: "JIRA_AUTH_MODE",
  acceptHeader: "application/json",
};
