import { existsSync } from "node:fs";

import { TaskRunnerError } from "./errors.js";

export const REVIEW_FILE_RE = /^review-(.+)-(\d+)\.md$/;
export const REVIEW_REPLY_FILE_RE = /^review-reply-(.+)-(\d+)\.md$/;
export const READY_TO_MERGE_FILE = "ready-to-merge.md";

export function artifactFile(prefix: string, taskKey: string, iteration: number): string {
  return `${prefix}-${taskKey}-${iteration}.md`;
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

export function planArtifacts(taskKey: string): string[] {
  return [designFile(taskKey), planFile(taskKey), qaFile(taskKey)];
}

export function requireArtifacts(paths: string[], message: string): void {
  const missing = paths.filter((filePath) => !existsSync(filePath));
  if (missing.length > 0) {
    throw new TaskRunnerError(`${message}\nMissing files: ${missing.join(", ")}`);
  }
}
