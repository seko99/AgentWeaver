import { readFileSync } from "node:fs";

import { TaskRunnerError } from "../../errors.js";
import { printInfo } from "../../tui.js";
import type { PipelineNodeDefinition } from "../types.js";

export type JiraIssueCheckNodeParams = {
  jiraTaskFile: string;
  allowedIssueTypes: string[];
  labelText?: string;
};

export type JiraIssueCheckNodeResult = {
  issueType: string;
};

function extractIssueTypeName(path: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new TaskRunnerError(`Failed to parse Jira issue JSON ${path}: ${(error as Error).message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TaskRunnerError(`Jira issue payload in ${path} must be a JSON object.`);
  }

  const fields = (parsed as { fields?: unknown }).fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw new TaskRunnerError(`Jira issue payload in ${path} does not contain 'fields'.`);
  }

  const issueType = (fields as { issuetype?: unknown }).issuetype;
  if (!issueType || typeof issueType !== "object" || Array.isArray(issueType)) {
    throw new TaskRunnerError(`Jira issue payload in ${path} does not contain 'fields.issuetype'.`);
  }

  const issueTypeName = (issueType as { name?: unknown }).name;
  if (typeof issueTypeName !== "string" || issueTypeName.trim().length === 0) {
    throw new TaskRunnerError(`Jira issue payload in ${path} does not contain 'fields.issuetype.name'.`);
  }

  return issueTypeName.trim();
}

export const jiraIssueCheckNode: PipelineNodeDefinition<JiraIssueCheckNodeParams, JiraIssueCheckNodeResult> = {
  kind: "jira-issue-check",
  version: 1,
  async run(_context, params) {
    if (params.labelText) {
      printInfo(params.labelText);
    }

    const issueType = extractIssueTypeName(params.jiraTaskFile);
    const normalizedIssueType = issueType.toLowerCase();
    const allowedIssueTypes = params.allowedIssueTypes
      .map((candidate) => candidate.trim())
      .filter((candidate) => candidate.length > 0);

    if (allowedIssueTypes.length === 0) {
      throw new TaskRunnerError("jira-issue-check requires at least one allowed issue type.");
    }

    const isAllowed = allowedIssueTypes.some((candidate) => candidate.toLowerCase() === normalizedIssueType);
    if (!isAllowed) {
      throw new TaskRunnerError(
        `Flow 'bug-analyze' supports only Jira issue types: ${allowedIssueTypes.join(", ")}. ` +
          `Fetched issue type: ${issueType}.`,
      );
    }

    return {
      value: { issueType },
    };
  },
};
