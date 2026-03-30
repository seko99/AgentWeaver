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
  designJsonFile,
  ensureScopeWorkspaceDir,
  gitlabReviewFile,
  gitlabReviewJsonFile,
  planJsonFile,
  planArtifacts,
  qaJsonFile,
  readyToMergeFile,
  requireArtifacts,
  reviewReplyJsonFile,
  reviewFixSelectionJsonFile,
  reviewJsonFile,
  scopeWorkspaceDir,
  taskSummaryFile,
} from "./artifacts.js";
import { TaskRunnerError } from "./errors.js";
import {
  createFlowRunState,
  hasResumableFlowState,
  loadFlowRunState,
  prepareFlowStateForResume,
  resetFlowRunState,
  saveFlowRunState,
  stripExecutionStatePayload,
  type FlowRunState,
} from "./flow-state.js";
import { requireJiraTaskFile } from "./jira.js";
import { validateStructuredArtifacts } from "./structured-artifacts.js";
import { summarizeBuildFailure as summarizeBuildFailureViaPipeline } from "./pipeline/build-failure-summary.js";
import { createPipelineContext } from "./pipeline/context.js";
import { loadAutoFlow } from "./pipeline/auto-flow.js";
import { loadDeclarativeFlow } from "./pipeline/declarative-flows.js";
import { findPhaseById, runExpandedPhase } from "./pipeline/declarative-flow-runner.js";
import type { FlowExecutionState } from "./pipeline/spec-types.js";
import { resolveCmd, resolveDockerComposeCmd } from "./runtime/command-resolution.js";
import { agentweaverHome, defaultDockerComposeFile, dockerRuntimeEnv } from "./runtime/docker-runtime.js";
import { runCommand } from "./runtime/process-runner.js";
import { InteractiveUi, type InteractiveFlowDefinition } from "./interactive-ui.js";
import {
  bye,
  getOutputAdapter,
  printError,
  printInfo,
  printPanel,
  printPrompt,
  printSummary,
  setFlowExecutionState,
  stripAnsi,
} from "./tui.js";
import { requestUserInputInTerminal, type UserInputRequester } from "./user-input.js";
import {
  detectGitBranchName,
  requestTaskScope,
  resolveProjectScope,
  resolveTaskScope,
  type ResolvedScope,
  type ResolvedTaskScope,
} from "./scope.js";

const COMMANDS = [
  "bug-analyze",
  "bug-fix",
  "gitlab-review",
  "mr-description",
  "plan",
  "task-describe",
  "implement",
  "review",
  "review-fix",
  "run-go-tests-loop",
  "run-go-linter-loop",
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

type BaseConfig = {
  command: CommandName;
  jiraRef?: string | null;
  scopeName?: string | null;
  reviewFixPoints?: string | null;
  extraPrompt?: string | null;
  autoFromPhase?: string | null;
  dryRun: boolean;
  verbose: boolean;
  dockerComposeFile: string;
  runGoTestsScript: string;
  runGoLinterScript: string;
  runGoCoverageScript: string;
};

type Config = BaseConfig & {
  scope: ResolvedScope;
  taskKey: string;
  jiraRef: string;
  jiraBrowseUrl?: string;
  jiraApiUrl?: string;
  jiraTaskFile?: string;
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
  jiraRef?: string;
  scopeName?: string;
  dry: boolean;
  verbose: boolean;
  prompt?: string;
  autoFromPhase?: string;
  helpPhases: boolean;
};

type FlowLaunchMode = "resume" | "restart";

type ProcessFailureLike = {
  returnCode?: number;
  output?: string;
  message?: string;
};

function buildFailureOutputPreview(output: string): string {
  const normalized = stripAnsi(output).replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return "";
  }

  const lines = normalized
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return "";
  }

  const previewLines = lines.slice(-8);
  let preview = previewLines.join("\n");
  const maxLength = 1200;
  if (preview.length > maxLength) {
    preview = `...${preview.slice(-(maxLength - 3))}`;
  }
  return preview;
}

function formatProcessFailure(error: ProcessFailureLike): string {
  const returnCode = Number(error.returnCode);
  const baseMessage = !Number.isNaN(returnCode)
    ? `Command failed with exit code ${returnCode}`
    : error.message?.trim() || "Command failed";
  const preview = buildFailureOutputPreview(String(error.output ?? ""));
  if (!preview) {
    return baseMessage;
  }
  return `${baseMessage}\nПричина:\n${preview}`;
}

function usage(): string {
  return `Usage:
  agentweaver
  agentweaver <jira-browse-url|jira-issue-key>
  agentweaver --force <jira-browse-url|jira-issue-key>
  agentweaver gitlab-review [--dry] [--verbose] [--prompt <text>] [--scope <name>] <jira-browse-url|jira-issue-key>
  agentweaver bug-analyze [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  agentweaver bug-fix [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  agentweaver mr-description [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  agentweaver plan [--dry] [--verbose] [--prompt <text>] [<jira-browse-url|jira-issue-key>]
  agentweaver task-describe [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  agentweaver implement [--dry] [--verbose] [--prompt <text>] [--scope <name>] [<jira-browse-url|jira-issue-key>]
  agentweaver review [--dry] [--verbose] [--prompt <text>] [--scope <name>] [<jira-browse-url|jira-issue-key>]
  agentweaver review-fix [--dry] [--verbose] [--prompt <text>] [--scope <name>] [<jira-browse-url|jira-issue-key>]
  agentweaver run-go-tests-loop [--dry] [--verbose] [--prompt <text>] [--scope <name>] [<jira-browse-url|jira-issue-key>]
  agentweaver run-go-linter-loop [--dry] [--verbose] [--prompt <text>] [--scope <name>] [<jira-browse-url|jira-issue-key>]
  agentweaver auto [--dry] [--verbose] [--prompt <text>] [<jira-browse-url|jira-issue-key>]
  agentweaver auto [--dry] [--verbose] [--prompt <text>] --from <phase> [<jira-browse-url|jira-issue-key>]
  agentweaver auto --help-phases
  agentweaver auto-status [<jira-browse-url|jira-issue-key>]
  agentweaver auto-reset [<jira-browse-url|jira-issue-key>]

Interactive Mode:
  When started without a command, the script opens an interactive UI.
  If a Jira task is provided, interactive mode starts in task scope; otherwise it starts in project scope.
  Use Up/Down to select a flow, Enter to confirm launch, h for help, q to exit.

Flags:
  --version       Show package version
  --force         In interactive mode, regenerate task summary in Jira-backed flows
  --dry           Fetch Jira task, but print docker/codex/claude commands instead of executing them
  --verbose       Show live stdout/stderr of launched commands
  --scope         Explicit workflow scope name for non-Jira runs
  --prompt        Extra prompt text appended to the base prompt

Required environment variables:
  JIRA_API_KEY    Jira API key used in Authorization: Bearer <token> for Jira-backed flows

Optional environment variables:
  JIRA_BASE_URL
  GITLAB_TOKEN
  AGENTWEAVER_HOME
  DOCKER_COMPOSE_BIN
  CODEX_BIN
  CODEX_MODEL
  CLAUDE_BIN
  CLAUDE_MODEL

Notes:
  - Task-only flows will ask for Jira task via user-input when it is not passed as an argument.
  - Scope-flexible flows use the current git branch by default when Jira task is not provided.`;
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
  ensureScopeWorkspaceDir(state.issueKey);
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

function buildAutoResumeDetails(state: AutoPipelineState): string {
  const currentStep = findCurrentExecutionStep(state) ?? state.currentStep ?? "-";
  const lines = [
    "Interrupted auto run found.",
    `Current step: ${currentStep}`,
    `Updated: ${state.updatedAt}`,
  ];
  if (state.lastError) {
    lines.push(`Last error: ${state.lastError.message ?? "-"} (exit ${state.lastError.returnCode ?? "-"})`);
  }
  return lines.join("\n");
}

function buildFlowResumeDetails(state: FlowRunState): string {
  const currentStep = findCurrentFlowExecutionStep(state) ?? state.currentStep ?? "-";
  const lines = [
    "Interrupted run found.",
    `Current step: ${currentStep}`,
    `Updated: ${state.updatedAt}`,
  ];
  if (state.lastError) {
    lines.push(`Last error: ${state.lastError.message ?? "-"} (exit ${state.lastError.returnCode ?? "-"})`);
  }
  return lines.join("\n");
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
  const workspaceDir = scopeWorkspaceDir(taskKey);
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
  const workspaceDir = scopeWorkspaceDir(taskKey);
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

function buildBaseConfig(
  command: CommandName,
  options: {
    jiraRef?: string | null;
    scopeName?: string | null;
    reviewFixPoints?: string | null;
    extraPrompt?: string | null;
    autoFromPhase?: string | null;
    dryRun?: boolean;
    verbose?: boolean;
  } = {},
): BaseConfig {
  const homeDir = agentweaverHome(PACKAGE_ROOT);
  return {
    command,
    jiraRef: options.jiraRef ?? null,
    scopeName: options.scopeName ?? null,
    reviewFixPoints: options.reviewFixPoints ?? null,
    extraPrompt: options.extraPrompt ?? null,
    autoFromPhase: options.autoFromPhase ? validateAutoPhaseId(options.autoFromPhase) : null,
    dryRun: options.dryRun ?? false,
    verbose: options.verbose ?? false,
    dockerComposeFile: defaultDockerComposeFile(PACKAGE_ROOT),
    runGoTestsScript: path.join(homeDir, "run_go_tests.sh"),
    runGoLinterScript: path.join(homeDir, "run_go_linter.py"),
    runGoCoverageScript: path.join(homeDir, "run_go_coverage.sh"),
  };
}

function commandRequiresTask(command: CommandName): boolean {
  return (
    command === "plan" ||
    command === "bug-analyze" ||
    command === "bug-fix" ||
    command === "gitlab-review" ||
    command === "mr-description" ||
    command === "task-describe" ||
    command === "auto" ||
    command === "auto-status" ||
    command === "auto-reset"
  );
}

function commandSupportsProjectScope(command: CommandName): boolean {
  return (
    command === "implement" ||
    command === "review" ||
    command === "review-fix" ||
    command === "run-go-tests-loop" ||
    command === "run-go-linter-loop"
  );
}

async function resolveScopeForCommand(
  config: BaseConfig,
  requestUserInput: UserInputRequester,
): Promise<ResolvedScope> {
  if (config.jiraRef?.trim()) {
    return resolveTaskScope(config.jiraRef, config.scopeName);
  }
  if (commandRequiresTask(config.command)) {
    try {
      const taskScope = await requestTaskScope(requestUserInput);
      return config.scopeName ? resolveTaskScope(taskScope.jiraRef, config.scopeName) : taskScope;
    } catch (error) {
      if (error instanceof TaskRunnerError && error.message.includes("no TTY is available")) {
        throw new TaskRunnerError(
          `Command '${config.command}' requires a Jira task.\n` +
            "Pass Jira issue key / browse URL as an argument, or run the command in an interactive terminal.",
        );
      }
      throw error;
    }
  }
  if (commandSupportsProjectScope(config.command)) {
    return resolveProjectScope(config.scopeName);
  }
  throw new TaskRunnerError(`Unsupported scope policy for command: ${config.command}`);
}

function buildRuntimeConfig(baseConfig: BaseConfig, scope: ResolvedScope): Config {
  ensureScopeWorkspaceDir(scope.scopeKey);
  if (scope.scopeType === "task") {
    return {
      ...baseConfig,
      scope,
      taskKey: scope.scopeKey,
      jiraRef: scope.jiraRef,
      jiraBrowseUrl: scope.jiraBrowseUrl,
      jiraApiUrl: scope.jiraApiUrl,
      jiraTaskFile: scope.jiraTaskFile,
    };
  }
  return {
    ...baseConfig,
    scope,
    taskKey: scope.scopeKey,
    jiraRef: scope.scopeKey,
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
    config.command === "run-go-tests-loop" ||
    config.command === "run-go-linter-loop"
  ) {
    resolveCmd("codex", "CODEX_BIN");
  }
  if (config.command === "review") {
    resolveCmd("claude", "CLAUDE_BIN");
  }
}

function checkAutoPrerequisites(config: Config): void {
  resolveCmd("codex", "CODEX_BIN");
  resolveCmd("claude", "CLAUDE_BIN");
}

function autoFlowParams(config: Config, forceRefreshSummary = false): Record<string, unknown> {
  return {
    jiraApiUrl: config.jiraApiUrl,
    taskKey: config.taskKey,
    dockerComposeFile: config.dockerComposeFile,
    runGoTestsScript: config.runGoTestsScript,
    runGoLinterScript: config.runGoLinterScript,
    runGoCoverageScript: config.runGoCoverageScript,
    extraPrompt: config.extraPrompt,
    reviewFixPoints: config.reviewFixPoints,
    forceRefresh: forceRefreshSummary,
  };
}

const FLOW_DESCRIPTIONS: Record<string, string> = {
  auto: "Полный пайплайн задачи: планирование, реализация, проверки, ревью, ответы на ревью и повторные итерации до готовности к merge.",
  "bug-analyze":
    "Анализирует баг по Jira и создаёт структурированные артефакты: гипотезу причины, дизайн исправления и план работ.",
  "gitlab-review":
    "Запрашивает GitLab MR URL через user-input, загружает комментарии код-ревью по API и сохраняет markdown плюс structured JSON artifact.",
  "bug-fix":
    "Берёт результаты bug-analyze как source of truth и реализует исправление бага в коде.",
  "mr-description":
    "Готовит краткое intent-описание для merge request на основе задачи и текущих изменений.",
  plan: "Загружает задачу из Jira и создаёт дизайн, план реализации и QA-план в structured JSON и markdown.",
  "task-describe": "Строит короткое резюме задачи на основе Jira-артефакта для быстрого ознакомления.",
  implement: "Реализует задачу по утверждённым design/plan артефактам и при необходимости запускает post-verify сборки.",
  review:
    "Запускает Claude-код-ревью текущих изменений, валидирует structured findings, затем готовит ответ на замечания через Codex.",
  "review-fix":
    "Исправляет замечания после review-reply, обновляет код и прогоняет обязательные проверки после правок.",
  "run-go-tests-loop":
    "Циклически запускает `./run_go_tests.sh` локально, анализирует последнюю ошибку и правит код до успешного прохождения или исчерпания попыток.",
  "run-go-linter-loop":
    "Циклически запускает `./run_go_linter.py` локально, исправляет проблемы линтера или генерации и повторяет попытки до успеха.",
};

function flowDescription(id: string): string {
  return FLOW_DESCRIPTIONS[id] ?? "Описание для этого flow пока не задано.";
}

function declarativeFlowDefinition(id: string, label: string, fileName: string): InteractiveFlowDefinition {
  const flow = loadDeclarativeFlow(fileName);
  return {
    id,
    label,
    description: flowDescription(id),
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
    description: flowDescription("auto"),
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
    declarativeFlowDefinition("gitlab-review", "gitlab-review", "gitlab-review.json"),
    declarativeFlowDefinition("mr-description", "mr-description", "mr-description.json"),
    declarativeFlowDefinition("plan", "plan", "plan.json"),
    declarativeFlowDefinition("task-describe", "task-describe", "task-describe.json"),
    declarativeFlowDefinition("implement", "implement", "implement.json"),
    declarativeFlowDefinition("review", "review", "review.json"),
    declarativeFlowDefinition("review-fix", "review-fix", "review-fix.json"),
    declarativeFlowDefinition("run-go-tests-loop", "run-go-tests-loop", "run-go-tests-loop.json"),
    declarativeFlowDefinition("run-go-linter-loop", "run-go-linter-loop", "run-go-linter-loop.json"),
  ];
}

function publishFlowState(flowId: string, executionState: FlowExecutionState): void {
  setFlowExecutionState(flowId, stripExecutionStatePayload(executionState));
}

function loadTaskSummaryMarkdown(taskKey: string): string | null {
  const summaryPath = taskSummaryFile(taskKey);
  if (!existsSync(summaryPath)) {
    return null;
  }
  const markdown = readFileSync(summaryPath, "utf8").trim();
  return markdown.length > 0 ? markdown : null;
}

function syncInteractiveTaskSummary(
  ui: InteractiveUi,
  scope: ResolvedScope,
  forceRefresh = false,
): void {
  if (scope.scopeType !== "task" || forceRefresh) {
    ui.clearSummary();
    return;
  }
  const summaryMarkdown = loadTaskSummaryMarkdown(scope.scopeKey);
  if (summaryMarkdown) {
    ui.setSummary(summaryMarkdown);
    return;
  }
  ui.clearSummary();
}

function findCurrentFlowExecutionStep(state: FlowRunState): string | null {
  for (const phase of state.executionState.phases) {
    const runningStep = phase.steps.find((step) => step.status === "running");
    if (runningStep) {
      return `${phase.id}:${runningStep.id}`;
    }
    const pendingStep = phase.steps.find((step) => step.status === "pending");
    if (pendingStep && phase.steps.some((step) => step.status === "done" || step.status === "skipped")) {
      return `${phase.id}:${pendingStep.id}`;
    }
  }
  return null;
}

async function runDeclarativeFlowBySpecFile(
  fileName: string,
  config: Config,
  flowParams: Record<string, unknown>,
  requestUserInput: UserInputRequester = requestUserInputInTerminal,
  setSummary?: (markdown: string) => void,
  launchMode: FlowLaunchMode = "restart",
): Promise<void> {
  const context = createPipelineContext({
    issueKey: config.taskKey,
    jiraRef: config.jiraRef,
    dryRun: config.dryRun,
    verbose: config.verbose,
    runtime: runtimeServices,
    ...(setSummary ? { setSummary } : {}),
    requestUserInput,
  });
  const flow = loadDeclarativeFlow(fileName);
  const initialExecutionState: FlowExecutionState = {
    flowKind: flow.kind,
    flowVersion: flow.version,
    terminated: false,
    phases: [],
  };
  let persistedState =
    launchMode === "resume" ? loadFlowRunState(config.scope.scopeKey, config.command) : null;
  if (persistedState && launchMode === "resume") {
    persistedState = prepareFlowStateForResume(persistedState);
  } else if (launchMode === "restart") {
    resetFlowRunState(config.scope.scopeKey, config.command);
  }
  const executionState = persistedState?.executionState ?? initialExecutionState;
  const state = persistedState ?? createFlowRunState(config.scope.scopeKey, config.command, executionState);
  state.status = "running";
  state.lastError = null;
  state.currentStep = findCurrentFlowExecutionStep(state);
  state.executionState = executionState;
  saveFlowRunState(state);
  publishFlowState(config.command, executionState);
  try {
    for (const phase of flow.phases) {
      await runExpandedPhase(phase, context, flowParams, flow.constants, {
        executionState,
        flowKind: flow.kind,
        flowVersion: flow.version,
        onStateChange: async (nextExecutionState) => {
          state.executionState = nextExecutionState;
          state.currentStep = findCurrentFlowExecutionStep(state);
          saveFlowRunState(state);
          publishFlowState(config.command, nextExecutionState);
        },
        onStepStart: async (currentPhase, step) => {
          state.currentStep = `${currentPhase.id}:${step.id}`;
          saveFlowRunState(state);
        },
      },
      );
    }
    state.status = "completed";
    state.currentStep = null;
    state.lastError = null;
    state.executionState = executionState;
    saveFlowRunState(state);
  } catch (error) {
    state.status = "blocked";
    state.currentStep = findCurrentFlowExecutionStep(state);
    state.lastError = {
      returnCode: Number((error as { returnCode?: number }).returnCode ?? 1),
      message: (error as Error).message || "command failed",
    };
    if (state.currentStep) {
      state.lastError.step = state.currentStep;
    }
    state.executionState = executionState;
    saveFlowRunState(state);
    throw error;
  }
}

async function runAutoPhaseViaSpec(
  config: Config,
  phaseId: string,
  executionState: FlowExecutionState,
  state?: AutoPipelineState,
  setSummary?: (markdown: string) => void,
  forceRefreshSummary = false,
): Promise<"done" | "skipped"> {
  const context = createPipelineContext({
    issueKey: config.taskKey,
    jiraRef: config.jiraRef,
    dryRun: config.dryRun,
    verbose: config.verbose,
    runtime: runtimeServices,
    ...(setSummary ? { setSummary } : {}),
    requestUserInput: requestUserInputInTerminal,
  });
  const autoFlow = loadAutoFlow();
  const phase = findPhaseById(autoFlow.phases, phaseId);
  publishFlowState("auto", executionState);
  try {
    const result = await runExpandedPhase(phase, context, autoFlowParams(config, forceRefreshSummary), autoFlow.constants, {
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
      requestUserInput: requestUserInputInTerminal,
    }),
    output,
  );
}

function requireTaskScopeConfig(config: Config): asserts config is Config & { scope: ResolvedTaskScope; jiraBrowseUrl: string; jiraApiUrl: string; jiraTaskFile: string } {
  if (config.scope.scopeType !== "task" || !config.jiraBrowseUrl || !config.jiraApiUrl || !config.jiraTaskFile) {
    throw new TaskRunnerError(`Command '${config.command}' requires Jira task scope.`);
  }
}

async function executeCommand(
  baseConfig: BaseConfig,
  runFollowupVerify = true,
  requestUserInput: UserInputRequester = requestUserInputInTerminal,
  resolvedScope?: ResolvedScope,
  setSummary?: (markdown: string) => void,
  forceRefreshSummary = false,
  launchMode: FlowLaunchMode = "restart",
): Promise<boolean> {
  const config = buildRuntimeConfig(baseConfig, resolvedScope ?? (await resolveScopeForCommand(baseConfig, requestUserInput)));
  if (config.command === "auto") {
    if (launchMode === "restart") {
      resetAutoPipelineState(config);
    }
    await runAutoPipeline(config, setSummary, forceRefreshSummary);
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
  if (config.scope.scopeType === "task") {
    process.env.JIRA_BROWSE_URL = config.jiraBrowseUrl ?? "";
    process.env.JIRA_API_URL = config.jiraApiUrl ?? "";
    process.env.JIRA_TASK_FILE = config.jiraTaskFile ?? "";
  } else {
    delete process.env.JIRA_BROWSE_URL;
    delete process.env.JIRA_API_URL;
    delete process.env.JIRA_TASK_FILE;
  }

  if (config.command === "plan") {
    requireTaskScopeConfig(config);
    if (config.verbose) {
      process.stdout.write(`Fetching Jira issue from browse URL: ${config.jiraBrowseUrl}\n`);
      process.stdout.write(`Resolved Jira API URL: ${config.jiraApiUrl}\n`);
      process.stdout.write(`Saving Jira issue JSON to: ${config.jiraTaskFile}\n`);
    }
    await runDeclarativeFlowBySpecFile("plan.json", config, {
      jiraApiUrl: config.jiraApiUrl,
      taskKey: config.taskKey,
      extraPrompt: config.extraPrompt,
      forceRefresh: forceRefreshSummary,
    }, requestUserInput, setSummary, launchMode);
    return false;
  }

  if (config.command === "bug-analyze") {
    requireTaskScopeConfig(config);
    if (config.verbose) {
      process.stdout.write(`Fetching Jira issue from browse URL: ${config.jiraBrowseUrl}\n`);
      process.stdout.write(`Resolved Jira API URL: ${config.jiraApiUrl}\n`);
      process.stdout.write(`Saving Jira issue JSON to: ${config.jiraTaskFile}\n`);
    }
    await runDeclarativeFlowBySpecFile("bug-analyze.json", config, {
      jiraApiUrl: config.jiraApiUrl,
      taskKey: config.taskKey,
      extraPrompt: config.extraPrompt,
      forceRefresh: forceRefreshSummary,
    }, requestUserInput, setSummary, launchMode);
    return false;
  }

  if (config.command === "gitlab-review") {
    requireTaskScopeConfig(config);
    requireJiraTaskFile(config.jiraTaskFile);
    validateStructuredArtifacts(
      [
        { path: designJsonFile(config.taskKey), schemaId: "implementation-design/v1" },
        { path: planJsonFile(config.taskKey), schemaId: "implementation-plan/v1" },
      ],
      "GitLab-review mode requires valid structured plan artifacts from the planning phase.",
    );
    const iteration = nextReviewIterationForTask(config.taskKey);
    await runDeclarativeFlowBySpecFile(
      "gitlab-review.json",
      config,
      {
        taskKey: config.taskKey,
        iteration,
        extraPrompt: config.extraPrompt,
      },
      requestUserInput,
      undefined,
      launchMode,
    );
    if (!config.dryRun) {
      printSummary("GitLab Review", `Artifacts:\n${gitlabReviewFile(config.taskKey)}\n${gitlabReviewJsonFile(config.taskKey)}`);
    }
    return false;
  }

  if (config.command === "bug-fix") {
    requireTaskScopeConfig(config);
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
    }, requestUserInput, undefined, launchMode);
    return false;
  }

  if (config.command === "mr-description") {
    requireTaskScopeConfig(config);
    requireJiraTaskFile(config.jiraTaskFile);
    await runDeclarativeFlowBySpecFile("mr-description.json", config, {
      taskKey: config.taskKey,
      extraPrompt: config.extraPrompt,
    }, requestUserInput, undefined, launchMode);
    return false;
  }

  if (config.command === "task-describe") {
    requireTaskScopeConfig(config);
    await runDeclarativeFlowBySpecFile("task-describe.json", config, {
      jiraApiUrl: config.jiraApiUrl,
      taskKey: config.taskKey,
      extraPrompt: config.extraPrompt,
    }, requestUserInput, undefined, launchMode);
    return false;
  }

  if (config.command === "implement") {
    requireArtifacts(planArtifacts(config.taskKey), "Implement mode requires plan artifacts from the planning phase.");
    validateStructuredArtifacts(
      [
        { path: designJsonFile(config.taskKey), schemaId: "implementation-design/v1" },
        { path: planJsonFile(config.taskKey), schemaId: "implementation-plan/v1" },
        { path: qaJsonFile(config.taskKey), schemaId: "qa-plan/v1" },
      ],
      "Implement mode requires valid structured plan artifacts from the planning phase.",
    );
    await runDeclarativeFlowBySpecFile("implement.json", config, {
      taskKey: config.taskKey,
      extraPrompt: config.extraPrompt,
    }, requestUserInput, undefined, launchMode);
    return false;
  }

  if (config.command === "review") {
    const iteration = nextReviewIterationForTask(config.taskKey);
    if (config.scope.scopeType === "task") {
      requireTaskScopeConfig(config);
      validateStructuredArtifacts(
        [
          { path: designJsonFile(config.taskKey), schemaId: "implementation-design/v1" },
          { path: planJsonFile(config.taskKey), schemaId: "implementation-plan/v1" },
        ],
        "Review mode requires valid structured plan artifacts from the planning phase.",
      );
      await runDeclarativeFlowBySpecFile("review.json", config, {
        taskKey: config.taskKey,
        iteration,
        extraPrompt: config.extraPrompt,
      }, requestUserInput, undefined, launchMode);
    } else {
      await runDeclarativeFlowBySpecFile("review-project.json", config, {
        taskKey: config.taskKey,
        iteration,
        extraPrompt: config.extraPrompt,
      }, requestUserInput, undefined, launchMode);
    }
    return !config.dryRun && existsSync(readyToMergeFile(config.taskKey));
  }

  if (config.command === "review-fix") {
    const latestIteration = latestReviewReplyIteration(config.taskKey);
    if (latestIteration === null) {
      throw new TaskRunnerError("Review-fix mode requires at least one review-reply artifact.");
    }
    validateStructuredArtifacts(
      [
        { path: reviewJsonFile(config.taskKey, latestIteration), schemaId: "review-findings/v1" },
        { path: reviewReplyJsonFile(config.taskKey, latestIteration), schemaId: "review-reply/v1" },
      ],
      "Review-fix mode requires valid structured review artifacts.",
    );
    await runDeclarativeFlowBySpecFile("review-fix.json", config, {
      taskKey: config.taskKey,
      latestIteration,
      reviewFixSelectionJsonFile: reviewFixSelectionJsonFile(config.taskKey, latestIteration),
      extraPrompt: config.extraPrompt,
      reviewFixPoints: config.reviewFixPoints,
    }, requestUserInput, undefined, launchMode);
    return false;
  }

  if (config.command === "run-go-tests-loop" || config.command === "run-go-linter-loop") {
    await runDeclarativeFlowBySpecFile(
      config.command === "run-go-tests-loop" ? "run-go-tests-loop.json" : "run-go-linter-loop.json",
      config,
      {
        taskKey: config.taskKey,
        runGoTestsScript: config.runGoTestsScript,
        runGoLinterScript: config.runGoLinterScript,
        extraPrompt: config.extraPrompt,
      },
      requestUserInput,
      undefined,
      launchMode,
    );
    return false;
  }

  throw new TaskRunnerError(`Unsupported command: ${config.command}`);
}

async function runAutoPipelineDryRun(
  config: Config,
  setSummary?: (markdown: string) => void,
  forceRefreshSummary = false,
): Promise<void> {
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
    await runAutoPhaseViaSpec(config, phase.id, executionState, undefined, setSummary, forceRefreshSummary);
    if (executionState.terminated) {
      break;
    }
  }
}

async function runAutoPipeline(
  config: Config,
  setSummary?: (markdown: string) => void,
  forceRefreshSummary = false,
): Promise<void> {
  requireTaskScopeConfig(config);
  if (config.dryRun) {
    await runAutoPipelineDryRun(config, setSummary, forceRefreshSummary);
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
      const status = await runAutoPhaseViaSpec(
        config,
        step.id,
        state.executionState,
        state,
        setSummary,
        forceRefreshSummary,
      );
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
  let scopeName: string | undefined;
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
    if (token === "--scope") {
      scopeName = argv[index + 1];
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

  return {
    command: command as CommandName,
    dry,
    verbose,
    helpPhases,
    ...(jiraRef !== undefined ? { jiraRef } : {}),
    ...(scopeName !== undefined ? { scopeName } : {}),
    ...(prompt !== undefined ? { prompt } : {}),
    ...(autoFromPhase !== undefined ? { autoFromPhase } : {}),
  };
}

function buildConfigFromArgs(args: ParsedArgs): BaseConfig {
  return buildBaseConfig(args.command, {
    ...(args.jiraRef !== undefined ? { jiraRef: args.jiraRef } : {}),
    ...(args.scopeName !== undefined ? { scopeName: args.scopeName } : {}),
    ...(args.prompt !== undefined ? { extraPrompt: args.prompt } : {}),
    ...(args.autoFromPhase !== undefined ? { autoFromPhase: args.autoFromPhase } : {}),
    dryRun: args.dry,
    verbose: args.verbose,
  });
}

async function runInteractive(jiraRef?: string | null, forceRefresh = false, scopeName?: string | null): Promise<number> {
  let currentScope = jiraRef?.trim() ? resolveTaskScope(jiraRef, scopeName) : resolveProjectScope(scopeName);
  const gitBranchName = detectGitBranchName();

  let exiting = false;
  const ui = new InteractiveUi(
    {
      scopeKey: currentScope.scopeKey,
      jiraIssueKey: currentScope.scopeType === "task" ? currentScope.jiraIssueKey : null,
      summaryText: "",
      cwd: process.cwd(),
      gitBranchName,
      flows: interactiveFlowDefinitions(),
      getRunConfirmation: async (flowId) => {
        if (flowId === "auto") {
          if (currentScope.scopeType !== "task") {
            return { resumeAvailable: false, hasExistingState: false };
          }
          const baseConfig = buildBaseConfig("auto", {
            jiraRef: currentScope.jiraRef,
            scopeName: currentScope.scopeKey !== currentScope.jiraIssueKey ? currentScope.scopeKey : null,
          });
          const state = loadAutoPipelineState(buildRuntimeConfig(baseConfig, currentScope));
          if (!state) {
            return { resumeAvailable: false, hasExistingState: false };
          }
          const status = deriveAutoPipelineStatus(state);
          if (status === "completed") {
            return { resumeAvailable: false, hasExistingState: true };
          }
          return {
            resumeAvailable: true,
            hasExistingState: true,
            details: buildAutoResumeDetails(state),
          };
        }
        if (commandRequiresTask(flowId as CommandName) && currentScope.scopeType !== "task") {
          return { resumeAvailable: false, hasExistingState: false };
        }
        const state = loadFlowRunState(currentScope.scopeKey, flowId);
        if (!state || !hasResumableFlowState(state)) {
          return { resumeAvailable: false, hasExistingState: Boolean(state) };
        }
        return {
          resumeAvailable: true,
          hasExistingState: true,
          details: buildFlowResumeDetails(state),
        };
      },
      onRun: async (flowId, launchMode) => {
        try {
          const previousScopeType = currentScope.scopeType;
          const previousScopeKey = currentScope.scopeKey;
          const baseConfig = buildBaseConfig(flowId as CommandName, {
            ...(currentScope.scopeType === "task" ? { jiraRef: currentScope.jiraRef } : {}),
            ...(currentScope.scopeType === "task" && currentScope.scopeKey !== currentScope.jiraIssueKey
              ? { scopeName: currentScope.scopeKey }
              : {}),
            ...(currentScope.scopeType === "project" ? { scopeName: currentScope.scopeKey } : {}),
          });
          const nextScope = await resolveScopeForCommand(baseConfig, (form) => ui.requestUserInput(form));
          currentScope = nextScope;
          ui.setScope(currentScope.scopeKey, currentScope.scopeType === "task" ? currentScope.jiraIssueKey : null);
          if (currentScope.scopeType === "task" && (previousScopeType !== "task" || previousScopeKey !== currentScope.scopeKey)) {
            syncInteractiveTaskSummary(ui, currentScope, forceRefresh);
          }
          await executeCommand(
            baseConfig,
            true,
            (form) => ui.requestUserInput(form),
            currentScope,
            (markdown) => ui.setSummary(markdown),
            forceRefresh,
            launchMode,
          );
        } catch (error) {
          if (error instanceof TaskRunnerError) {
            ui.setFlowFailed(flowId);
            printError(error.message);
            return;
          }
          const returnCode = Number((error as { returnCode?: number }).returnCode);
          if (!Number.isNaN(returnCode)) {
            ui.setFlowFailed(flowId);
            printError(formatProcessFailure(error as ProcessFailureLike));
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
  printInfo(`Interactive mode for ${currentScope.scopeKey}`);
  printInfo("Use h to see help.");
  if (currentScope.scopeType !== "task") {
    ui.appendLog("[scope] project scope active; task summary will appear after a Jira-backed flow runs");
  }

  if (currentScope.scopeType === "task") {
    syncInteractiveTaskSummary(ui, currentScope, forceRefresh);
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
    if (args.length === 0) {
      return await runInteractive(undefined, forceRefresh);
    }
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
      printError(formatProcessFailure(error as ProcessFailureLike));
      return returnCode || 1;
    }
    throw error;
  }
}

void main().then((code) => {
  process.exitCode = code;
});
