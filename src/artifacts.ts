import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { TaskRunnerError } from "./errors.js";
export const READY_TO_MERGE_FILE = "ready-to-merge.md";

export function scopesRootDir(): string {
  return path.join(process.cwd(), ".agentweaver", "scopes");
}

export function scopeWorkspaceDir(scopeKey: string): string {
  return path.join(scopesRootDir(), scopeKey);
}

export function ensureScopeWorkspaceDir(scopeKey: string): string {
  const workspaceDir = scopeWorkspaceDir(scopeKey);
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(scopeArtifactsDir(scopeKey), { recursive: true });
  return workspaceDir;
}

export function scopeWorkspaceFile(scopeKey: string, fileName: string): string {
  return path.join(scopeWorkspaceDir(scopeKey), fileName);
}

export function scopeArtifactsDir(scopeKey: string): string {
  return path.join(scopeWorkspaceDir(scopeKey), ".artifacts");
}

export function scopeArtifactsFile(scopeKey: string, fileName: string): string {
  return path.join(scopeArtifactsDir(scopeKey), fileName);
}

export function artifactManifestSidecarPath(payloadPath: string): string {
  return `${payloadPath}.manifest.json`;
}

export function artifactIndexFile(scopeKey: string): string {
  return scopeArtifactsFile(scopeKey, "artifact-index.json");
}

export function taskWorkspaceDir(taskKey: string): string {
  return scopeWorkspaceDir(taskKey);
}

export function ensureTaskWorkspaceDir(taskKey: string): string {
  return ensureScopeWorkspaceDir(taskKey);
}

export function taskWorkspaceFile(taskKey: string, fileName: string): string {
  return scopeWorkspaceFile(taskKey, fileName);
}

export function taskArtifactsDir(taskKey: string): string {
  return scopeArtifactsDir(taskKey);
}

export function taskArtifactsFile(taskKey: string, fileName: string): string {
  return scopeArtifactsFile(taskKey, fileName);
}

export function artifactFile(prefix: string, taskKey: string, iteration: number): string {
  return taskWorkspaceFile(taskKey, `${prefix}-${taskKey}-${iteration}.md`);
}

export function artifactJsonFile(prefix: string, taskKey: string, iteration: number): string {
  return taskArtifactsFile(taskKey, `${prefix}-${taskKey}-${iteration}.json`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function latestVersionedArtifactIteration(
  taskKey: string,
  prefix: string,
  extension: "md" | "json",
  directory: string,
): number | null {
  if (!existsSync(directory)) {
    return null;
  }
  const re = new RegExp(`^${escapeRegExp(prefix)}-${escapeRegExp(taskKey)}-(\\d+)\\.${extension}$`);
  let maxIteration: number | null = null;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    const match = re.exec(entry.name);
    if (!match) {
      continue;
    }
    const currentIteration = Number.parseInt(match[1] ?? "0", 10);
    maxIteration = maxIteration === null ? currentIteration : Math.max(maxIteration, currentIteration);
  }
  return maxIteration;
}

export function latestArtifactIteration(taskKey: string, prefix: string, extension: "md" | "json" = "md"): number | null {
  return latestVersionedArtifactIteration(
    taskKey,
    prefix,
    extension,
    extension === "md" ? taskWorkspaceDir(taskKey) : taskArtifactsDir(taskKey),
  );
}

export function nextArtifactIteration(taskKey: string, prefix: string, extension: "md" | "json" = "md"): number {
  return (latestArtifactIteration(taskKey, prefix, extension) ?? 0) + 1;
}

function versionedMarkdownArtifactFile(taskKey: string, prefix: string, iteration?: number): string {
  return artifactFile(prefix, taskKey, iteration ?? (latestArtifactIteration(taskKey, prefix, "md") ?? 1));
}

function versionedJsonArtifactFile(taskKey: string, prefix: string, iteration?: number): string {
  return artifactJsonFile(prefix, taskKey, iteration ?? (latestArtifactIteration(taskKey, prefix, "json") ?? 1));
}

export function designFile(taskKey: string, iteration?: number): string {
  return versionedMarkdownArtifactFile(taskKey, "design", iteration);
}

export function designJsonFile(taskKey: string, iteration?: number): string {
  return versionedJsonArtifactFile(taskKey, "design", iteration);
}

export function planFile(taskKey: string, iteration?: number): string {
  return versionedMarkdownArtifactFile(taskKey, "plan", iteration);
}

export function planJsonFile(taskKey: string, iteration?: number): string {
  return versionedJsonArtifactFile(taskKey, "plan", iteration);
}

export function planningQuestionsJsonFile(taskKey: string): string {
  return taskArtifactsFile(taskKey, `planning-questions-${taskKey}.json`);
}

export function planningAnswersJsonFile(taskKey: string): string {
  return taskArtifactsFile(taskKey, `planning-answers-${taskKey}.json`);
}

export function bugAnalyzeFile(taskKey: string, iteration?: number): string {
  return versionedMarkdownArtifactFile(taskKey, "bug-analyze", iteration);
}

export function bugAnalyzeJsonFile(taskKey: string, iteration?: number): string {
  return versionedJsonArtifactFile(taskKey, "bug-analyze", iteration);
}

export function bugFixDesignFile(taskKey: string, iteration?: number): string {
  return versionedMarkdownArtifactFile(taskKey, "bug-fix-design", iteration);
}

export function bugFixDesignJsonFile(taskKey: string, iteration?: number): string {
  return versionedJsonArtifactFile(taskKey, "bug-fix-design", iteration);
}

export function bugFixPlanFile(taskKey: string, iteration?: number): string {
  return versionedMarkdownArtifactFile(taskKey, "bug-fix-plan", iteration);
}

export function bugFixPlanJsonFile(taskKey: string, iteration?: number): string {
  return versionedJsonArtifactFile(taskKey, "bug-fix-plan", iteration);
}

export function qaFile(taskKey: string, iteration?: number): string {
  return versionedMarkdownArtifactFile(taskKey, "qa", iteration);
}

export function qaJsonFile(taskKey: string, iteration?: number): string {
  return versionedJsonArtifactFile(taskKey, "qa", iteration);
}

export function taskSummaryFile(taskKey: string, iteration?: number): string {
  return versionedMarkdownArtifactFile(taskKey, "task", iteration);
}

export function taskSummaryJsonFile(taskKey: string, iteration?: number): string {
  return versionedJsonArtifactFile(taskKey, "task", iteration);
}

export function readyToMergeFile(taskKey: string): string {
  return taskWorkspaceFile(taskKey, READY_TO_MERGE_FILE);
}

export function jiraTaskFile(taskKey: string): string {
  return taskArtifactsFile(taskKey, `${taskKey}.json`);
}

export function jiraTaskEnrichedFile(taskKey: string): string {
  return taskArtifactsFile(taskKey, `${taskKey}-enriched.json`);
}

export function jiraAttachmentsDir(taskKey: string): string {
  return path.join(taskArtifactsDir(taskKey), "jira-attachments");
}

export function jiraAttachmentsManifestFile(taskKey: string): string {
  return taskArtifactsFile(taskKey, `jira-attachments-${taskKey}.json`);
}

export function jiraAttachmentsContextFile(taskKey: string): string {
  return taskWorkspaceFile(taskKey, `jira-attachments-context-${taskKey}.txt`);
}

export function jiraDescriptionFile(taskKey: string, iteration?: number): string {
  return versionedMarkdownArtifactFile(taskKey, "jira-description", iteration);
}

export function jiraDescriptionJsonFile(taskKey: string, iteration?: number): string {
  return versionedJsonArtifactFile(taskKey, "jira-description", iteration);
}

export function taskContextFile(taskKey: string, iteration?: number): string {
  return versionedMarkdownArtifactFile(taskKey, "task-context", iteration);
}

export function taskContextJsonFile(taskKey: string, iteration?: number): string {
  return versionedJsonArtifactFile(taskKey, "task-context", iteration);
}

export function taskDescribeInputJsonFile(taskKey: string): string {
  return taskArtifactsFile(taskKey, `task-describe-input-${taskKey}.json`);
}

export function instantTaskInputJsonFile(taskKey: string): string {
  return taskArtifactsFile(taskKey, `instant-task-input-${taskKey}.json`);
}

export function gitStatusJsonFile(taskKey: string): string {
  return taskArtifactsFile(taskKey, `git-status-${taskKey}.json`);
}

export function gitDiffFile(taskKey: string): string {
  return taskWorkspaceFile(taskKey, `git-diff-${taskKey}.txt`);
}

export function gitCommitMessageJsonFile(taskKey: string): string {
  return taskArtifactsFile(taskKey, `git-commit-message-${taskKey}.json`);
}

export function gitCommitInputJsonFile(taskKey: string): string {
  return taskArtifactsFile(taskKey, `git-commit-input-${taskKey}.json`);
}

export function selectFilesOutputJsonFile(taskKey: string): string {
  return taskArtifactsFile(taskKey, `select-files-output-${taskKey}.json`);
}

export function commitMessageOutputJsonFile(taskKey: string): string {
  return taskArtifactsFile(taskKey, `commit-message-output-${taskKey}.json`);
}

export function mrDescriptionFile(taskKey: string, iteration?: number): string {
  return versionedMarkdownArtifactFile(taskKey, "mr-description", iteration);
}

export function mrDescriptionJsonFile(taskKey: string, iteration?: number): string {
  return versionedJsonArtifactFile(taskKey, "mr-description", iteration);
}

export function gitlabReviewFile(taskKey: string, iteration?: number): string {
  return versionedMarkdownArtifactFile(taskKey, "gitlab-review", iteration);
}

export function gitlabReviewJsonFile(taskKey: string, iteration?: number): string {
  return versionedJsonArtifactFile(taskKey, "gitlab-review", iteration);
}

export function gitlabReviewInputJsonFile(taskKey: string): string {
  return taskArtifactsFile(taskKey, `gitlab-review-input-${taskKey}.json`);
}

export function gitlabDiffFile(taskKey: string, iteration?: number): string {
  return versionedMarkdownArtifactFile(taskKey, "gitlab-diff", iteration);
}

export function gitlabDiffJsonFile(taskKey: string, iteration?: number): string {
  return versionedJsonArtifactFile(taskKey, "gitlab-diff", iteration);
}

export function gitlabDiffReviewInputJsonFile(taskKey: string): string {
  return taskArtifactsFile(taskKey, `gitlab-diff-review-input-${taskKey}.json`);
}

export function flowStateFile(scopeKey: string, flowId: string): string {
  return scopeArtifactsFile(scopeKey, `.agentweaver-flow-state-${encodeURIComponent(flowId)}.json`);
}

export function planArtifacts(taskKey: string, iteration?: number): string[] {
  return [
    designFile(taskKey, iteration),
    designJsonFile(taskKey, iteration),
    planFile(taskKey, iteration),
    planJsonFile(taskKey, iteration),
    qaFile(taskKey, iteration),
    qaJsonFile(taskKey, iteration),
  ];
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

export function designReviewFile(taskKey: string, iteration: number): string {
  return artifactFile("design-review", taskKey, iteration);
}

export function designReviewJsonFile(taskKey: string, iteration: number): string {
  return artifactJsonFile("design-review", taskKey, iteration);
}

export function reviewFixFile(taskKey: string, iteration: number): string {
  return artifactFile("review-fix", taskKey, iteration);
}

export function reviewFixJsonFile(taskKey: string, iteration: number): string {
  return artifactJsonFile("review-fix", taskKey, iteration);
}

export function reviewAssessmentFile(taskKey: string, iteration: number): string {
  return artifactFile("review-assessment", taskKey, iteration);
}

export function reviewAssessmentJsonFile(taskKey: string, iteration: number): string {
  return artifactJsonFile("review-assessment", taskKey, iteration);
}

export function reviewFixSelectionJsonFile(taskKey: string, iteration: number): string {
  return artifactJsonFile("review-fix-selection", taskKey, iteration);
}

export function runGoLinterResultJsonFile(taskKey: string, iteration: number): string {
  return artifactJsonFile("run-go-linter-result", taskKey, iteration);
}

export function runGoTestsResultJsonFile(taskKey: string, iteration: number): string {
  return artifactJsonFile("run-go-tests-result", taskKey, iteration);
}

export function requireArtifacts(paths: string[], message: string): void {
  const missing = paths.filter((filePath) => !existsSync(filePath));
  if (missing.length > 0) {
    throw new TaskRunnerError(`${message}\nMissing files: ${missing.join(", ")}`);
  }
}
