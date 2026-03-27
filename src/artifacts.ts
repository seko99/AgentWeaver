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
  mkdirSync(taskArtifactsDir(taskKey), { recursive: true });
  return workspaceDir;
}

export function taskWorkspaceFile(taskKey: string, fileName: string): string {
  return path.join(taskWorkspaceDir(taskKey), fileName);
}

export function taskArtifactsDir(taskKey: string): string {
  return path.join(taskWorkspaceDir(taskKey), ".artifacts");
}

export function taskArtifactsFile(taskKey: string, fileName: string): string {
  return path.join(taskArtifactsDir(taskKey), fileName);
}

export function artifactFile(prefix: string, taskKey: string, iteration: number): string {
  return taskWorkspaceFile(taskKey, `${prefix}-${taskKey}-${iteration}.md`);
}

export function artifactJsonFile(prefix: string, taskKey: string, iteration: number): string {
  return taskArtifactsFile(taskKey, `${prefix}-${taskKey}-${iteration}.json`);
}

export function designFile(taskKey: string): string {
  return artifactFile("design", taskKey, 1);
}

export function designJsonFile(taskKey: string): string {
  return artifactJsonFile("design", taskKey, 1);
}

export function planFile(taskKey: string): string {
  return artifactFile("plan", taskKey, 1);
}

export function planJsonFile(taskKey: string): string {
  return artifactJsonFile("plan", taskKey, 1);
}

export function bugAnalyzeFile(taskKey: string): string {
  return taskWorkspaceFile(taskKey, `bug-analyze-${taskKey}.md`);
}

export function bugAnalyzeJsonFile(taskKey: string): string {
  return taskArtifactsFile(taskKey, `bug-analyze-${taskKey}.json`);
}

export function bugFixDesignFile(taskKey: string): string {
  return taskWorkspaceFile(taskKey, `bug-fix-design-${taskKey}.md`);
}

export function bugFixDesignJsonFile(taskKey: string): string {
  return taskArtifactsFile(taskKey, `bug-fix-design-${taskKey}.json`);
}

export function bugFixPlanFile(taskKey: string): string {
  return taskWorkspaceFile(taskKey, `bug-fix-plan-${taskKey}.md`);
}

export function bugFixPlanJsonFile(taskKey: string): string {
  return taskArtifactsFile(taskKey, `bug-fix-plan-${taskKey}.json`);
}

export function qaFile(taskKey: string): string {
  return artifactFile("qa", taskKey, 1);
}

export function qaJsonFile(taskKey: string): string {
  return artifactJsonFile("qa", taskKey, 1);
}

export function taskSummaryFile(taskKey: string): string {
  return artifactFile("task", taskKey, 1);
}

export function taskSummaryJsonFile(taskKey: string): string {
  return artifactJsonFile("task", taskKey, 1);
}

export function readyToMergeFile(taskKey: string): string {
  return taskWorkspaceFile(taskKey, READY_TO_MERGE_FILE);
}

export function jiraTaskFile(taskKey: string): string {
  return taskArtifactsFile(taskKey, `${taskKey}.json`);
}

export function jiraDescriptionFile(taskKey: string): string {
  return taskWorkspaceFile(taskKey, `jira-${taskKey}-description.md`);
}

export function jiraDescriptionJsonFile(taskKey: string): string {
  return taskArtifactsFile(taskKey, `jira-${taskKey}-description.json`);
}

export function mrDescriptionFile(taskKey: string): string {
  return taskWorkspaceFile(taskKey, `mr-description-${taskKey}.md`);
}

export function mrDescriptionJsonFile(taskKey: string): string {
  return taskArtifactsFile(taskKey, `mr-description-${taskKey}.json`);
}

export function autoStateFile(taskKey: string): string {
  return taskArtifactsFile(taskKey, `.agentweaver-state-${taskKey}.json`);
}

export function planArtifacts(taskKey: string): string[] {
  return [designFile(taskKey), designJsonFile(taskKey), planFile(taskKey), planJsonFile(taskKey), qaFile(taskKey), qaJsonFile(taskKey)];
}

export function bugAnalyzeArtifacts(taskKey: string): string[] {
  return [
    bugAnalyzeFile(taskKey),
    bugAnalyzeJsonFile(taskKey),
    bugFixDesignFile(taskKey),
    bugFixDesignJsonFile(taskKey),
    bugFixPlanFile(taskKey),
    bugFixPlanJsonFile(taskKey),
  ];
}

export function reviewFile(taskKey: string, iteration: number): string {
  return artifactFile("review", taskKey, iteration);
}

export function reviewJsonFile(taskKey: string, iteration: number): string {
  return artifactJsonFile("review", taskKey, iteration);
}

export function reviewReplyFile(taskKey: string, iteration: number): string {
  return artifactFile("review-reply", taskKey, iteration);
}

export function reviewReplyJsonFile(taskKey: string, iteration: number): string {
  return artifactJsonFile("review-reply", taskKey, iteration);
}

export function reviewFixFile(taskKey: string, iteration: number): string {
  return artifactFile("review-fix", taskKey, iteration);
}

export function reviewFixJsonFile(taskKey: string, iteration: number): string {
  return artifactJsonFile("review-fix", taskKey, iteration);
}

export function reviewFixSelectionJsonFile(taskKey: string, iteration: number): string {
  return artifactJsonFile("review-fix-selection", taskKey, iteration);
}

export function requireArtifacts(paths: string[], message: string): void {
  const missing = paths.filter((filePath) => !existsSync(filePath));
  if (missing.length > 0) {
    throw new TaskRunnerError(`${message}\nMissing files: ${missing.join(", ")}`);
  }
}
