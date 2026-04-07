import { parseJiraContext } from "../../scope.js";
import type { PipelineNodeDefinition } from "../types.js";

export type JiraContextNodeParams = {
  jiraRef: string;
};

export type JiraContextNodeResult = {
  jiraRef: string;
  jiraIssueKey: string;
  jiraBrowseUrl: string;
  jiraApiUrl: string;
};

export const jiraContextNode: PipelineNodeDefinition<JiraContextNodeParams, JiraContextNodeResult> = {
  kind: "jira-context",
  version: 1,
  async run(_context, params) {
    return {
      value: parseJiraContext(params.jiraRef),
    };
  },
};
