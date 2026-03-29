import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

import { ensureScopeWorkspaceDir, jiraTaskFile } from "./artifacts.js";
import { TaskRunnerError } from "./errors.js";
import { buildJiraApiUrl, buildJiraBrowseUrl, extractIssueKey } from "./jira.js";
import type { UserInputFormDefinition, UserInputRequester } from "./user-input.js";

export type ScopeType = "task" | "project";

export type ResolvedTaskScope = {
  scopeType: "task";
  scopeKey: string;
  jiraRef: string;
  jiraIssueKey: string;
  jiraBrowseUrl: string;
  jiraApiUrl: string;
  jiraTaskFile: string;
};

export type ResolvedProjectScope = {
  scopeType: "project";
  scopeKey: string;
  gitBranchName: string | null;
  worktreeHash: string;
  projectRoot: string;
};

export type ResolvedScope = ResolvedTaskScope | ResolvedProjectScope;

type ParsedTaskScope = {
  jiraRef: string;
  jiraIssueKey: string;
  jiraBrowseUrl: string;
  jiraApiUrl: string;
};

function gitOutput(args: string[]): string | null {
  try {
    const output = execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const trimmed = output.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

function shortHash(input: string): string {
  return crypto.createHash("sha1").update(input).digest("hex").slice(0, 8);
}

export function sanitizeScopeName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9._@-]+/g, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^-|-$/g, "");
  if (!normalized) {
    throw new TaskRunnerError("Scope name is empty after sanitization. Use letters, digits, '.', '_', '-' or '@'.");
  }
  return normalized;
}

export function detectGitBranchName(): string | null {
  const branchName = gitOutput(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branchName) {
    return null;
  }
  if (branchName === "HEAD") {
    return null;
  }
  return branchName;
}

export function detectProjectRoot(): string {
  return gitOutput(["rev-parse", "--show-toplevel"]) ?? process.cwd();
}

export function buildProjectScopeKey(explicitScope?: string | null): {
  scopeKey: string;
  gitBranchName: string | null;
  worktreeHash: string;
  projectRoot: string;
} {
  const projectRoot = detectProjectRoot();
  const worktreeHash = shortHash(projectRoot);
  if (explicitScope?.trim()) {
    return {
      scopeKey: sanitizeScopeName(explicitScope),
      gitBranchName: detectGitBranchName(),
      worktreeHash,
      projectRoot,
    };
  }

  const branchName = detectGitBranchName();
  const branchSlug = sanitizeScopeName(branchName ?? "detached-head");
  return {
    scopeKey: `${branchSlug}@${worktreeHash}`,
    gitBranchName: branchName,
    worktreeHash,
    projectRoot,
  };
}

function parseTaskScope(jiraRef: string): ParsedTaskScope {
  return {
    jiraRef,
    jiraIssueKey: extractIssueKey(jiraRef),
    jiraBrowseUrl: buildJiraBrowseUrl(jiraRef),
    jiraApiUrl: buildJiraApiUrl(jiraRef),
  };
}

export function resolveTaskScope(jiraRef: string, explicitScope?: string | null): ResolvedTaskScope {
  const parsedTaskScope = parseTaskScope(jiraRef);
  const scopeKey = explicitScope?.trim() ? sanitizeScopeName(explicitScope) : parsedTaskScope.jiraIssueKey;
  ensureScopeWorkspaceDir(scopeKey);
  return {
    scopeType: "task",
    scopeKey,
    jiraRef: parsedTaskScope.jiraRef,
    jiraIssueKey: parsedTaskScope.jiraIssueKey,
    jiraBrowseUrl: parsedTaskScope.jiraBrowseUrl,
    jiraApiUrl: parsedTaskScope.jiraApiUrl,
    jiraTaskFile: jiraTaskFile(scopeKey),
  };
}

export function resolveProjectScope(explicitScope?: string | null): ResolvedProjectScope {
  const { scopeKey, gitBranchName, worktreeHash, projectRoot } = buildProjectScopeKey(explicitScope);
  ensureScopeWorkspaceDir(scopeKey);
  return {
    scopeType: "project",
    scopeKey,
    gitBranchName,
    worktreeHash,
    projectRoot,
  };
}

export function buildJiraTaskInputForm(): UserInputFormDefinition {
  return {
    formId: "jira-task-input",
    title: "Jira Task",
    description: "Укажи Jira issue key или browse URL для task-driven flow.",
    submitLabel: "Continue",
    fields: [
      {
        id: "jira_ref",
        type: "text",
        label: "Jira issue key or browse URL",
        help: "Например: DEMO-3288 или https://jira.example.ru/browse/DEMO-3288",
        required: true,
      },
    ],
  };
}

export async function requestTaskScope(requestUserInput: UserInputRequester): Promise<ResolvedTaskScope> {
  const result = await requestUserInput(buildJiraTaskInputForm());
  const jiraRef = String(result.values.jira_ref ?? "").trim();
  if (!jiraRef) {
    throw new TaskRunnerError("Jira issue key or browse URL is required.");
  }
  const parsedTaskScope = parseTaskScope(jiraRef);
  return {
    scopeType: "task",
    scopeKey: parsedTaskScope.jiraIssueKey,
    jiraRef: parsedTaskScope.jiraRef,
    jiraIssueKey: parsedTaskScope.jiraIssueKey,
    jiraBrowseUrl: parsedTaskScope.jiraBrowseUrl,
    jiraApiUrl: parsedTaskScope.jiraApiUrl,
    jiraTaskFile: jiraTaskFile(parsedTaskScope.jiraIssueKey),
  };
}
