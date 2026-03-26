#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import type { RuntimeServices } from "./executors/types.js";
import {
  REVIEW_FILE_RE,
  REVIEW_REPLY_FILE_RE,
  autoStateFile,
  bugAnalyzeArtifacts,
  bugAnalyzeJsonFile,
  bugFixDesignJsonFile,
  bugFixPlanJsonFile,
  ensureTaskWorkspaceDir,
  jiraTaskFile,
  planArtifacts,
  readyToMergeFile,
  requireArtifacts,
  taskWorkspaceDir,
  taskSummaryFile,
} from "./artifacts.js";
import { TaskRunnerError } from "./errors.js";
import { buildJiraApiUrl, buildJiraBrowseUrl, extractIssueKey, requireJiraTaskFile } from "./jira.js";
import { validateStructuredArtifacts } from "./structured-artifacts.js";
import { summarizeBuildFailure as summarizeBuildFailureViaPipeline } from "./pipeline/build-failure-summary.js";
import { createPipelineContext } from "./pipeline/context.js";
import { loadAutoFlow } from "./pipeline/auto-flow.js";
import { loadDeclarativeFlow } from "./pipeline/declarative-flows.js";
import { findPhaseById, runExpandedPhase } from "./pipeline/declarative-flow-runner.js";
import { runPreflightFlow } from "./pipeline/flows/preflight-flow.js";
import type { FlowExecutionState } from "./pipeline/spec-types.js";
import { resolveCmd, resolveDockerComposeCmd } from "./runtime/command-resolution.js";
import { defaultDockerComposeFile, dockerRuntimeEnv } from "./runtime/docker-runtime.js";
import { runCommand } from "./runtime/process-runner.js";
import { InteractiveUi, type InteractiveFlowDefinition } from "./interactive-ui.js";
import { bye, getOutputAdapter, printError, printInfo, printPanel, printPrompt, printSummary, setFlowExecutionState } from "./tui.js";

const COMMANDS = [
  "bug-analyze",
  "bug-fix",
  "mr-description",
  "plan",
  "task-describe",
  "implement",
  "review",
  "review-fix",
  "test",
  "test-fix",
  "test-linter-fix",
  "run-tests-loop",
  "run-linter-loop",
  "auto",
  "auto-status",
  "auto-reset",
] as const;

type CommandName = (typeof COMMANDS)[number];

const AUTO_STATE_SCHEMA_VERSION = 3;
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(MODULE_DIR, "..");
const runtimeServices: RuntimeServices = {
  resolveCmd,
  resolveDockerComposeCmd,
  dockerRuntimeEnv: () => dockerRuntimeEnv(PACKAGE_ROOT),
  runCommand,
};

type Config = {
  command: CommandName;
  jiraRef: string;
  reviewFixPoints?: string | null;
  extraPrompt?: string | null;
  autoFromPhase?: string | null;
  dryRun: boolean;
  verbose: boolean;
  dockerComposeFile: string;
  jiraIssueKey: string;
  taskKey: string;
  jiraBrowseUrl: string;
  jiraApiUrl: string;
  jiraTaskFile: string;
};

type AutoStepState = {
  id: string;
  status: "pending" | "running" | "failed" | "done" | "skipped";
  startedAt?: string | null;
  finishedAt?: string | null;
  returnCode?: number | null;
  note?: string | null;
};

type AutoPipelineState = {
  schemaVersion: number;
  issueKey: string;
  jiraRef: string;
  status: string;
  currentStep?: string | null;
  maxReviewIterations: number;
  updatedAt: string;
  lastError?: { step?: string; returnCode?: number; message?: string } | null;
  steps: AutoStepState[];
  executionState: FlowExecutionState;
};

type ParsedArgs = {
  command: CommandName;
  jiraRef: string;
  dry: boolean;
  verbose: boolean;
  prompt?: string;
  autoFromPhase?: string;
  helpPhases: boolean;
};

function usage(): string {
  return `Usage:
  agentweaver <jira-browse-url|jira-issue-key>
  agentweaver --force <jira-browse-url|jira-issue-key>
  agentweaver bug-analyze [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  agentweaver bug-fix [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  agentweaver mr-description [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  agentweaver plan [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  agentweaver task-describe [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  agentweaver implement [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  agentweaver review [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  agentweaver review-fix [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  agentweaver test [--dry] [--verbose] <jira-browse-url|jira-issue-key>
  agentweaver test-fix [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  agentweaver test-linter-fix [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  agentweaver run-tests-loop [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  agentweaver run-linter-loop [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  agentweaver auto [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  agentweaver auto [--dry] [--verbose] [--prompt <text>] --from <phase> <jira-browse-url|jira-issue-key>
  agentweaver auto --help-phases
  agentweaver auto-status <jira-browse-url|jira-issue-key>
  agentweaver auto-reset <jira-browse-url|jira-issue-key>

Interactive Mode:
  When started with only a Jira task, the script opens an interactive UI.
  Use Up/Down to select a flow, Enter to confirm launch, h for help, q to exit.

Flags:
  --version       Show package version
  --force         In interactive mode, force refresh Jira task and task summary
  --dry           Fetch Jira task, but print docker/codex/claude commands instead of executing them
  --verbose       Show live stdout/stderr of launched commands
  --prompt        Extra prompt text appended to the base prompt

Required environment variables:
  JIRA_API_KEY    Jira API key used in Authorization: Bearer <token> for Jira-backed flows

Optional environment variables:
  JIRA_BASE_URL
  AGENTWEAVER_HOME
  DOCKER_COMPOSE_BIN
  CODEX_BIN
  CODEX_MODEL
  CLAUDE_BIN
  CLAUDE_MODEL`;
}

function packageVersion(): string {
  const packageJsonPath = path.join(PACKAGE_ROOT, "package.json");
  const raw = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
  if (typeof raw.version !== "string" || !raw.version.trim()) {
    throw new TaskRunnerError(`Package version is missing in ${packageJsonPath}`);
  }
  return raw.version;
}

function nowIso8601(): string {
  return new Date().toISOString();
}

function normalizeAutoPhaseId(phaseId: string): string {
  return phaseId.trim().toLowerCase().replaceAll("-", "_");
}

function buildAutoSteps(): AutoStepState[] {
  return loadAutoFlow().phases.map((phase) => ({
    id: phase.id,
    status: "pending",
  }));
}

function autoPhaseIds(): string[] {
  return buildAutoSteps().map((step) => step.id);
}

function validateAutoPhaseId(phaseId: string): string {
  const normalized = normalizeAutoPhaseId(phaseId);
  if (!autoPhaseIds().includes(normalized)) {
    throw new TaskRunnerError(
      `Unknown auto phase: ${phaseId}\nUse 'agentweaver auto --help-phases' or '/help auto' to list valid phases.`,
    );
  }
  return normalized;
}

function createAutoPipelineState(config: Config): AutoPipelineState {
  const autoFlow = loadAutoFlow();
  const maxReviewIterations = autoFlow.phases.filter((phase) => /^review_\d+$/.test(phase.id)).length;
  return {
    schemaVersion: AUTO_STATE_SCHEMA_VERSION,
    issueKey: config.taskKey,
    jiraRef: config.jiraRef,
    status: "pending",
    currentStep: null,
    maxReviewIterations,
    updatedAt: nowIso8601(),
    steps: buildAutoSteps(),
    executionState: {
      flowKind: autoFlow.kind,
      flowVersion: autoFlow.version,
      terminated: false,
      phases: [],
    },
  };
}

function stripExecutionStatePayload(executionState: FlowExecutionState): FlowExecutionState {
  return {
    flowKind: executionState.flowKind,
    flowVersion: executionState.flowVersion,
    terminated: executionState.terminated,
    ...(executionState.terminationReason ? { terminationReason: executionState.terminationReason } : {}),
    phases: executionState.phases.map((phase) => ({
      id: phase.id,
      status: phase.status,
      repeatVars: { ...phase.repeatVars },
      ...(phase.startedAt ? { startedAt: phase.startedAt } : {}),
      ...(phase.finishedAt ? { finishedAt: phase.finishedAt } : {}),
      steps: phase.steps.map((step) => ({
        id: step.id,
        status: step.status,
        ...(step.startedAt ? { startedAt: step.startedAt } : {}),
        ...(step.finishedAt ? { finishedAt: step.finishedAt } : {}),
        ...(step.stopFlow !== undefined ? { stopFlow: step.stopFlow } : {}),
      })),
    })),
  };
}

function loadAutoPipelineState(config: Config): AutoPipelineState | null {
  const filePath = autoStateFile(config.taskKey);
  if (!existsSync(filePath)) {
    return null;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new TaskRunnerError(`Failed to parse auto state file ${filePath}: ${(error as Error).message}`);
  }

  if (!raw || typeof raw !== "object") {
    throw new TaskRunnerError(`Invalid auto state file format: ${filePath}`);
  }

  const state = raw as AutoPipelineState;
  if (state.schemaVersion !== AUTO_STATE_SCHEMA_VERSION) {
    throw new TaskRunnerError(`Unsupported auto state schema in ${filePath}: ${state.schemaVersion}`);
  }
  if (!state.executionState) {
    const autoFlow = loadAutoFlow();
    state.executionState = {
      flowKind: autoFlow.kind,
      flowVersion: autoFlow.version,
      terminated: false,
      phases: [],
    };
  }
  syncAutoStepsFromExecutionState(state);
  return state;
}

function saveAutoPipelineState(state: AutoPipelineState): void {
  state.updatedAt = nowIso8601();
  ensureTaskWorkspaceDir(state.issueKey);
  writeFileSync(
    autoStateFile(state.issueKey),
    `${JSON.stringify(
      {
        ...state,
        executionState: stripExecutionStatePayload(state.executionState),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function syncAndSaveAutoPipelineState(state: AutoPipelineState): void {
  syncAutoStepsFromExecutionState(state);
  saveAutoPipelineState(state);
}

function resetAutoPipelineState(config: Config): boolean {
  const filePath = autoStateFile(config.taskKey);
  if (!existsSync(filePath)) {
    return false;
  }
  rmSync(filePath);
  return true;
}

function nextAutoStep(state: AutoPipelineState): AutoStepState | null {
  return state.steps.find((step) => ["running", "failed", "pending"].includes(step.status)) ?? null;
}

function findCurrentExecutionStep(state: AutoPipelineState): string | null {
  for (const phase of state.executionState.phases) {
    const runningStep = phase.steps.find((step) => step.status === "running");
    if (runningStep) {
      return `${phase.id}:${runningStep.id}`;
    }
  }
  return null;
}

function deriveAutoPipelineStatus(state: AutoPipelineState): string {
  if (state.lastError || state.steps.some((candidate) => candidate.status === "failed")) {
    return "blocked";
  }
  if (state.executionState.terminated) {
    return "completed";
  }
  if (state.steps.some((candidate) => candidate.status === "running")) {
    return "running";
  }
  if (state.steps.some((candidate) => candidate.status === "pending")) {
    return "pending";
  }
  if (state.steps.some((candidate) => candidate.status === "skipped")) {
    return "completed";
  }
  if (state.steps.every((candidate) => candidate.status === "done")) {
    return "completed";
  }
  return state.status;
}

function printAutoState(state: AutoPipelineState): void {
  const currentStep = findCurrentExecutionStep(state) ?? state.currentStep ?? "-";
  const lines = [
    `Issue: ${state.issueKey}`,
    `Status: ${deriveAutoPipelineStatus(state)}`,
    `Current step: ${currentStep}`,
    `Updated: ${state.updatedAt}`,
  ];
  if (state.lastError) {
    lines.push(
      `Last error: ${state.lastError.step ?? "-"} (exit ${state.lastError.returnCode ?? "-"}, ${state.lastError.message ?? "-"})`,
    );
  }
  lines.push("");
  for (const step of state.steps) {
    lines.push(`[${step.status}] ${step.id}${step.note ? ` (${step.note})` : ""}`);
    const phaseState = state.executionState.phases.find((candidate) => candidate.id === step.id);
    for (const childStep of phaseState?.steps ?? []) {
      lines.push(`  - [${childStep.status}] ${childStep.id}`);
    }
  }
  if (state.executionState.terminated) {
    lines.push("", `Execution terminated: ${state.executionState.terminationReason ?? "yes"}`);
  }
  printPanel("Auto Status", lines.join("\n"), "cyan");
}

function syncAutoStepsFromExecutionState(state: AutoPipelineState): void {
  for (const step of state.steps) {
    const phaseState = state.executionState.phases.find((candidate) => candidate.id === step.id);
    if (!phaseState) {
      continue;
    }
    step.status = phaseState.status;
    step.startedAt = phaseState.startedAt ?? null;
    step.finishedAt = phaseState.finishedAt ?? null;
    step.note = null;
    if (phaseState.status === "skipped") {
      step.note = "condition not met";
      step.returnCode ??= 0;
    } else if (phaseState.status === "done") {
      step.returnCode ??= 0;
      if (state.executionState.terminated && state.executionState.terminationReason?.startsWith(`Stopped by ${step.id}:`)) {
        step.note = "stop condition met";
      }
    }
  }
  state.currentStep = findCurrentExecutionStep(state);
  state.status = deriveAutoPipelineStatus(state);
}

function printAutoPhasesHelp(): void {
  const phaseLines = ["Available auto phases:", "", ...autoPhaseIds()];
  phaseLines.push("", "You can resume auto from a phase with:", "agentweaver auto --from <phase> <jira>", "or in interactive mode:", "/auto --from <phase>");
  printPanel("Auto Phases", phaseLines.join("\n"), "magenta");
}

function loadEnvFile(envFilePath: string): void {
  if (!existsSync(envFilePath)) {
    return;
  }

  const lines = readFileSync(envFilePath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    if (line.startsWith("export ")) {
      line = line.slice(7).trim();
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    let value = line.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function nextReviewIterationForTask(taskKey: string): number {
  let maxIndex = 0;
  const workspaceDir = taskWorkspaceDir(taskKey);
  if (!existsSync(workspaceDir)) {
    return 1;
  }
  for (const entry of readdirSync(workspaceDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    const match = REVIEW_FILE_RE.exec(entry.name) ?? REVIEW_REPLY_FILE_RE.exec(entry.name);
    if (match && match[1] === taskKey) {
      maxIndex = Math.max(maxIndex, Number.parseInt(match[2] ?? "0", 10));
    }
  }
  return maxIndex + 1;
}

function latestReviewReplyIteration(taskKey: string): number | null {
  let maxIndex: number | null = null;
  const workspaceDir = taskWorkspaceDir(taskKey);
  if (!existsSync(workspaceDir)) {
    return null;
  }
  for (const entry of readdirSync(workspaceDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    const match = REVIEW_REPLY_FILE_RE.exec(entry.name);
    if (match && match[1] === taskKey) {
      const current = Number.parseInt(match[2] ?? "0", 10);
      maxIndex = maxIndex === null ? current : Math.max(maxIndex, current);
    }
  }
  return maxIndex;
}

function buildConfig(
  command: CommandName,
  jiraRef: string,
  options: {
    reviewFixPoints?: string | null;
    extraPrompt?: string | null;
    autoFromPhase?: string | null;
    dryRun?: boolean;
    verbose?: boolean;
  } = {},
): Config {
  const jiraIssueKey = extractIssueKey(jiraRef);
  ensureTaskWorkspaceDir(jiraIssueKey);
  return {
    command,
    jiraRef,
    reviewFixPoints: options.reviewFixPoints ?? null,
    extraPrompt: options.extraPrompt ?? null,
    autoFromPhase: options.autoFromPhase ? validateAutoPhaseId(options.autoFromPhase) : null,
    dryRun: options.dryRun ?? false,
    verbose: options.verbose ?? false,
    dockerComposeFile: defaultDockerComposeFile(PACKAGE_ROOT),
    jiraIssueKey,
    taskKey: jiraIssueKey,
    jiraBrowseUrl: buildJiraBrowseUrl(jiraRef),
    jiraApiUrl: buildJiraApiUrl(jiraRef),
    jiraTaskFile: jiraTaskFile(jiraIssueKey),
  };
}

function checkPrerequisites(config: Config): void {
  if (
    config.command === "bug-analyze" ||
    config.command === "bug-fix" ||
    config.command === "mr-description" ||
    config.command === "plan" ||
    config.command === "task-describe" ||
    config.command === "review" ||
    config.command === "run-tests-loop" ||
    config.command === "run-linter-loop"
  ) {
    resolveCmd("codex", "CODEX_BIN");
  }
  if (config.command === "review") {
    resolveCmd("claude", "CLAUDE_BIN");
  }
  if (["implement", "review-fix", "test", "run-tests-loop", "run-linter-loop"].includes(config.command)) {
    resolveDockerComposeCmd();
    if (!existsSync(config.dockerComposeFile)) {
      throw new TaskRunnerError(`docker-compose file not found: ${config.dockerComposeFile}`);
    }
  }
}

function checkAutoPrerequisites(config: Config): void {
  resolveCmd("codex", "CODEX_BIN");
  resolveCmd("claude", "CLAUDE_BIN");
  resolveDockerComposeCmd();
  if (!existsSync(config.dockerComposeFile)) {
    throw new TaskRunnerError(`docker-compose file not found: ${config.dockerComposeFile}`);
  }
}

function autoFlowParams(config: Config): Record<string, unknown> {
  return {
    jiraApiUrl: config.jiraApiUrl,
    taskKey: config.taskKey,
    dockerComposeFile: config.dockerComposeFile,
    extraPrompt: config.extraPrompt,
    reviewFixPoints: config.reviewFixPoints,
  };
}

function declarativeFlowDefinition(id: string, label: string, fileName: string): InteractiveFlowDefinition {
  const flow = loadDeclarativeFlow(fileName);
  return {
    id,
    label,
    phases: flow.phases.map((phase) => ({
      id: phase.id,
      repeatVars: Object.fromEntries(
        Object.entries(phase.repeatVars).map(([key, value]) => [key, value as string | number | boolean | null]),
      ),
      steps: phase.steps.map((step) => ({
        id: step.id,
      })),
    })),
  };
}

function autoFlowDefinition(): InteractiveFlowDefinition {
  const flow = loadAutoFlow();
  return {
    id: "auto",
    label: "auto",
    phases: flow.phases.map((phase) => ({
      id: phase.id,
      repeatVars: Object.fromEntries(
        Object.entries(phase.repeatVars).map(([key, value]) => [key, value as string | number | boolean | null]),
      ),
      steps: phase.steps.map((step) => ({
        id: step.id,
      })),
    })),
  };
}

function interactiveFlowDefinitions(): InteractiveFlowDefinition[] {
  return [
    autoFlowDefinition(),
    declarativeFlowDefinition("bug-analyze", "bug-analyze", "bug-analyze.json"),
    declarativeFlowDefinition("bug-fix", "bug-fix", "bug-fix.json"),
    declarativeFlowDefinition("mr-description", "mr-description", "mr-description.json"),
    declarativeFlowDefinition("plan", "plan", "plan.json"),
    declarativeFlowDefinition("task-describe", "task-describe", "task-describe.json"),
    declarativeFlowDefinition("implement", "implement", "implement.json"),
    declarativeFlowDefinition("review", "review", "review.json"),
    declarativeFlowDefinition("review-fix", "review-fix", "review-fix.json"),
    declarativeFlowDefinition("test", "test", "test.json"),
    declarativeFlowDefinition("test-fix", "test-fix", "test-fix.json"),
    declarativeFlowDefinition("test-linter-fix", "test-linter-fix", "test-linter-fix.json"),
    declarativeFlowDefinition("run-tests-loop", "run-tests-loop", "run-tests-loop.json"),
    declarativeFlowDefinition("run-linter-loop", "run-linter-loop", "run-linter-loop.json"),
  ];
}

function publishFlowState(flowId: string, executionState: FlowExecutionState): void {
  setFlowExecutionState(flowId, stripExecutionStatePayload(executionState));
}

async function runDeclarativeFlowBySpecFile(
  fileName: string,
  config: Config,
  flowParams: Record<string, unknown>,
): Promise<void> {
  const context = createPipelineContext({
    issueKey: config.taskKey,
    jiraRef: config.jiraRef,
    dryRun: config.dryRun,
    verbose: config.verbose,
    runtime: runtimeServices,
  });
  const flow = loadDeclarativeFlow(fileName);
  const executionState: FlowExecutionState = {
    flowKind: flow.kind,
    flowVersion: flow.version,
    terminated: false,
    phases: [],
  };
  publishFlowState(config.command, executionState);
  for (const phase of flow.phases) {
    await runExpandedPhase(phase, context, flowParams, flow.constants, {
      executionState,
      flowKind: flow.kind,
      flowVersion: flow.version,
      onStateChange: async (state) => {
        publishFlowState(config.command, state);
      },
    });
  }
}

async function runAutoPhaseViaSpec(
  config: Config,
  phaseId: string,
  executionState: FlowExecutionState,
  state?: AutoPipelineState,
): Promise<"done" | "skipped"> {
  const context = createPipelineContext({
    issueKey: config.taskKey,
    jiraRef: config.jiraRef,
    dryRun: config.dryRun,
    verbose: config.verbose,
    runtime: runtimeServices,
  });
  const autoFlow = loadAutoFlow();
  const phase = findPhaseById(autoFlow.phases, phaseId);
  publishFlowState("auto", executionState);
  try {
    const result = await runExpandedPhase(phase, context, autoFlowParams(config), autoFlow.constants, {
      executionState,
      flowKind: autoFlow.kind,
      flowVersion: autoFlow.version,
      onStateChange: async (state) => {
        publishFlowState("auto", state);
      },
      onStepStart: async (_phase, step) => {
        if (!state) {
          return;
        }
        state.currentStep = `${phaseId}:${step.id}`;
        saveAutoPipelineState(state);
      },
    });
    if (state) {
      state.executionState = result.executionState;
      syncAndSaveAutoPipelineState(state);
    }
    return result.status === "skipped" ? "skipped" : "done";
  } catch (error) {
    if (!config.dryRun) {
      const output = String((error as { output?: string }).output ?? "");
      if (output.trim()) {
        printError("Build verification failed");
        printSummary("Build Failure Summary", await summarizeBuildFailure(output));
      }
    }
    throw error;
  }
}

function rewindAutoPipelineState(state: AutoPipelineState, phaseId: string): void {
  const targetPhaseId = validateAutoPhaseId(phaseId);
  let phaseSeen = false;
  for (const step of state.steps) {
    if (step.id === targetPhaseId) {
      phaseSeen = true;
    }
    if (phaseSeen) {
      step.status = "pending";
      step.startedAt = null;
      step.finishedAt = null;
      step.returnCode = null;
      step.note = null;
    } else {
      step.status = "done";
      step.returnCode = 0;
      step.finishedAt ??= nowIso8601();
    }
  }
  state.status = "pending";
  state.currentStep = null;
  state.lastError = null;
  const targetIndex = state.executionState.phases.findIndex((phase) => phase.id === targetPhaseId);
  if (targetIndex >= 0) {
    state.executionState.phases = state.executionState.phases.slice(0, targetIndex);
  }
  state.executionState.terminated = false;
  delete state.executionState.terminationReason;
}

async function summarizeBuildFailure(output: string): Promise<string> {
  return summarizeBuildFailureViaPipeline(
    createPipelineContext({
      issueKey: "build-failure-summary",
      jiraRef: "build-failure-summary",
      dryRun: false,
      verbose: false,
      runtime: runtimeServices,
    }),
    output,
  );
}

async function executeCommand(config: Config, runFollowupVerify = true): Promise<boolean> {
  if (config.command === "auto") {
    await runAutoPipeline(config);
    return false;
  }
  if (config.command === "auto-status") {
    const state = loadAutoPipelineState(config);
    if (!state) {
      printPanel("Auto Status", `No auto state file found for ${config.taskKey}.`, "yellow");
      return false;
    }
    printAutoState(state);
    return false;
  }
  if (config.command === "auto-reset") {
    const removed = resetAutoPipelineState(config);
    printPanel("Auto Reset", removed ? `State file ${autoStateFile(config.taskKey)} removed.` : "No auto state file found.", "yellow");
    return false;
  }

  checkPrerequisites(config);
  process.env.JIRA_BROWSE_URL = config.jiraBrowseUrl;
  process.env.JIRA_API_URL = config.jiraApiUrl;
  process.env.JIRA_TASK_FILE = config.jiraTaskFile;

  if (config.command === "plan") {
    if (config.verbose) {
      process.stdout.write(`Fetching Jira issue from browse URL: ${config.jiraBrowseUrl}\n`);
      process.stdout.write(`Resolved Jira API URL: ${config.jiraApiUrl}\n`);
      process.stdout.write(`Saving Jira issue JSON to: ${config.jiraTaskFile}\n`);
    }
    await runDeclarativeFlowBySpecFile("plan.json", config, {
      jiraApiUrl: config.jiraApiUrl,
      taskKey: config.taskKey,
      extraPrompt: config.extraPrompt,
    });
    return false;
  }

  if (config.command === "bug-analyze") {
    if (config.verbose) {
      process.stdout.write(`Fetching Jira issue from browse URL: ${config.jiraBrowseUrl}\n`);
      process.stdout.write(`Resolved Jira API URL: ${config.jiraApiUrl}\n`);
      process.stdout.write(`Saving Jira issue JSON to: ${config.jiraTaskFile}\n`);
    }
    await runDeclarativeFlowBySpecFile("bug-analyze.json", config, {
      jiraApiUrl: config.jiraApiUrl,
      taskKey: config.taskKey,
      extraPrompt: config.extraPrompt,
    });
    return false;
  }

  if (config.command === "bug-fix") {
    requireJiraTaskFile(config.jiraTaskFile);
    requireArtifacts(bugAnalyzeArtifacts(config.taskKey), "Bug-fix mode requires bug-analyze artifacts from the bug analysis phase.");
    validateStructuredArtifacts(
      [
        { path: bugAnalyzeJsonFile(config.taskKey), schemaId: "bug-analysis/v1" },
        { path: bugFixDesignJsonFile(config.taskKey), schemaId: "bug-fix-design/v1" },
        { path: bugFixPlanJsonFile(config.taskKey), schemaId: "bug-fix-plan/v1" },
      ],
      "Bug-fix mode requires valid structured artifacts from the bug analysis phase.",
    );
    await runDeclarativeFlowBySpecFile("bug-fix.json", config, {
      taskKey: config.taskKey,
      extraPrompt: config.extraPrompt,
    });
    return false;
  }

  if (config.command === "mr-description") {
    requireJiraTaskFile(config.jiraTaskFile);
    await runDeclarativeFlowBySpecFile("mr-description.json", config, {
      taskKey: config.taskKey,
      extraPrompt: config.extraPrompt,
    });
    return false;
  }

  if (config.command === "task-describe") {
    requireJiraTaskFile(config.jiraTaskFile);
    await runDeclarativeFlowBySpecFile("task-describe.json", config, {
      taskKey: config.taskKey,
      extraPrompt: config.extraPrompt,
    });
    return false;
  }

  if (config.command === "implement") {
    requireJiraTaskFile(config.jiraTaskFile);
    requireArtifacts(planArtifacts(config.taskKey), "Implement mode requires plan artifacts from the planning phase.");
    try {
      await runDeclarativeFlowBySpecFile("implement.json", config, {
        taskKey: config.taskKey,
        dockerComposeFile: config.dockerComposeFile,
        extraPrompt: config.extraPrompt,
        runFollowupVerify,
      });
    } catch (error) {
      if (!config.dryRun) {
        const output = String((error as { output?: string }).output ?? "");
        if (output.trim()) {
          printError("Build verification failed");
          printSummary("Build Failure Summary", await summarizeBuildFailure(output));
        }
      }
      throw error;
    }
    return false;
  }

  if (config.command === "review") {
    requireJiraTaskFile(config.jiraTaskFile);
    const iteration = nextReviewIterationForTask(config.taskKey);
    await runDeclarativeFlowBySpecFile("review.json", config, {
      taskKey: config.taskKey,
      iteration,
      extraPrompt: config.extraPrompt,
    });
    return !config.dryRun && existsSync(readyToMergeFile(config.taskKey));
  }

  if (config.command === "review-fix") {
    requireJiraTaskFile(config.jiraTaskFile);
    try {
      await runDeclarativeFlowBySpecFile("review-fix.json", config, {
        taskKey: config.taskKey,
        dockerComposeFile: config.dockerComposeFile,
        latestIteration: latestReviewReplyIteration(config.taskKey),
        runFollowupVerify,
        extraPrompt: config.extraPrompt,
        reviewFixPoints: config.reviewFixPoints,
      });
    } catch (error) {
      if (!config.dryRun) {
        const output = String((error as { output?: string }).output ?? "");
        if (output.trim()) {
          printError("Build verification failed");
          printSummary("Build Failure Summary", await summarizeBuildFailure(output));
        }
      }
      throw error;
    }
    return false;
  }

  if (config.command === "test") {
    requireJiraTaskFile(config.jiraTaskFile);
    try {
      await runDeclarativeFlowBySpecFile("test.json", config, {
        taskKey: config.taskKey,
        dockerComposeFile: config.dockerComposeFile,
      });
    } catch (error) {
      if (!config.dryRun) {
        const output = String((error as { output?: string }).output ?? "");
        if (output.trim()) {
          printError("Build verification failed");
          printSummary("Build Failure Summary", await summarizeBuildFailure(output));
        }
      }
      throw error;
    }
    return false;
  }

  if (config.command === "test-fix" || config.command === "test-linter-fix") {
    requireJiraTaskFile(config.jiraTaskFile);
    await runDeclarativeFlowBySpecFile(config.command === "test-fix" ? "test-fix.json" : "test-linter-fix.json", config, {
      taskKey: config.taskKey,
      extraPrompt: config.extraPrompt,
    });
    return false;
  }

  if (config.command === "run-tests-loop" || config.command === "run-linter-loop") {
    await runDeclarativeFlowBySpecFile(
      config.command === "run-tests-loop" ? "run-tests-loop.json" : "run-linter-loop.json",
      config,
      {
        taskKey: config.taskKey,
        dockerComposeFile: config.dockerComposeFile,
        extraPrompt: config.extraPrompt,
      },
    );
    return false;
  }

  throw new TaskRunnerError(`Unsupported command: ${config.command}`);
}

async function runAutoPipelineDryRun(config: Config): Promise<void> {
  checkAutoPrerequisites(config);
  printInfo("Dry-run auto pipeline from declarative spec");
  const autoFlow = loadAutoFlow();
  const executionState: FlowExecutionState = {
    flowKind: autoFlow.kind,
    flowVersion: autoFlow.version,
    terminated: false,
    phases: [],
  };
  publishFlowState("auto", executionState);
  for (const phase of autoFlow.phases) {
    printInfo(`Dry-run auto phase: ${phase.id}`);
    await runAutoPhaseViaSpec(config, phase.id, executionState);
    if (executionState.terminated) {
      break;
    }
  }
}

async function runAutoPipeline(config: Config): Promise<void> {
  if (config.dryRun) {
    await runAutoPipelineDryRun(config);
    return;
  }

  checkAutoPrerequisites(config);
  process.env.JIRA_BROWSE_URL = config.jiraBrowseUrl;
  process.env.JIRA_API_URL = config.jiraApiUrl;
  process.env.JIRA_TASK_FILE = config.jiraTaskFile;
  let state = loadAutoPipelineState(config) ?? createAutoPipelineState(config);
  if (config.autoFromPhase) {
    rewindAutoPipelineState(state, config.autoFromPhase);
    printPanel("Auto Resume", `Auto pipeline will continue from phase: ${config.autoFromPhase}`, "yellow");
    saveAutoPipelineState(state);
  } else if (!existsSync(autoStateFile(config.taskKey))) {
    saveAutoPipelineState(state);
  }

  printInfo("Running auto pipeline with persisted state");
  while (true) {
    const step = nextAutoStep(state);
    if (!step) {
      syncAndSaveAutoPipelineState(state);
      if (state.status === "completed") {
        printPanel("Auto", "Auto pipeline finished", "green");
      } else {
        printInfo(`Auto pipeline finished with status: ${state.status}`);
      }
      return;
    }

    state.status = "running";
    state.currentStep = step.id;
    step.status = "running";
    step.startedAt = nowIso8601();
    step.finishedAt = null;
    step.returnCode = null;
    step.note = null;
    state.lastError = null;
    saveAutoPipelineState(state);

    try {
      printInfo(`Running auto step: ${step.id}`);
      const status = await runAutoPhaseViaSpec(config, step.id, state.executionState, state);
      step.status = status;
      step.finishedAt = nowIso8601();
      step.returnCode = 0;
      if (status === "skipped") {
        step.note = "condition not met";
      }
      syncAndSaveAutoPipelineState(state);
    } catch (error) {
      const returnCode = Number((error as { returnCode?: number }).returnCode ?? 1);
      step.status = "failed";
      step.finishedAt = nowIso8601();
      step.returnCode = returnCode;
      state.status = "blocked";
      state.currentStep = step.id;
      state.lastError = {
        step: step.id,
        returnCode,
        message: "command failed",
      };
      saveAutoPipelineState(state);
      throw error;
    }

    if (state.executionState.terminated) {
      syncAndSaveAutoPipelineState(state);
      printPanel("Auto", "Auto pipeline finished", "green");
      return;
    }
  }
}

function parseCliArgs(argv: string[]): ParsedArgs {
  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${packageVersion()}\n`);
    process.exit(0);
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  if (argv.length === 0) {
    process.stderr.write(`${usage()}\n`);
    process.exit(1);
  }

  const command = argv[0];
  if (!COMMANDS.includes(command as CommandName)) {
    process.stderr.write(`${usage()}\n`);
    process.exit(1);
  }

  let dry = false;
  let verbose = false;
  let prompt: string | undefined;
  let autoFromPhase: string | undefined;
  let helpPhases = false;
  let jiraRef: string | undefined;

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--dry") {
      dry = true;
      continue;
    }
    if (token === "--verbose") {
      verbose = true;
      continue;
    }
    if (token === "--help-phases") {
      helpPhases = true;
      continue;
    }
    if (token === "--prompt") {
      prompt = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--from") {
      autoFromPhase = argv[index + 1];
      index += 1;
      continue;
    }
    jiraRef = token;
  }

  if (command === "auto" && helpPhases) {
    printAutoPhasesHelp();
    process.exit(0);
  }
  if (!jiraRef) {
    process.stderr.write(`${usage()}\n`);
    process.exit(1);
  }

  return {
    command: command as CommandName,
    jiraRef,
    dry,
    verbose,
    helpPhases,
    ...(prompt !== undefined ? { prompt } : {}),
    ...(autoFromPhase !== undefined ? { autoFromPhase } : {}),
  };
}

function buildConfigFromArgs(args: ParsedArgs): Config {
  return buildConfig(args.command, args.jiraRef, {
    ...(args.prompt !== undefined ? { extraPrompt: args.prompt } : {}),
    ...(args.autoFromPhase !== undefined ? { autoFromPhase: args.autoFromPhase } : {}),
    dryRun: args.dry,
    verbose: args.verbose,
  });
}

async function runInteractive(jiraRef: string, forceRefresh = false): Promise<number> {
  const config = buildConfig("plan", jiraRef);
  const jiraTaskPath = config.jiraTaskFile;

  let exiting = false;
  const ui = new InteractiveUi(
    {
      issueKey: config.jiraIssueKey,
      summaryText: "Starting interactive session...",
      cwd: process.cwd(),
      flows: interactiveFlowDefinitions(),
      onRun: async (flowId) => {
        try {
          const command = buildConfig(flowId as CommandName, jiraRef);
          await executeCommand(command);
        } catch (error) {
          if (error instanceof TaskRunnerError) {
            ui.setFlowFailed(flowId);
            printError(error.message);
            return;
          }
          const returnCode = Number((error as { returnCode?: number }).returnCode);
          if (!Number.isNaN(returnCode)) {
            ui.setFlowFailed(flowId);
            printError(`Command failed with exit code ${returnCode}`);
            return;
          }
          throw error;
        }
      },
      onExit: () => {
        exiting = true;
      },
    },
  );

  ui.mount();
  printInfo(`Interactive mode for ${config.jiraIssueKey}`);
  printInfo("Use h to see help.");

  try {
    ui.setBusy(true, "preflight");
    const preflightState = await runPreflightFlow(
      createPipelineContext({
        issueKey: config.taskKey,
        jiraRef: config.jiraRef,
        dryRun: false,
        verbose: config.verbose,
        runtime: runtimeServices,
        setSummary: (markdown) => {
          ui.setSummary(markdown);
        },
      }),
      {
        jiraApiUrl: config.jiraApiUrl,
        jiraTaskFile: config.jiraTaskFile,
        taskKey: config.taskKey,
        forceRefresh,
      },
    );
    const preflightPhase = preflightState.phases.find((phase) => phase.id === "preflight");
    if (preflightPhase) {
      ui.appendLog("[preflight] completed");
      for (const step of preflightPhase.steps) {
        ui.appendLog(`[preflight] ${step.id}: ${step.status}`);
      }
    }
    if (!existsSync(jiraTaskPath)) {
      throw new TaskRunnerError(
        `Preflight finished without Jira task file: ${jiraTaskPath}\n` +
          "Jira fetch did not complete successfully. Check JIRA_API_KEY and Jira connectivity.",
      );
    }
    if (!existsSync(taskSummaryFile(config.taskKey))) {
      ui.appendLog("[preflight] task summary file was not created");
      ui.setSummary("Task summary is not available yet. Select and run `plan` or refresh Jira data.");
    }
  } catch (error) {
    if (error instanceof TaskRunnerError) {
      printError(error.message);
    } else {
      throw error;
    }
  } finally {
    ui.setBusy(false);
  }

  return await new Promise<number>((resolve, reject) => {
    const interval = setInterval(() => {
      if (!exiting) {
        return;
      }
      clearInterval(interval);
      try {
        ui.destroy();
        bye();
        resolve(0);
      } catch (error) {
        reject(error);
      }
    }, 100);
  });
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  loadEnvFile(path.join(process.cwd(), ".env"));

  let forceRefresh = false;
  const args = [...argv];
  if (args[0] === "--force") {
    forceRefresh = true;
    args.shift();
  }

  try {
    if (args.length === 1 && !args[0]?.startsWith("-") && !COMMANDS.includes(args[0] as CommandName)) {
      return await runInteractive(args[0] ?? "", forceRefresh);
    }

    const parsedArgs = parseCliArgs(args);
    await executeCommand(buildConfigFromArgs(parsedArgs));
    return 0;
  } catch (error) {
    if (error instanceof TaskRunnerError) {
      printError(error.message);
      return 1;
    }
    const returnCode = Number((error as { returnCode?: number }).returnCode);
    if (!Number.isNaN(returnCode)) {
      printError(`Command failed with exit code ${returnCode}`);
      return returnCode || 1;
    }
    throw error;
  }
}

void main().then((code) => {
  process.exitCode = code;
});
