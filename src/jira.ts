import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { TaskRunnerError } from "./errors.js";

const ISSUE_KEY_RE = /^[A-Z][A-Z0-9_]*-[0-9]+$/;

export function extractIssueKey(jiraRef: string): string {
  const normalizedRef = jiraRef.replace(/\/+$/, "");
  if (normalizedRef.includes("://")) {
    const issueKey = normalizedRef.split("/").pop() ?? "";
    if (!normalizedRef.includes("/browse/") || !issueKey) {
      throw new TaskRunnerError(
        "Expected Jira browse URL like https://jira.example.ru/browse/DEMO-3288",
      );
    }
    return issueKey;
  }

  if (!ISSUE_KEY_RE.test(normalizedRef)) {
    throw new TaskRunnerError(
      "Expected Jira issue key like DEMO-3288 or browse URL like https://jira.example.ru/browse/DEMO-3288",
    );
  }
  return normalizedRef;
}

export function buildJiraBrowseUrl(jiraRef: string): string {
  if (jiraRef.includes("://")) {
    return jiraRef.replace(/\/+$/, "");
  }

  const baseUrl = process.env.JIRA_BASE_URL?.replace(/\/+$/, "") ?? "";
  if (!baseUrl) {
    throw new TaskRunnerError("JIRA_BASE_URL is required when passing only a Jira issue key.");
  }

  return `${baseUrl}/browse/${extractIssueKey(jiraRef)}`;
}

export function buildJiraApiUrl(jiraRef: string): string {
  const browseUrl = buildJiraBrowseUrl(jiraRef);
  const issueKey = extractIssueKey(jiraRef);
  const baseUrl = browseUrl.split("/browse/")[0];
  return `${baseUrl}/rest/api/2/issue/${issueKey}`;
}

export async function fetchJiraIssue(jiraApiUrl: string, jiraTaskFile: string): Promise<void> {
  const jiraApiKey = process.env.JIRA_API_KEY;
  if (!jiraApiKey) {
    throw new TaskRunnerError("JIRA_API_KEY is required for plan mode.");
  }

  const response = await fetch(jiraApiUrl, {
    headers: {
      Authorization: `Bearer ${jiraApiKey}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new TaskRunnerError(`Failed to fetch Jira issue: HTTP ${response.status}`);
  }

  const body = Buffer.from(await response.arrayBuffer());
  mkdirSync(path.dirname(jiraTaskFile), { recursive: true });
  await writeFile(jiraTaskFile, body);
}

export function requireJiraTaskFile(jiraTaskFile: string): void {
  if (!existsSync(jiraTaskFile)) {
    throw new TaskRunnerError(
      `Jira issue JSON not found: ${jiraTaskFile}\nRun plan mode first to download the Jira task.`,
    );
  }
}
