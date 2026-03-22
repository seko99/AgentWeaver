#!/usr/bin/env node

import { accessSync, constants, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  READY_TO_MERGE_FILE,
  REVIEW_FILE_RE,
  REVIEW_REPLY_FILE_RE,
  artifactFile,
  designFile,
  planArtifacts,
  planFile,
  qaFile,
  requireArtifacts,
  taskSummaryFile,
} from "./artifacts.js";
import { TaskRunnerError } from "./errors.js";
import { buildJiraApiUrl, buildJiraBrowseUrl, extractIssueKey, fetchJiraIssue, requireJiraTaskFile } from "./jira.js";
import {
  AUTO_REVIEW_FIX_EXTRA_PROMPT,
  IMPLEMENT_PROMPT_TEMPLATE,
  PLAN_PROMPT_TEMPLATE,
  REVIEW_FIX_PROMPT_TEMPLATE,
  REVIEW_PROMPT_TEMPLATE,
  REVIEW_REPLY_PROMPT_TEMPLATE,
  REVIEW_REPLY_SUMMARY_PROMPT_TEMPLATE,
  REVIEW_SUMMARY_PROMPT_TEMPLATE,
  TASK_SUMMARY_PROMPT_TEMPLATE,
  TEST_FIX_PROMPT_TEMPLATE,
  TEST_LINTER_FIX_PROMPT_TEMPLATE,
  formatPrompt,
  formatTemplate,
} from "./prompts.js";
import { InteractiveUi } from "./interactive-ui.js";
import { bye, dim, formatDone, getOutputAdapter, printError, printInfo, printPanel, printPrompt, printSummary } from "./tui.js";

const COMMANDS = [
  "plan",
  "implement",
  "review",
  "review-fix",
  "test",
  "test-fix",
  "test-linter-fix",
  "auto",
  "auto-status",
  "auto-reset",
] as const;

type CommandName = (typeof COMMANDS)[number];

const DEFAULT_CODEX_MODEL = "gpt-5.4";
const DEFAULT_CLAUDE_REVIEW_MODEL = "opus";
const DEFAULT_CLAUDE_SUMMARY_MODEL = "haiku";
const HISTORY_FILE = path.join(os.homedir(), ".codex", "memories", "agentweaver-history");
const AUTO_STATE_SCHEMA_VERSION = 1;
const AUTO_MAX_REVIEW_ITERATIONS = 3;
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(MODULE_DIR, "..");

type Config = {
  command: CommandName;
  jiraRef: string;
  reviewFixPoints?: string | null;
  extraPrompt?: string | null;
  autoFromPhase?: string | null;
  dryRun: boolean;
  verbose: boolean;
  dockerComposeFile: string;
  dockerComposeCmd: string[];
  codexCmd: string;
  claudeCmd: string;
  jiraIssueKey: string;
  taskKey: string;
  jiraBrowseUrl: string;
  jiraApiUrl: string;
  jiraTaskFile: string;
};

type AutoStepState = {
  id: string;
  command: Exclude<CommandName, "auto" | "auto-status" | "auto-reset">;
  status: "pending" | "running" | "failed" | "done" | "skipped";
  reviewIteration?: number | null;
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
  agentweaver plan [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  agentweaver implement [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  agentweaver review [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  agentweaver review-fix [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  agentweaver test [--dry] [--verbose] <jira-browse-url|jira-issue-key>
  agentweaver test-fix [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  agentweaver test-linter-fix [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  agentweaver auto [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  agentweaver auto [--dry] [--verbose] [--prompt <text>] --from <phase> <jira-browse-url|jira-issue-key>
  agentweaver auto --help-phases
  agentweaver auto-status <jira-browse-url|jira-issue-key>
  agentweaver auto-reset <jira-browse-url|jira-issue-key>

Interactive Mode:
  When started with only a Jira task, the script opens an interactive shell.
  Available slash commands: /plan, /implement, /review, /review-fix, /test, /test-fix, /test-linter-fix, /auto, /auto-status, /auto-reset, /help, /exit

Flags:
  --force         In interactive mode, force refresh Jira task and task summary
  --dry           Fetch Jira task, but print docker/codex/claude commands instead of executing them
  --verbose       Show live stdout/stderr of launched commands
  --prompt        Extra prompt text appended to the base prompt

Required environment variables:
  JIRA_API_KEY    Jira API key used in Authorization: Bearer <token> for plan

Optional environment variables:
  JIRA_BASE_URL
  AGENTWEAVER_HOME
  DOCKER_COMPOSE_BIN
  CODEX_BIN
  CODEX_MODEL
  CLAUDE_BIN
  CLAUDE_REVIEW_MODEL
  CLAUDE_SUMMARY_MODEL`;
}

function nowIso8601(): string {
  return new Date().toISOString();
}

function normalizeAutoPhaseId(phaseId: string): string {
  return phaseId.trim().toLowerCase().replaceAll("-", "_");
}

function buildAutoSteps(maxReviewIterations = AUTO_MAX_REVIEW_ITERATIONS): AutoStepState[] {
  const steps: AutoStepState[] = [
    { id: "plan", command: "plan", status: "pending" },
    { id: "implement", command: "implement", status: "pending" },
    { id: "test_after_implement", command: "test", status: "pending" },
  ];

  for (let iteration = 1; iteration <= maxReviewIterations; iteration += 1) {
    steps.push(
      { id: `review_${iteration}`, command: "review", status: "pending", reviewIteration: iteration },
      { id: `review_fix_${iteration}`, command: "review-fix", status: "pending", reviewIteration: iteration },
      {
        id: `test_after_review_fix_${iteration}`,
        command: "test",
        status: "pending",
        reviewIteration: iteration,
      },
    );
  }

  return steps;
}

function autoPhaseIds(maxReviewIterations = AUTO_MAX_REVIEW_ITERATIONS): string[] {
  return buildAutoSteps(maxReviewIterations).map((step) => step.id);
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

function autoStateFile(taskKey: string): string {
  return path.join(process.cwd(), `.agentweaver-state-${taskKey}.json`);
}

function createAutoPipelineState(config: Config): AutoPipelineState {
  return {
    schemaVersion: AUTO_STATE_SCHEMA_VERSION,
    issueKey: config.taskKey,
    jiraRef: config.jiraRef,
    status: "pending",
    currentStep: null,
    maxReviewIterations: AUTO_MAX_REVIEW_ITERATIONS,
    updatedAt: nowIso8601(),
    steps: buildAutoSteps(),
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
  return state;
}

function saveAutoPipelineState(state: AutoPipelineState): void {
  state.updatedAt = nowIso8601();
  writeFileSync(autoStateFile(state.issueKey), `${JSON.stringify(state, null, 2)}\n`, "utf8");
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

function markAutoStepSkipped(step: AutoStepState, note: string): void {
  step.status = "skipped";
  step.note = note;
  step.finishedAt = nowIso8601();
}

function skipAutoStepsAfterReadyToMerge(state: AutoPipelineState, currentStepId: string): void {
  let seenCurrent = false;
  for (const step of state.steps) {
    if (!seenCurrent) {
      seenCurrent = step.id === currentStepId;
      continue;
    }
    if (step.status === "pending") {
      markAutoStepSkipped(step, "ready-to-merge detected");
    }
  }
}

function printAutoState(state: AutoPipelineState): void {
  const lines = [
    `Issue: ${state.issueKey}`,
    `Status: ${state.status}`,
    `Current step: ${state.currentStep ?? "-"}`,
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
  }
  printPanel("Auto Status", lines.join("\n"), "cyan");
}

function printAutoPhasesHelp(): void {
  const phaseLines = ["Available auto phases:", "", "plan", "implement", "test_after_implement"];
  for (let iteration = 1; iteration <= AUTO_MAX_REVIEW_ITERATIONS; iteration += 1) {
    phaseLines.push(`review_${iteration}`, `review_fix_${iteration}`, `test_after_review_fix_${iteration}`);
  }
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

function agentweaverHome(): string {
  const configured = process.env.AGENTWEAVER_HOME?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return PACKAGE_ROOT;
}

function defaultDockerComposeFile(): string {
  return path.join(agentweaverHome(), "docker-compose.yml");
}

function defaultCodexHomeDir(): string {
  return path.join(agentweaverHome(), ".codex-home");
}

function ensureRuntimeBindPath(targetPath: string, isDir: boolean): string {
  mkdirSync(path.dirname(targetPath), { recursive: true });
  if (isDir) {
    mkdirSync(targetPath, { recursive: true });
  } else if (!existsSync(targetPath)) {
    writeFileSync(targetPath, "", "utf8");
  }
  return targetPath;
}

function defaultHostSshDir(): string {
  const candidate = path.join(os.homedir(), ".ssh");
  if (existsSync(candidate)) {
    return candidate;
  }
  return ensureRuntimeBindPath(path.join(agentweaverHome(), ".runtime", "ssh"), true);
}

function defaultHostGitconfig(): string {
  const candidate = path.join(os.homedir(), ".gitconfig");
  if (existsSync(candidate)) {
    return candidate;
  }
  return ensureRuntimeBindPath(path.join(agentweaverHome(), ".runtime", "gitconfig"), false);
}

function dockerRuntimeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  env.AGENTWEAVER_HOME ??= agentweaverHome();
  env.PROJECT_DIR ??= process.cwd();
  env.CODEX_HOME_DIR ??= ensureRuntimeBindPath(defaultCodexHomeDir(), true);
  env.HOST_SSH_DIR ??= defaultHostSshDir();
  env.HOST_GITCONFIG ??= defaultHostGitconfig();
  env.LOCAL_UID ??= typeof process.getuid === "function" ? String(process.getuid()) : "1000";
  env.LOCAL_GID ??= typeof process.getgid === "function" ? String(process.getgid()) : "1000";
  return env;
}

function commandExists(commandName: string): boolean {
  const result = spawnSync("bash", ["-lc", `command -v ${shellQuote(commandName)}`], { stdio: "ignore" });
  return result.status === 0;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findCmdPath(commandName: string, envVarName: string): string | null {
  const configuredPath = process.env[envVarName];
  if (configuredPath && isExecutable(configuredPath)) {
    return configuredPath;
  }

  const direct = spawnSync("bash", ["-lc", `command -v ${shellQuote(commandName)}`], { encoding: "utf8" });
  if (direct.status === 0) {
    const candidate = direct.stdout.trim().split(/\r?\n/)[0] ?? "";
    if (candidate && !candidate.includes("alias") && isExecutable(candidate)) {
      return candidate;
    }
  }

  const interactive = spawnSync("bash", ["-ic", `type -a -- ${shellQuote(commandName)}`], {
    encoding: "utf8",
  });
  if (interactive.status !== 0) {
    return null;
  }

  for (const rawLine of interactive.stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (line.startsWith(`${commandName} is aliased to `)) {
      const aliasValue = line.split(" is aliased to ", 2)[1]?.replace(/^['`]|['`]$/g, "") ?? "";
      if (aliasValue && isExecutable(aliasValue)) {
        return aliasValue;
      }
      continue;
    }
    if (line.startsWith("/")) {
      const candidate = line.split(/\s+/)[0] ?? "";
      if (candidate && isExecutable(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function resolveCmd(commandName: string, envVarName: string): string {
  const candidate = findCmdPath(commandName, envVarName);
  if (candidate) {
    return candidate;
  }
  throw new TaskRunnerError(`Missing required command: ${commandName}`);
}

function requireDockerCompose(): void {
  if (!commandExists("docker")) {
    throw new TaskRunnerError("Missing required command: docker");
  }
  const result = spawnSync("docker", ["compose", "version"], { stdio: "ignore" });
  if (result.status !== 0) {
    throw new TaskRunnerError("Missing required docker compose plugin");
  }
}

function resolveDockerComposeCmd(): string[] {
  const configured = process.env.DOCKER_COMPOSE_BIN?.trim() ?? "";
  if (configured) {
    const parts = splitArgs(configured);
    if (parts.length === 0) {
      throw new TaskRunnerError("DOCKER_COMPOSE_BIN is set but empty.");
    }
    const executable = parts[0] ?? "";
    try {
      if (path.isAbsolute(executable)) {
        accessSync(executable, constants.X_OK);
        return parts;
      }
    } catch {
      throw new TaskRunnerError(`Configured docker compose command is not executable: ${configured}`);
    }
    if (commandExists(executable)) {
      return parts;
    }
    throw new TaskRunnerError(`Configured docker compose command is not executable: ${configured}`);
  }

  if (commandExists("docker-compose")) {
    return ["docker-compose"];
  }

  requireDockerCompose();
  return ["docker", "compose"];
}

function nextReviewIterationForTask(taskKey: string): number {
  let maxIndex = 0;
  for (const entry of readdirSync(process.cwd(), { withFileTypes: true })) {
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
  for (const entry of readdirSync(process.cwd(), { withFileTypes: true })) {
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

function formatCommand(argv: string[], env?: NodeJS.ProcessEnv): string {
  const envParts = Object.entries(env ?? {})
    .filter(([key, value]) => value !== undefined && process.env[key] !== value)
    .map(([key, value]) => `${key}=${shellQuote(value ?? "")}`);
  const command = argv.map(shellQuote).join(" ");
  return envParts.length > 0 ? `${envParts.join(" ")} ${command}` : command;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

async function runCommand(
  argv: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    dryRun?: boolean;
    verbose?: boolean;
    label?: string;
    printFailureOutput?: boolean;
  } = {},
): Promise<string> {
  const { env, dryRun = false, verbose = false, label, printFailureOutput = true } = options;
  const outputAdapter = getOutputAdapter();

  if (dryRun) {
    outputAdapter.writeStdout(`${formatCommand(argv, env)}\n`);
    return "";
  }

  if (verbose && outputAdapter.supportsPassthrough) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(argv[0] ?? "", argv.slice(1), {
        stdio: "inherit",
        env,
      });
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(String(code ?? 1)))));
      child.on("error", reject);
    }).catch((error) => {
      const code = Number.parseInt((error as Error).message, 10);
      throw Object.assign(new Error(`Command failed with exit code ${Number.isNaN(code) ? 1 : code}`), {
        returnCode: Number.isNaN(code) ? 1 : code,
        output: "",
      });
    });
    return "";
  }

  const startedAt = Date.now();
  const statusLabel = label ?? path.basename(argv[0] ?? argv.join(" "));
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let frameIndex = 0;
  let output = "";

  const child = spawn(argv[0] ?? "", argv.slice(1), {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (chunk) => {
    const text = String(chunk);
    output += text;
    if (!outputAdapter.supportsTransientStatus || verbose) {
      outputAdapter.writeStdout(text);
    }
  });
  child.stderr?.on("data", (chunk) => {
    const text = String(chunk);
    output += text;
    if (!outputAdapter.supportsTransientStatus || verbose) {
      outputAdapter.writeStderr(text);
    }
  });

  if (!outputAdapter.supportsTransientStatus) {
    outputAdapter.writeStdout(`Running ${statusLabel}\n`);
  }

  const timer = outputAdapter.supportsTransientStatus
    ? setInterval(() => {
        const elapsed = formatDuration(Date.now() - startedAt);
        process.stdout.write(`\r${frames[frameIndex]} ${statusLabel} ${dim(elapsed)}`);
        frameIndex = (frameIndex + 1) % frames.length;
      }, 200)
    : null;

  try {
    const exitCode = await new Promise<number>((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code) => resolve(code ?? 1));
    });

    if (timer) {
      clearInterval(timer);
      process.stdout.write(`\r${" ".repeat(80)}\r${formatDone(formatDuration(Date.now() - startedAt))}\n`);
    } else {
      outputAdapter.writeStdout(`Done ${formatDuration(Date.now() - startedAt)}\n`);
    }

    if (exitCode !== 0) {
      if (output && printFailureOutput) {
        if (outputAdapter.supportsTransientStatus) {
          process.stderr.write(output);
          if (!output.endsWith("\n")) {
            process.stderr.write("\n");
          }
        }
      }
      throw Object.assign(new Error(`Command failed with exit code ${exitCode}`), {
        returnCode: exitCode,
        output,
      });
    }

    return output;
  } finally {
    if (timer) {
      clearInterval(timer);
    }
  }
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
  return {
    command,
    jiraRef,
    reviewFixPoints: options.reviewFixPoints ?? null,
    extraPrompt: options.extraPrompt ?? null,
    autoFromPhase: options.autoFromPhase ? validateAutoPhaseId(options.autoFromPhase) : null,
    dryRun: options.dryRun ?? false,
    verbose: options.verbose ?? false,
    dockerComposeFile: defaultDockerComposeFile(),
    dockerComposeCmd: [],
    codexCmd: process.env.CODEX_BIN ?? "codex",
    claudeCmd: process.env.CLAUDE_BIN ?? "claude",
    jiraIssueKey,
    taskKey: jiraIssueKey,
    jiraBrowseUrl: buildJiraBrowseUrl(jiraRef),
    jiraApiUrl: buildJiraApiUrl(jiraRef),
    jiraTaskFile: `./${jiraIssueKey}.json`,
  };
}

function checkPrerequisites(config: Config): { codexCmd: string; claudeCmd: string; dockerComposeCmd: string[] } {
  let codexCmd = config.codexCmd;
  let claudeCmd = config.claudeCmd;
  let dockerComposeCmd = config.dockerComposeCmd;

  if (config.command === "plan" || config.command === "review") {
    codexCmd = resolveCmd("codex", "CODEX_BIN");
  }
  if (config.command === "review") {
    claudeCmd = resolveCmd("claude", "CLAUDE_BIN");
  }
  if (["implement", "review-fix", "test", "test-fix", "test-linter-fix"].includes(config.command)) {
    dockerComposeCmd = resolveDockerComposeCmd();
    if (!existsSync(config.dockerComposeFile)) {
      throw new TaskRunnerError(`docker-compose file not found: ${config.dockerComposeFile}`);
    }
  }

  return { codexCmd, claudeCmd, dockerComposeCmd };
}

function buildPhaseConfig(baseConfig: Config, command: CommandName): Config {
  return { ...baseConfig, command };
}

function appendPromptText(basePrompt: string | null | undefined, suffix: string): string {
  if (!basePrompt?.trim()) {
    return suffix;
  }
  return `${basePrompt.trim()}\n${suffix}`;
}

function configForAutoStep(baseConfig: Config, step: AutoStepState): Config {
  if (step.command === "review-fix") {
    return {
      ...buildPhaseConfig(baseConfig, step.command),
      extraPrompt: appendPromptText(baseConfig.extraPrompt, AUTO_REVIEW_FIX_EXTRA_PROMPT),
    };
  }
  return buildPhaseConfig(baseConfig, step.command);
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
}

async function runCodexInDocker(config: Config, dockerComposeCmd: string[], prompt: string, labelText: string): Promise<void> {
  const dockerEnv = dockerRuntimeEnv();
  dockerEnv.CODEX_PROMPT = prompt;
  dockerEnv.CODEX_EXEC_FLAGS = `--model ${codexModel()} --dangerously-bypass-approvals-and-sandbox`;
  printInfo(labelText);
  printPrompt("Codex", prompt);
  await runCommand(
    [...dockerComposeCmd, "-f", config.dockerComposeFile, "run", "--rm", "codex-exec"],
    {
      env: dockerEnv,
      dryRun: config.dryRun,
      verbose: config.verbose,
      label: `codex:${codexModel()}`,
    },
  );
}

async function runVerifyBuildInDocker(config: Config, dockerComposeCmd: string[], labelText: string): Promise<void> {
  printInfo(labelText);
  try {
    await runCommand(
      [...dockerComposeCmd, "-f", config.dockerComposeFile, "run", "--rm", "verify-build"],
      {
        env: dockerRuntimeEnv(),
        dryRun: config.dryRun,
        verbose: false,
        label: "verify-build",
        printFailureOutput: false,
      },
    );
  } catch (error) {
    const returnCode = Number((error as { returnCode?: number }).returnCode ?? 1);
    printError(`Build verification failed with exit code ${returnCode}`);
    if (!config.dryRun) {
      printSummary(
        "Build Failure Summary",
        await summarizeBuildFailure(String((error as { output?: string }).output ?? "")),
      );
    }
    throw error;
  }
}

function codexModel(): string {
  return process.env.CODEX_MODEL?.trim() || DEFAULT_CODEX_MODEL;
}

function claudeReviewModel(): string {
  return process.env.CLAUDE_REVIEW_MODEL?.trim() || DEFAULT_CLAUDE_REVIEW_MODEL;
}

function claudeSummaryModel(): string {
  return process.env.CLAUDE_SUMMARY_MODEL?.trim() || DEFAULT_CLAUDE_SUMMARY_MODEL;
}

function truncateText(text: string, maxChars = 12000): string {
  return text.length <= maxChars ? text.trim() : text.trim().slice(-maxChars);
}

function fallbackBuildFailureSummary(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const tail = lines.length > 0 ? lines.slice(-8) : ["No build output captured."];
  return `Не удалось получить summary через Claude.\n\nПоследние строки лога:\n${tail.join("\n")}`;
}

async function summarizeBuildFailure(output: string): Promise<string> {
  if (!output.trim()) {
    return "Build verification failed, but no output was captured.";
  }

  let claudeCmd: string;
  try {
    claudeCmd = resolveCmd("claude", "CLAUDE_BIN");
  } catch {
    return fallbackBuildFailureSummary(output);
  }

  const prompt =
    "Ниже лог упавшей build verification.\n" +
    "Сделай краткое резюме на русском языке, без воды.\n" +
    "Нужно обязательно выделить:\n" +
    "1. Где именно упало.\n" +
    "2. Главную причину падения.\n" +
    "3. Что нужно исправить дальше, если это очевидно.\n" +
    "Ответ дай максимум 5 короткими пунктами.\n\n" +
    `Лог:\n${truncateText(output)}`;

  printInfo(`Summarizing build failure with Claude (${claudeSummaryModel()})`);
  try {
    const summary = await runCommand([claudeCmd, "--model", claudeSummaryModel(), "-p", prompt], {
      env: { ...process.env },
      dryRun: false,
      verbose: false,
      label: `claude:${claudeSummaryModel()}`,
    });
    return summary.trim() || fallbackBuildFailureSummary(output);
  } catch {
    return fallbackBuildFailureSummary(output);
  }
}

async function runClaudeSummary(claudeCmd: string, outputFile: string, prompt: string, verbose = false): Promise<string> {
  printInfo(`Preparing summary in ${outputFile}`);
  printPrompt("Claude", prompt);
  await runCommand(
    [claudeCmd, "--model", claudeSummaryModel(), "-p", "--allowedTools=Read,Write,Edit", prompt],
    {
      env: { ...process.env },
      dryRun: false,
      verbose,
      label: `claude:${claudeSummaryModel()}`,
    },
  );
  requireArtifacts([outputFile], `Claude summary did not produce ${outputFile}.`);
  return readFileSync(outputFile, "utf8").trim();
}

async function summarizeTask(jiraRef: string): Promise<{ issueKey: string; summaryText: string }> {
  const config = buildConfig("plan", jiraRef);
  const claudeCmd = resolveCmd("claude", "CLAUDE_BIN");
  await fetchJiraIssue(config.jiraApiUrl, config.jiraTaskFile);

  const summaryPrompt = formatTemplate(TASK_SUMMARY_PROMPT_TEMPLATE, {
    jira_task_file: config.jiraTaskFile,
    task_summary_file: taskSummaryFile(config.taskKey),
  });
  const summaryText = await runClaudeSummary(claudeCmd, taskSummaryFile(config.taskKey), summaryPrompt);
  return { issueKey: config.jiraIssueKey, summaryText };
}

function resolveTaskIdentity(jiraRef: string): { issueKey: string; summaryText: string } {
  const config = buildConfig("plan", jiraRef);
  const summaryPath = taskSummaryFile(config.taskKey);
  const summaryText = existsSync(summaryPath) ? readFileSync(summaryPath, "utf8").trim() : "";
  return { issueKey: config.jiraIssueKey, summaryText };
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

  const { codexCmd, claudeCmd, dockerComposeCmd } = checkPrerequisites(config);
  process.env.JIRA_BROWSE_URL = config.jiraBrowseUrl;
  process.env.JIRA_API_URL = config.jiraApiUrl;
  process.env.JIRA_TASK_FILE = config.jiraTaskFile;

  const planPrompt = formatPrompt(
    formatTemplate(PLAN_PROMPT_TEMPLATE, {
      jira_task_file: config.jiraTaskFile,
      design_file: designFile(config.taskKey),
      plan_file: planFile(config.taskKey),
      qa_file: qaFile(config.taskKey),
    }),
    config.extraPrompt,
  );

  const implementPrompt = formatPrompt(
    formatTemplate(IMPLEMENT_PROMPT_TEMPLATE, {
      design_file: designFile(config.taskKey),
      plan_file: planFile(config.taskKey),
    }),
    config.extraPrompt,
  );

  if (config.command === "plan") {
    if (config.verbose) {
      process.stdout.write(`Fetching Jira issue from browse URL: ${config.jiraBrowseUrl}\n`);
      process.stdout.write(`Resolved Jira API URL: ${config.jiraApiUrl}\n`);
      process.stdout.write(`Saving Jira issue JSON to: ${config.jiraTaskFile}\n`);
    }
    await fetchJiraIssue(config.jiraApiUrl, config.jiraTaskFile);
    printInfo("Running Codex planning mode");
    printPrompt("Codex", planPrompt);
    await runCommand([codexCmd, "exec", "--model", codexModel(), "--full-auto", planPrompt], {
      env: { ...process.env },
      dryRun: config.dryRun,
      verbose: config.verbose,
      label: `codex:${codexModel()}`,
    });
    requireArtifacts(planArtifacts(config.taskKey), "Plan mode did not produce the required artifacts.");
    return false;
  }

  if (config.command === "implement") {
    requireJiraTaskFile(config.jiraTaskFile);
    requireArtifacts(planArtifacts(config.taskKey), "Implement mode requires plan artifacts from the planning phase.");
    await runCodexInDocker(config, dockerComposeCmd, implementPrompt, "Running Codex implementation mode in isolated Docker");
    if (runFollowupVerify) {
      await runVerifyBuildInDocker(config, dockerComposeCmd, "Running build verification in isolated Docker");
    }
    return false;
  }

  if (config.command === "review") {
    requireJiraTaskFile(config.jiraTaskFile);
    requireArtifacts(planArtifacts(config.taskKey), "Review mode requires plan artifacts from the planning phase.");
    const iteration = nextReviewIterationForTask(config.taskKey);
    const reviewFile = artifactFile("review", config.taskKey, iteration);
    const reviewReplyFile = artifactFile("review-reply", config.taskKey, iteration);
    const reviewSummaryFile = artifactFile("review-summary", config.taskKey, iteration);
    const reviewReplySummaryFile = artifactFile("review-reply-summary", config.taskKey, iteration);
    const claudePrompt = formatPrompt(
      formatTemplate(REVIEW_PROMPT_TEMPLATE, {
        jira_task_file: config.jiraTaskFile,
        design_file: designFile(config.taskKey),
        plan_file: planFile(config.taskKey),
        review_file: reviewFile,
      }),
      config.extraPrompt,
    );
    const codexReplyPrompt = formatPrompt(
      formatTemplate(REVIEW_REPLY_PROMPT_TEMPLATE, {
        review_file: reviewFile,
        jira_task_file: config.jiraTaskFile,
        design_file: designFile(config.taskKey),
        plan_file: planFile(config.taskKey),
        review_reply_file: reviewReplyFile,
      }),
      config.extraPrompt,
    );

    printInfo(`Running Claude review mode (iteration ${iteration})`);
    printPrompt("Claude", claudePrompt);
    await runCommand(
      [
        claudeCmd,
        "--model",
        claudeReviewModel(),
        "-p",
        "--allowedTools=Read,Write,Edit",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        claudePrompt,
      ],
      {
        env: { ...process.env },
        dryRun: config.dryRun,
        verbose: config.verbose,
        label: `claude:${claudeReviewModel()}`,
      },
    );

    if (!config.dryRun) {
      requireArtifacts([reviewFile], "Claude review did not produce the required review artifact.");
      const reviewSummaryText = await runClaudeSummary(
        claudeCmd,
        reviewSummaryFile,
        formatTemplate(REVIEW_SUMMARY_PROMPT_TEMPLATE, {
          review_file: reviewFile,
          review_summary_file: reviewSummaryFile,
        }),
        config.verbose,
      );
      printSummary("Claude Comments", reviewSummaryText);
    }

    printInfo(`Running Codex review reply mode (iteration ${iteration})`);
    printPrompt("Codex", codexReplyPrompt);
    await runCommand([codexCmd, "exec", "--model", codexModel(), "--full-auto", codexReplyPrompt], {
      env: { ...process.env },
      dryRun: config.dryRun,
      verbose: config.verbose,
      label: `codex:${codexModel()}`,
    });

    let readyToMerge = false;
    if (!config.dryRun) {
      requireArtifacts([reviewReplyFile], "Codex review reply did not produce the required review-reply artifact.");
      const reviewReplySummaryText = await runClaudeSummary(
        claudeCmd,
        reviewReplySummaryFile,
        formatTemplate(REVIEW_REPLY_SUMMARY_PROMPT_TEMPLATE, {
          review_reply_file: reviewReplyFile,
          review_reply_summary_file: reviewReplySummaryFile,
        }),
        config.verbose,
      );
      printSummary("Codex Reply Summary", reviewReplySummaryText);
      if (existsSync(READY_TO_MERGE_FILE)) {
        printPanel("Ready To Merge", "Изменения готовы к merge\nФайл ready-to-merge.md создан.", "green");
        readyToMerge = true;
      }
    }
    return readyToMerge;
  }

  if (config.command === "review-fix") {
    requireJiraTaskFile(config.jiraTaskFile);
    requireArtifacts(planArtifacts(config.taskKey), "Review-fix mode requires plan artifacts from the planning phase.");
    const latestIteration = latestReviewReplyIteration(config.taskKey);
    if (latestIteration === null) {
      throw new TaskRunnerError(`Review-fix mode requires at least one review-reply-${config.taskKey}-N.md artifact.`);
    }
    const reviewReplyFile = artifactFile("review-reply", config.taskKey, latestIteration);
    const reviewFixFile = artifactFile("review-fix", config.taskKey, latestIteration);
    const reviewFixPrompt = formatPrompt(
      formatTemplate(REVIEW_FIX_PROMPT_TEMPLATE, {
        review_reply_file: reviewReplyFile,
        items: config.reviewFixPoints ?? "",
        review_fix_file: reviewFixFile,
      }),
      config.extraPrompt,
    );
    await runCodexInDocker(
      config,
      dockerComposeCmd,
      reviewFixPrompt,
      `Running Codex review-fix mode in isolated Docker (iteration ${latestIteration})`,
    );
    if (!config.dryRun) {
      requireArtifacts([reviewFixFile], "Review-fix mode did not produce the required review-fix artifact.");
    }
    if (runFollowupVerify) {
      await runVerifyBuildInDocker(config, dockerComposeCmd, "Running build verification in isolated Docker");
    }
    return false;
  }

  if (config.command === "test") {
    requireJiraTaskFile(config.jiraTaskFile);
    requireArtifacts(planArtifacts(config.taskKey), "Test mode requires plan artifacts from the planning phase.");
    await runVerifyBuildInDocker(config, dockerComposeCmd, "Running build verification in isolated Docker");
    return false;
  }

  if (config.command === "test-fix" || config.command === "test-linter-fix") {
    requireJiraTaskFile(config.jiraTaskFile);
    requireArtifacts(planArtifacts(config.taskKey), `${config.command} mode requires plan artifacts from the planning phase.`);
    const prompt = formatPrompt(config.command === "test-fix" ? TEST_FIX_PROMPT_TEMPLATE : TEST_LINTER_FIX_PROMPT_TEMPLATE, config.extraPrompt);
    await runCodexInDocker(
      config,
      dockerComposeCmd,
      prompt,
      `Running Codex ${config.command} mode in isolated Docker`,
    );
    return false;
  }

  throw new TaskRunnerError(`Unsupported command: ${config.command}`);
}

async function runAutoPipelineDryRun(config: Config): Promise<void> {
  printInfo("Dry-run auto pipeline: plan -> implement -> test -> review/review-fix/test");
  await executeCommand(buildPhaseConfig(config, "plan"));
  await executeCommand(buildPhaseConfig(config, "implement"), false);
  await executeCommand(buildPhaseConfig(config, "test"));
  for (let iteration = 1; iteration <= AUTO_MAX_REVIEW_ITERATIONS; iteration += 1) {
    printInfo(`Dry-run auto review iteration ${iteration}/${AUTO_MAX_REVIEW_ITERATIONS}`);
    await executeCommand(buildPhaseConfig(config, "review"));
    await executeCommand(
      {
        ...buildPhaseConfig(config, "review-fix"),
        extraPrompt: appendPromptText(config.extraPrompt, AUTO_REVIEW_FIX_EXTRA_PROMPT),
      },
      false,
    );
    await executeCommand(buildPhaseConfig(config, "test"));
  }
}

async function runAutoPipeline(config: Config): Promise<void> {
  if (config.dryRun) {
    await runAutoPipelineDryRun(config);
    return;
  }

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
      if (state.steps.some((candidate) => candidate.status === "failed")) {
        state.status = "blocked";
      } else if (state.steps.some((candidate) => candidate.status === "skipped")) {
        state.status = "completed";
      } else {
        state.status = "max-iterations-reached";
      }
      state.currentStep = null;
      saveAutoPipelineState(state);
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
      const readyToMerge = await executeCommand(
        configForAutoStep(config, step),
        !["implement", "review-fix"].includes(step.command),
      );
      step.status = "done";
      step.finishedAt = nowIso8601();
      step.returnCode = 0;

      if (step.command === "review" && readyToMerge) {
        skipAutoStepsAfterReadyToMerge(state, step.id);
        state.status = "completed";
        state.currentStep = null;
        saveAutoPipelineState(state);
        printPanel("Auto", "Auto pipeline finished", "green");
        return;
      }
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

    saveAutoPipelineState(state);
  }
}

function splitArgs(input: string): string[] {
  const result: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] ?? "";
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        result.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (quote) {
    throw new TaskRunnerError("Cannot parse command: unterminated quote");
  }
  if (current) {
    result.push(current);
  }
  return result;
}

function parseCliArgs(argv: string[]): ParsedArgs {
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

function interactiveHelp(): void {
  printPanel(
    "Interactive Commands",
    [
      "/plan [extra prompt]",
      "/implement [extra prompt]",
      "/review [extra prompt]",
      "/review-fix [extra prompt]",
      "/test",
      "/test-fix [extra prompt]",
      "/test-linter-fix [extra prompt]",
      "/auto [extra prompt]",
      "/auto --from <phase> [extra prompt]",
      "/auto-status",
      "/auto-reset",
      "/help auto",
      "/help",
      "/exit",
    ].join("\n"),
    "magenta",
  );
}

function parseInteractiveCommand(line: string, jiraRef: string): Config | null {
  const parts = splitArgs(line);
  if (parts.length === 0) {
    return null;
  }

  const command = parts[0] ?? "";
  if (!command.startsWith("/")) {
    throw new TaskRunnerError("Interactive mode expects slash commands. Use /help.");
  }

  const commandName = command.slice(1);
  if (commandName === "help") {
    if (parts[1] === "auto" || parts[1] === "phases") {
      printAutoPhasesHelp();
      return null;
    }
    interactiveHelp();
    return null;
  }
  if (commandName === "exit" || commandName === "quit") {
    throw new EOFError();
  }
  if (!COMMANDS.includes(commandName as CommandName)) {
    throw new TaskRunnerError(`Unknown command: ${command}`);
  }

  if (commandName === "auto") {
    let autoFromPhase: string | undefined;
    let extraParts = parts.slice(1);
    if (extraParts[0] === "--from") {
      if (!extraParts[1]) {
        throw new TaskRunnerError("auto --from requires a phase name. Use /help auto.");
      }
      autoFromPhase = extraParts[1];
      extraParts = extraParts.slice(2);
    }
    return buildConfig("auto", jiraRef, {
      extraPrompt: extraParts.join(" ") || null,
      ...(autoFromPhase !== undefined ? { autoFromPhase } : {}),
    });
  }

  return buildConfig(commandName as CommandName, jiraRef, {
    extraPrompt: parts.slice(1).join(" ") || null,
  });
}

class EOFError extends Error {}

async function ensureHistoryFile(): Promise<void> {
  mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  if (!existsSync(HISTORY_FILE)) {
    writeFileSync(HISTORY_FILE, "", "utf8");
  }
}

async function runInteractive(jiraRef: string, forceRefresh = false): Promise<number> {
  const config = buildConfig("plan", jiraRef);
  const jiraTaskPath = config.jiraTaskFile;

  await ensureHistoryFile();
  const historyLines = (await readFile(HISTORY_FILE, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-200);

  let exiting = false;
  const commandList = [
    "/plan",
    "/implement",
    "/review",
    "/review-fix",
    "/test",
    "/test-fix",
    "/test-linter-fix",
    "/auto",
    "/auto-status",
    "/auto-reset",
    "/help",
    "/exit",
  ];
  const ui = new InteractiveUi(
    {
      issueKey: config.jiraIssueKey,
      summaryText: "Starting interactive session...",
      cwd: process.cwd(),
      commands: commandList,
      onSubmit: async (line) => {
        try {
          await appendFile(HISTORY_FILE, `${line.trim()}\n`, "utf8");
          const command = parseInteractiveCommand(line, jiraRef);
          if (!command) {
            return;
          }
          ui.setBusy(true, command.command);
          await executeCommand(command);
        } catch (error) {
          if (error instanceof EOFError) {
            exiting = true;
            return;
          }
          if (error instanceof TaskRunnerError) {
            printError(error.message);
            return;
          }
          const returnCode = Number((error as { returnCode?: number }).returnCode);
          if (!Number.isNaN(returnCode)) {
            printError(`Command failed with exit code ${returnCode}`);
            return;
          }
          throw error;
        } finally {
          ui.setBusy(false);
        }
      },
      onExit: () => {
        exiting = true;
      },
    },
    historyLines,
  );

  ui.mount();
  printInfo(`Interactive mode for ${config.jiraIssueKey}`);
  printInfo("Use /help to see commands.");

  try {
    ui.setStatus("preflight");
    printInfo("Checking required commands");
    resolveCmd("codex", "CODEX_BIN");
    resolveCmd("claude", "CLAUDE_BIN");
    printInfo("Required commands found");

    if (forceRefresh || !existsSync(jiraTaskPath)) {
      ui.setStatus("fetch_jira");
      printInfo(`Fetching Jira issue ${config.jiraIssueKey}`);
      await fetchJiraIssue(config.jiraApiUrl, config.jiraTaskFile);

      ui.setStatus("summary");
      printInfo("Generating task summary with Claude");
      const claudeCmd = resolveCmd("claude", "CLAUDE_BIN");
      const summaryPrompt = formatTemplate(TASK_SUMMARY_PROMPT_TEMPLATE, {
        jira_task_file: config.jiraTaskFile,
        task_summary_file: taskSummaryFile(config.taskKey),
      });
      const summaryText = await runClaudeSummary(claudeCmd, taskSummaryFile(config.taskKey), summaryPrompt);
      ui.setSummary(summaryText);
      printInfo("Task summary loaded");
    } else {
      const taskIdentity = resolveTaskIdentity(jiraRef);
      if (taskIdentity.summaryText) {
        ui.setSummary(taskIdentity.summaryText);
        printInfo("Loaded existing task summary");
      } else {
        ui.setSummary("Task summary is not available yet. Run `/plan` or refresh Jira data.");
        printInfo("Task summary is not available yet");
      }
    }
    ui.setStatus("idle");
  } catch (error) {
    ui.setStatus("preflight_failed");
    if (error instanceof TaskRunnerError) {
      printError(error.message);
    } else {
      throw error;
    }
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
