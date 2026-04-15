import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { DoctorStatus, type DoctorResult } from "../types.js";
import { CATEGORY } from "./category.js";
import { BUILT_IN_COMMAND_FLOW_IDS } from "../../pipeline/flow-catalog.js";
import { validateStructuredArtifact } from "../../structured-artifacts.js";
import { designJsonFile, planJsonFile, scopeArtifactsDir } from "../../artifacts.js";

type FlowReadinessStatus = "ready" | "not_ready" | "not_configured";

interface FlowReadinessEntry {
  flowId: string;
  mode?: string;
  status: FlowReadinessStatus;
  blockers: string[];
}

interface FlowReadinessCheckResult {
  status: DoctorStatus;
  message: string;
  details: string;
}

const GO_BINARY_PATTERNS = ["go", "go.exe"];
const GIT_BINARY_PATTERNS = ["git", "git.exe"];

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

function checkBinaryPresence(flowId: string): string | null {
  const goFlows = new Set([
    "run-go-tests-loop",
    "run-go-linter-loop",
    "auto-golang",
  ]);
  const gitFlows = new Set(["git-commit", "gitlab-review", "gitlab-diff-review", "mr-description"]);

  if (goFlows.has(flowId)) {
    return findBinary("go");
  }
  if (gitFlows.has(flowId)) {
    return findBinary("git");
  }
  return null;
}

function isJiraConfigured(): boolean {
  return !!(process.env.JIRA_API_KEY && process.env.JIRA_BASE_URL);
}

function isGitLabConfigured(): boolean {
  return !!process.env.GITLAB_TOKEN;
}

function getLatestDesignIteration(scopeKey: string): number | null {
  const artifactsDir = scopeArtifactsDir(scopeKey);
  if (!existsSync(artifactsDir)) {
    return null;
  }
  const files = readdirSync(artifactsDir);
  const designFiles = files.filter((f: string) => /^design-.*-\d+\.json$/.test(f));
  if (designFiles.length === 0) {
    return null;
  }
  const iterations = designFiles.map((f: string) => {
    const match = f.match(/^design-.*-(\d+)\.json$/);
    return match?.[1] ? parseInt(match[1], 10) : 0;
  });
  return Math.max(...iterations);
}

function getLatestPlanIteration(scopeKey: string): number | null {
  const artifactsDir = scopeArtifactsDir(scopeKey);
  if (!existsSync(artifactsDir)) {
    return null;
  }
  const files = readdirSync(artifactsDir);
  const planFiles = files.filter((f: string) => /^plan-.*-\d+\.json$/.test(f));
  if (planFiles.length === 0) {
    return null;
  }
  const iterations = planFiles.map((f: string) => {
    const match = f.match(/^plan-.*-(\d+)\.json$/);
    return match?.[1] ? parseInt(match[1], 10) : 0;
  });
  return Math.max(...iterations);
}

function checkImplementFlowReadiness(scopeKey: string): FlowReadinessEntry {
  const blockers: string[] = [];

  const latestDesignIteration = getLatestDesignIteration(scopeKey);
  const latestPlanIteration = getLatestPlanIteration(scopeKey);

  if (latestDesignIteration === null) {
    blockers.push("design artifact not found");
  } else {
    const designPath = designJsonFile(scopeKey, latestDesignIteration);
    if (!existsSync(designPath)) {
      blockers.push(`design artifact not found at ${designPath}`);
    } else {
      try {
        validateStructuredArtifact(designPath, "implementation-design/v1");
      } catch (error) {
        blockers.push(`design artifact schema invalid: ${(error as Error).message}`);
      }
    }
  }

  if (latestPlanIteration === null) {
    blockers.push("plan artifact not found");
  } else {
    const planPath = planJsonFile(scopeKey, latestPlanIteration);
    if (!existsSync(planPath)) {
      blockers.push(`plan artifact not found at ${planPath}`);
    } else {
      try {
        validateStructuredArtifact(planPath, "implementation-plan/v1");
      } catch (error) {
        blockers.push(`plan artifact schema invalid: ${(error as Error).message}`);
      }
    }
  }

  return {
    flowId: "implement",
    status: blockers.length === 0 ? "ready" : "not_ready",
    blockers,
  };
}

function checkReviewProjectFlowReadiness(scopeKey: string): FlowReadinessEntry {
  const blockers: string[] = [];

  const latestDesignIteration = getLatestDesignIteration(scopeKey);
  if (latestDesignIteration === null) {
    blockers.push("design artifact not found");
  } else {
    const designPath = designJsonFile(scopeKey, latestDesignIteration);
    if (!existsSync(designPath)) {
      blockers.push(`design artifact not found at ${designPath}`);
    }
  }

  return {
    flowId: "review",
    mode: "project",
    status: blockers.length === 0 ? "ready" : "not_ready",
    blockers,
  };
}

function checkReviewJiraFlowReadiness(scopeKey: string): FlowReadinessEntry {
  const blockers: string[] = [];

  if (!isJiraConfigured()) {
    blockers.push("Jira not configured (JIRA_API_KEY or JIRA_BASE_URL missing)");
  }

  const latestDesignIteration = getLatestDesignIteration(scopeKey);
  if (latestDesignIteration === null) {
    blockers.push("design artifact not found");
  } else {
    const designPath = designJsonFile(scopeKey, latestDesignIteration);
    if (!existsSync(designPath)) {
      blockers.push(`design artifact not found at ${designPath}`);
    }
  }

  const latestPlanIteration = getLatestPlanIteration(scopeKey);
  if (latestPlanIteration === null) {
    blockers.push("plan artifact not found");
  } else {
    const planPath = planJsonFile(scopeKey, latestPlanIteration);
    if (!existsSync(planPath)) {
      blockers.push(`plan artifact not found at ${planPath}`);
    }
  }

  return {
    flowId: "review",
    mode: "jira",
    status: blockers.length === 0 ? "ready" : "not_ready",
    blockers,
  };
}

function checkPlanJiraFlowReadiness(scopeKey: string): FlowReadinessEntry {
  const blockers: string[] = [];

  if (!isJiraConfigured()) {
    blockers.push("Jira not configured (JIRA_API_KEY or JIRA_BASE_URL missing)");
  }

  if (!process.env.JIRA_ISSUE_KEY && !scopeKey.includes("@")) {
    blockers.push("Jira issue key not available");
  }

  return {
    flowId: "plan",
    mode: "jira",
    status: blockers.length === 0 ? "ready" : "not_ready",
    blockers,
  };
}

function checkPlanProjectFlowReadiness(scopeKey: string): FlowReadinessEntry {
  const blockers: string[] = [];

  const latestDesignIteration = getLatestDesignIteration(scopeKey);
  if (latestDesignIteration === null) {
    blockers.push("design artifact not found (task-describe output required)");
  } else {
    const designPath = designJsonFile(scopeKey, latestDesignIteration);
    if (!existsSync(designPath)) {
      blockers.push("design artifact not found");
    }
  }

  return {
    flowId: "plan",
    mode: "project",
    status: blockers.length === 0 ? "ready" : "not_ready",
    blockers,
  };
}

function checkGenericFlowReadiness(flowId: string, scopeKey: string): FlowReadinessEntry {
  const blockers: string[] = [];

  const binaryPath = checkBinaryPresence(flowId);
  if (binaryPath === null) {
    const requiredBinaries: Record<string, string> = {
      "run-go-tests-loop": "go",
      "run-go-linter-loop": "go",
      "auto-golang": "go",
      "git_commit": "git",
      "gitlab-review": "git",
      "gitlab-diff-review": "git",
      "mr-description": "git",
    };
    const required = requiredBinaries[flowId];
    if (required) {
      blockers.push(`${required} binary not found in PATH`);
    }
  }

  const jiraFlows = new Set(["gitlab-review", "gitlab-diff-review", "mr-description"]);
  if (jiraFlows.has(flowId) && isGitLabConfigured()) {
    // GitLab configured - could add connectivity check here
  }

  return {
    flowId,
    status: blockers.length === 0 ? "ready" : "not_ready",
    blockers,
  };
}

function determineFlowReadiness(flowId: string, scopeKey: string): FlowReadinessEntry[] {
  if (flowId === "implement") {
    return [checkImplementFlowReadiness(scopeKey)];
  }

  if (flowId === "review") {
    return [
      checkReviewProjectFlowReadiness(scopeKey),
      checkReviewJiraFlowReadiness(scopeKey),
    ];
  }

  if (flowId === "plan") {
    return [
      checkPlanJiraFlowReadiness(scopeKey),
      checkPlanProjectFlowReadiness(scopeKey),
    ];
  }

  return [checkGenericFlowReadiness(flowId, scopeKey)];
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

function performFlowReadinessCheck(): FlowReadinessCheckResult {
  const scopeKey = getScopeKey();
  const allEntries: FlowReadinessEntry[] = [];

  for (const flowId of BUILT_IN_COMMAND_FLOW_IDS) {
    const entries = determineFlowReadiness(flowId, scopeKey);
    allEntries.push(...entries);
  }

  const readyCount = allEntries.filter((e) => e.status === "ready").length;
  const notReadyCount = allEntries.filter((e) => e.status === "not_ready").length;
  const notConfiguredCount = allEntries.filter((e) => e.status === "not_configured").length;

  const lines: string[] = [];
  for (const entry of allEntries) {
    const modeStr = entry.mode ? `:${entry.mode}` : "";
    const statusStr = entry.status === "ready" ? "✓ ready" : entry.status === "not_configured" ? "⚠ not configured" : "✗ not ready";
    lines.push(`  ${entry.flowId}${modeStr}: ${statusStr}`);
    for (const blocker of entry.blockers) {
      lines.push(`    - ${blocker}`);
    }
  }

  const overallStatus = notReadyCount > 0 ? DoctorStatus.Fail : notConfiguredCount > 0 ? DoctorStatus.Warn : DoctorStatus.Ok;
  const message = `${readyCount} flows ready, ${notReadyCount} not ready, ${notConfiguredCount} not configured`;

  return {
    status: overallStatus,
    message,
    details: lines.join("\n"),
  };
}

export const flowReadinessCheck = {
  id: "flow-readiness-01",
  category: CATEGORY.FLOW_READINESS,
  title: "flow-readiness",
  dependencies: ["env-diagnostics-01", "cwd-context-01"],
  execute: async (): Promise<DoctorResult> => {
    const result = performFlowReadinessCheck();
    return {
      id: "flow-readiness-01",
      status: result.status,
      title: "flow-readiness",
      message: result.message,
      details: result.details,
    };
  },
};