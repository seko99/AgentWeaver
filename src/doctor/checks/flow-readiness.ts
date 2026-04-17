import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { DoctorImpact, DoctorStatus, WorkflowContinuityState, type DoctorResult } from "../types.js";
import { CATEGORY } from "./category.js";
import { BUILT_IN_COMMAND_FLOW_IDS } from "../../pipeline/flow-catalog.js";
import { validateStructuredArtifact } from "../../structured-artifacts.js";
import type { StructuredArtifactSchemaId } from "../../structured-artifacts.js";
import {
  designJsonFile,
  jiraDescriptionJsonFile,
  latestArtifactIteration,
  planJsonFile,
} from "../../artifacts.js";

interface WorkflowContinuityEntry {
  flowId: string;
  mode?: string;
  state: WorkflowContinuityState;
  reasons: string[];
  nextStep?: string;
}

interface WorkflowContinuitySummary {
  available: number;
  needsPreviousStage: number;
  notConfigured: number;
  invalidState: number;
}

interface WorkflowContinuityData {
  kind: "workflow-continuity";
  scopeKey: string;
  summary: WorkflowContinuitySummary;
  entries: WorkflowContinuityEntry[];
}

interface WorkflowContinuityCheckResult {
  status: DoctorStatus;
  impact: DoctorImpact;
  message: string;
  hint?: string;
  details: string;
  data: WorkflowContinuityData;
}

const GO_BINARY_PATTERNS = ["go", "go.exe"];
const GIT_BINARY_PATTERNS = ["git", "git.exe"];

function statePriority(state: WorkflowContinuityState): number {
  switch (state) {
    case WorkflowContinuityState.InvalidState:
      return 3;
    case WorkflowContinuityState.NotConfigured:
      return 2;
    case WorkflowContinuityState.NeedsPreviousStage:
      return 1;
    case WorkflowContinuityState.Available:
    default:
      return 0;
  }
}

function formatState(state: WorkflowContinuityState): string {
  switch (state) {
    case WorkflowContinuityState.Available:
      return "available";
    case WorkflowContinuityState.NeedsPreviousStage:
      return "requires previous stage outputs";
    case WorkflowContinuityState.NotConfigured:
      return "not configured";
    case WorkflowContinuityState.InvalidState:
      return "invalid state";
    default:
      return state;
  }
}

function setEntryState(entry: WorkflowContinuityEntry, state: WorkflowContinuityState, reason: string): void {
  if (statePriority(state) > statePriority(entry.state)) {
    entry.state = state;
  }
  entry.reasons.push(reason);
}

function createEntry(flowId: string, mode?: string): WorkflowContinuityEntry {
  return {
    flowId,
    ...(mode ? { mode } : {}),
    state: WorkflowContinuityState.Available,
    reasons: [],
  };
}

function findBinary(name: string): string | null {
  const envPath = process.env.PATH ?? "";
  const pathDirs = envPath.split(path.delimiter);
  for (const dir of pathDirs) {
    for (const pattern of name === "go" ? GO_BINARY_PATTERNS : GIT_BINARY_PATTERNS) {
      const fullPath = path.join(dir, pattern);
      if (existsSync(fullPath)) {
        return fullPath;
      }
    }
  }
  return null;
}

function isJiraConfigured(): boolean {
  return !!(process.env.JIRA_API_KEY && process.env.JIRA_BASE_URL);
}

function isGitLabConfigured(): boolean {
  return !!process.env.GITLAB_TOKEN;
}

function getLatestJsonArtifactIteration(scopeKey: string, prefix: string): number | null {
  return latestArtifactIteration(scopeKey, prefix, "json");
}

function checkStructuredArtifactFile(
  entry: WorkflowContinuityEntry,
  artifactPath: string,
  schemaId: StructuredArtifactSchemaId,
  missingReason: string,
  invalidReasonPrefix: string,
): void {
  if (!existsSync(artifactPath)) {
    setEntryState(entry, WorkflowContinuityState.NeedsPreviousStage, missingReason);
    return;
  }

  try {
    validateStructuredArtifact(artifactPath, schemaId);
  } catch (error) {
    setEntryState(
      entry,
      WorkflowContinuityState.InvalidState,
      `${invalidReasonPrefix}: ${(error as Error).message}`,
    );
  }
}

function checkImplementWorkflowContinuity(scopeKey: string): WorkflowContinuityEntry {
  const entry = createEntry("implement");

  const latestDesignIteration = getLatestJsonArtifactIteration(scopeKey, "design");
  const latestPlanIteration = getLatestJsonArtifactIteration(scopeKey, "plan");

  if (latestDesignIteration === null) {
    setEntryState(entry, WorkflowContinuityState.NeedsPreviousStage, "Missing design artifact from the planning stage.");
  } else {
    checkStructuredArtifactFile(
      entry,
      designJsonFile(scopeKey, latestDesignIteration),
      "implementation-design/v1",
      "Missing design artifact from the planning stage.",
      "Design artifact schema is invalid",
    );
  }

  if (latestPlanIteration === null) {
    setEntryState(entry, WorkflowContinuityState.NeedsPreviousStage, "Missing plan artifact from the planning stage.");
  } else {
    checkStructuredArtifactFile(
      entry,
      planJsonFile(scopeKey, latestPlanIteration),
      "implementation-plan/v1",
      "Missing plan artifact from the planning stage.",
      "Plan artifact schema is invalid",
    );
  }

  if (entry.state === WorkflowContinuityState.NeedsPreviousStage) {
    entry.nextStep = "Run plan to generate design, plan, and QA artifacts for this scope.";
  } else if (entry.state === WorkflowContinuityState.InvalidState) {
    entry.nextStep = "Regenerate the planning artifacts for this scope before running implement.";
  }

  return entry;
}

function checkReviewProjectWorkflowContinuity(): WorkflowContinuityEntry {
  return createEntry("review", "project");
}

function checkReviewJiraWorkflowContinuity(scopeKey: string): WorkflowContinuityEntry {
  const entry = createEntry("review", "jira");

  if (!isJiraConfigured()) {
    setEntryState(
      entry,
      WorkflowContinuityState.NotConfigured,
      "Jira integration is not configured (JIRA_API_KEY or JIRA_BASE_URL missing).",
    );
  }

  const latestDesignIteration = getLatestJsonArtifactIteration(scopeKey, "design");
  const latestPlanIteration = getLatestJsonArtifactIteration(scopeKey, "plan");

  if (latestDesignIteration === null) {
    setEntryState(entry, WorkflowContinuityState.NeedsPreviousStage, "Missing design artifact from the planning stage.");
  } else {
    checkStructuredArtifactFile(
      entry,
      designJsonFile(scopeKey, latestDesignIteration),
      "implementation-design/v1",
      "Missing design artifact from the planning stage.",
      "Design artifact schema is invalid",
    );
  }

  if (latestPlanIteration === null) {
    setEntryState(entry, WorkflowContinuityState.NeedsPreviousStage, "Missing plan artifact from the planning stage.");
  } else {
    checkStructuredArtifactFile(
      entry,
      planJsonFile(scopeKey, latestPlanIteration),
      "implementation-plan/v1",
      "Missing plan artifact from the planning stage.",
      "Plan artifact schema is invalid",
    );
  }

  if (entry.state === WorkflowContinuityState.NotConfigured) {
    entry.nextStep = "Configure Jira access and ensure the planning artifacts exist before running review:jira.";
  } else if (entry.state === WorkflowContinuityState.NeedsPreviousStage) {
    entry.nextStep = "Run plan first to generate the design and plan artifacts required by review:jira.";
  } else if (entry.state === WorkflowContinuityState.InvalidState) {
    entry.nextStep = "Regenerate invalid planning artifacts before running review:jira.";
  }

  return entry;
}

function checkPlanJiraWorkflowContinuity(scopeKey: string): WorkflowContinuityEntry {
  const entry = createEntry("plan", "jira");

  if (!isJiraConfigured()) {
    setEntryState(
      entry,
      WorkflowContinuityState.NotConfigured,
      "Jira integration is not configured (JIRA_API_KEY or JIRA_BASE_URL missing).",
    );
  }

  if (!process.env.JIRA_ISSUE_KEY && !scopeKey.includes("@")) {
    setEntryState(
      entry,
      WorkflowContinuityState.NotConfigured,
      "No Jira issue key is available for the current scope.",
    );
  }

  if (entry.state === WorkflowContinuityState.NotConfigured) {
    entry.nextStep = "Set Jira environment variables and provide a Jira issue key or browse URL before running plan:jira.";
  }

  return entry;
}

function checkPlanProjectWorkflowContinuity(scopeKey: string): WorkflowContinuityEntry {
  const entry = createEntry("plan", "project");
  const latestDescriptionIteration = getLatestJsonArtifactIteration(scopeKey, "jira-description");

  if (latestDescriptionIteration === null) {
    setEntryState(
      entry,
      WorkflowContinuityState.NeedsPreviousStage,
      "Missing task description artifact from task-describe.",
    );
  } else {
    checkStructuredArtifactFile(
      entry,
      jiraDescriptionJsonFile(scopeKey, latestDescriptionIteration),
      "jira-description/v1",
      "Missing task description artifact from task-describe.",
      "Task description artifact schema is invalid",
    );
  }

  if (entry.state === WorkflowContinuityState.NeedsPreviousStage) {
    entry.nextStep = "Run task-describe first to create a task description artifact for this scope.";
  } else if (entry.state === WorkflowContinuityState.InvalidState) {
    entry.nextStep = "Regenerate the task description artifact before running plan:project.";
  }

  return entry;
}

function checkGenericWorkflowContinuity(flowId: string): WorkflowContinuityEntry {
  const entry = createEntry(flowId);

  const goFlows = new Set(["run-go-tests-loop", "run-go-linter-loop", "auto-golang"]);
  const gitFlows = new Set(["git-commit", "gitlab-review", "gitlab-diff-review", "mr-description"]);
  const gitLabFlows = new Set(["gitlab-review", "gitlab-diff-review", "mr-description"]);

  if (goFlows.has(flowId) && findBinary("go") === null) {
    setEntryState(entry, WorkflowContinuityState.NotConfigured, "Go binary is not available in PATH.");
    entry.nextStep = "Install Go and ensure the go binary is available in PATH.";
  }

  if (gitFlows.has(flowId) && findBinary("git") === null) {
    setEntryState(entry, WorkflowContinuityState.NotConfigured, "Git binary is not available in PATH.");
    entry.nextStep = "Install Git and ensure the git binary is available in PATH.";
  }

  if (gitLabFlows.has(flowId) && !isGitLabConfigured()) {
    setEntryState(entry, WorkflowContinuityState.NotConfigured, "GitLab integration is not configured (GITLAB_TOKEN missing).");
    entry.nextStep = "Set GITLAB_TOKEN before running this GitLab-backed flow.";
  }

  return entry;
}

function determineWorkflowContinuity(flowId: string, scopeKey: string): WorkflowContinuityEntry[] {
  if (flowId === "implement") {
    return [checkImplementWorkflowContinuity(scopeKey)];
  }

  if (flowId === "review") {
    return [
      checkReviewProjectWorkflowContinuity(),
      checkReviewJiraWorkflowContinuity(scopeKey),
    ];
  }

  if (flowId === "plan") {
    return [
      checkPlanJiraWorkflowContinuity(scopeKey),
      checkPlanProjectWorkflowContinuity(scopeKey),
    ];
  }

  return [checkGenericWorkflowContinuity(flowId)];
}

function getScopeKey(): string {
  const cwd = process.cwd();
  const scopesRoot = path.join(cwd, ".agentweaver", "scopes");
  if (!existsSync(scopesRoot)) {
    return "unknown";
  }
  const entries = readdirSync(scopesRoot);
  if (entries.length === 0) {
    return "unknown";
  }
  return entries[0]!;
}

function buildSummary(entries: WorkflowContinuityEntry[]): WorkflowContinuitySummary {
  return {
    available: entries.filter((entry) => entry.state === WorkflowContinuityState.Available).length,
    needsPreviousStage: entries.filter((entry) => entry.state === WorkflowContinuityState.NeedsPreviousStage).length,
    notConfigured: entries.filter((entry) => entry.state === WorkflowContinuityState.NotConfigured).length,
    invalidState: entries.filter((entry) => entry.state === WorkflowContinuityState.InvalidState).length,
  };
}

function buildMessage(summary: WorkflowContinuitySummary): string {
  const parts = [`${summary.available} flows available`];
  if (summary.needsPreviousStage > 0) {
    parts.push(`${summary.needsPreviousStage} require earlier stage outputs`);
  }
  if (summary.notConfigured > 0) {
    parts.push(`${summary.notConfigured} not configured`);
  }
  if (summary.invalidState > 0) {
    parts.push(`${summary.invalidState} in invalid state`);
  }
  return parts.join(", ");
}

function buildDetails(scopeKey: string, entries: WorkflowContinuityEntry[]): string {
  const lines: string[] = [`scope: ${scopeKey}`];

  for (const entry of entries) {
    const modeSuffix = entry.mode ? `:${entry.mode}` : "";
    lines.push(`  ${entry.flowId}${modeSuffix}: ${formatState(entry.state)}`);
    for (const reason of entry.reasons) {
      lines.push(`    - ${reason}`);
    }
    if (entry.nextStep) {
      lines.push(`    next: ${entry.nextStep}`);
    }
  }

  return lines.join("\n");
}

function performFlowReadinessCheck(): WorkflowContinuityCheckResult {
  const scopeKey = getScopeKey();
  const entries: WorkflowContinuityEntry[] = [];

  for (const flowId of BUILT_IN_COMMAND_FLOW_IDS) {
    entries.push(...determineWorkflowContinuity(flowId, scopeKey));
  }

  const summary = buildSummary(entries);
  const message = buildMessage(summary);
  const details = buildDetails(scopeKey, entries);
  const data: WorkflowContinuityData = {
    kind: "workflow-continuity",
    scopeKey,
    summary,
    entries,
  };

  if (summary.invalidState > 0) {
    return {
      status: DoctorStatus.Warn,
      impact: DoctorImpact.Blocking,
      message,
      hint: "Current scope contains invalid workflow artifacts. Regenerate or clean them up before continuing those flows.",
      details,
      data,
    };
  }

  if (summary.needsPreviousStage > 0 || summary.notConfigured > 0) {
    return {
      status: DoctorStatus.Warn,
      impact: DoctorImpact.Advisory,
      message,
      hint: "These continuity findings describe what can be continued in the current scope and do not affect overall application readiness.",
      details,
      data,
    };
  }

  return {
    status: DoctorStatus.Ok,
    impact: DoctorImpact.Advisory,
    message,
    details,
    data,
  };
}

export const flowReadinessCheck = {
  id: "flow-readiness-01",
  category: CATEGORY.FLOW_READINESS,
  title: "workflow-continuity",
  dependencies: ["env-diagnostics-01", "cwd-context-01"],
  execute: async (): Promise<DoctorResult> => {
    const result = performFlowReadinessCheck();
    return {
      id: "flow-readiness-01",
      impact: result.impact,
      status: result.status,
      title: "workflow-continuity",
      message: result.message,
      ...(result.hint ? { hint: result.hint } : {}),
      details: result.details,
      data: result.data,
    };
  },
};
