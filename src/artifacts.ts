import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { TaskRunnerError } from "./errors.js";

export const REVIEW_FILE_RE = /^review-(.+)-(\d+)\.md$/;
export const REVIEW_REPLY_FILE_RE = /^review-reply-(.+)-(\d+)\.md$/;
export const READY_TO_MERGE_FILE = "ready-to-merge.md";

export function taskWorkspaceDir(taskKey: string): string {
  return path.join(process.cwd(), `.agentweaver-${taskKey}`);
}

export function ensureTaskWorkspaceDir(taskKey: string): string {
  const workspaceDir = taskWorkspaceDir(taskKey);
  mkdirSync(workspaceDir, { recursive: true });
  return workspaceDir;
}

export function taskWorkspaceFile(taskKey: string, fileName: string): string {
  return path.join(taskWorkspaceDir(taskKey), fileName);
}

export function artifactFile(prefix: string, taskKey: string, iteration: number): string {
  return taskWorkspaceFile(taskKey, `${prefix}-${taskKey}-${iteration}.md`);
}

export function designFile(taskKey: string): string {
  return artifactFile("design", taskKey, 1);
}

export function planFile(taskKey: string): string {
  return artifactFile("plan", taskKey, 1);
}

export function qaFile(taskKey: string): string {
  return artifactFile("qa", taskKey, 1);
}

export function taskSummaryFile(taskKey: string): string {
  return artifactFile("task", taskKey, 1);
}

export function readyToMergeFile(taskKey: string): string {
  return taskWorkspaceFile(taskKey, READY_TO_MERGE_FILE);
}

export function jiraTaskFile(taskKey: string): string {
  return taskWorkspaceFile(taskKey, `${taskKey}.json`);
}

export function jiraDescriptionFile(taskKey: string): string {
  return taskWorkspaceFile(taskKey, `jira-${taskKey}-description.md`);
}

export function autoStateFile(taskKey: string): string {
  return taskWorkspaceFile(taskKey, `.agentweaver-state-${taskKey}.json`);
}

export function planArtifacts(taskKey: string): string[] {
  return [designFile(taskKey), planFile(taskKey), qaFile(taskKey)];
}

export function requireArtifacts(paths: string[], message: string): void {
  const missing = paths.filter((filePath) => !existsSync(filePath));
  if (missing.length > 0) {
    throw new TaskRunnerError(`${message}\nMissing files: ${missing.join(", ")}`);
  }
}
