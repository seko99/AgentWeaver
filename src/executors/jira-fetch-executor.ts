import { jiraFetchExecutorDefaultConfig } from "./configs/jira-fetch-config.js";
import { fetchJiraIssue } from "../jira.js";
import type { ExecutorContext, ExecutorDefinition, JsonObject } from "./types.js";

export type JiraFetchExecutorConfig = JsonObject & {
  authEnvVar: string;
  usernameEnvVar?: string;
  authModeEnvVar?: string;
  acceptHeader: string;
};

export type JiraFetchExecutorInput = {
  jiraApiUrl: string;
  outputFile: string;
  attachmentsManifestFile?: string;
  attachmentsContextFile?: string;
};

export type JiraFetchExecutorResult = {
  outputFile: string;
  attachmentsManifestFile?: string;
  attachmentsContextFile?: string;
  downloadedAttachments: number;
  planningContextAttachments: number;
  enrichedFile?: string;
};

export const jiraFetchExecutor: ExecutorDefinition<
  JiraFetchExecutorConfig,
  JiraFetchExecutorInput,
  JiraFetchExecutorResult
> = {
  kind: "jira-fetch",
  version: 1,
  defaultConfig: jiraFetchExecutorDefaultConfig,
  async execute(_context: ExecutorContext, input: JiraFetchExecutorInput) {
    const artifacts = await fetchJiraIssue(
      input.jiraApiUrl,
      input.outputFile,
      input.attachmentsManifestFile,
      input.attachmentsContextFile,
    );
    return {
      outputFile: artifacts.issueFile,
      downloadedAttachments: artifacts.downloadedAttachments,
      planningContextAttachments: artifacts.planningContextAttachments,
      ...(artifacts.attachmentsManifestFile ? { attachmentsManifestFile: artifacts.attachmentsManifestFile } : {}),
      ...(artifacts.attachmentsContextFile ? { attachmentsContextFile: artifacts.attachmentsContextFile } : {}),
      ...(artifacts.enrichedFile ? { enrichedFile: artifacts.enrichedFile } : {}),
    };
  },
};
