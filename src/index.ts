#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import type { RuntimeServices } from "./executors/types.js";
import {
  bugAnalyzeArtifacts,
  bugAnalyzeJsonFile,
  bugFixDesignJsonFile,
  bugFixPlanJsonFile,
  designReviewFile,
  designReviewJsonFile,
  designJsonFile,
  gitlabDiffFile,
  gitlabDiffJsonFile,
  ensureScopeWorkspaceDir,
  gitlabReviewFile,
  gitlabReviewJsonFile,
  latestArtifactIteration,
  nextArtifactIteration,
  planJsonFile,
  planArtifacts,
  qaJsonFile,
  readyToMergeFile,
  requireArtifacts,
  reviewAssessmentFile,
  reviewAssessmentJsonFile,
  reviewFile,
  reviewFixSelectionJsonFile,
  reviewJsonFile,
  scopeWorkspaceDir,
  flowStateFile,
  taskSummaryFile,
} from "./artifacts.js";
import { FlowInterruptedError, TaskRunnerError } from "./errors.js";
import {
  createFlowRunState,
  hasResumableFlowState,
  loadFlowRunState,
  prepareFlowStateForResume,
  resetFlowRunState,
  rewindFlowRunStateToPhase,
  saveFlowRunState,
  stripExecutionStatePayload,
  type FlowRunState,
} from "./flow-state.js";
import { requireJiraTaskFile } from "./jira.js";
import { validateStructuredArtifacts } from "./structured-artifacts.js";
import { summarizeBuildFailure as summarizeBuildFailureViaPipeline } from "./pipeline/build-failure-summary.js";
import { runNodeChecks } from "./pipeline/checks.js";
import { createPipelineContext } from "./pipeline/context.js";
import { loadDeclarativeFlow, type DeclarativeFlowRef } from "./pipeline/declarative-flows.js";
import { runExpandedPhase } from "./pipeline/declarative-flow-runner.js";
import { findCatalogEntry, isBuiltInCommandFlowId, loadInteractiveFlowCatalog, toDeclarativeFlowRef, type FlowCatalogEntry } from "./pipeline/flow-catalog.js";
import {
  ALLOWED_MODELS_BY_EXECUTOR,
  defaultModelForExecutor,
  DEFAULT_LAUNCH_PROFILE,
  LLM_EXECUTOR_IDS,
  resolveLaunchProfile,
  type LaunchProfileSelection,
  type ResolvedLaunchProfile,
} from "./pipeline/launch-profile-config.js";
import type { ExpandedPhaseExecutionState, ExpandedPhaseSpec, ExpandedStepSpec, FlowExecutionState } from "./pipeline/spec-types.js";
import type { NodeCheckSpec, PipelineContext } from "./pipeline/types.js";
import { evaluateCondition, resolveValue, type DeclarativeResolverContext } from "./pipeline/value-resolver.js";
import { resolveCmd } from "./runtime/command-resolution.js";
import { loadTieredEnv } from "./runtime/env-loader.js";
import { agentweaverHome } from "./runtime/agentweaver-home.js";
import { runCommand } from "./runtime/process-runner.js";
import { resolveDesignReviewInputContract } from "./runtime/design-review-input-contract.js";
import { clearReadyToMergeFile } from "./runtime/ready-to-merge.js";
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
import type { UserInputFormDefinition } from "./user-input.js";
import { runDoctorCommand } from "./doctor/index.js";
import {
  attachJiraContext,
  detectGitBranchName,
  requestJiraContext,
  resolveProjectScope,
  type ResolvedScope,
} from "./scope.js";

const COMMANDS = [
  "auto-golang",
  "auto-common",
  "auto-status",
  "auto-reset",
  "bug-analyze",
  "bug-fix",
  "design-review",
  "doctor",
  "git-commit",
  "gitlab-diff-review",
  "gitlab-review",
  "mr-description",
  "plan",
  "task-describe",
  "implement",
  "review",
  "review-fix",
  "review-loop",
  "run-go-tests-loop",
  "run-go-linter-loop",
] as const;

type CommandName = (typeof COMMANDS)[number];

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(MODULE_DIR, "..");
function createRuntimeServices(signal?: AbortSignal): RuntimeServices {
  return {
    resolveCmd,
    runCommand: (argv, options = {}) => runCommand(argv, { ...options, ...(signal ? { signal } : {}) }),
  };
}

const runtimeServices = createRuntimeServices();

type BaseConfig = {
  command: string;
  jiraRef?: string | null;
  scopeName?: string | null;
  reviewFixPoints?: string | null;
  extraPrompt?: string | null;
  autoFromPhase?: string | null;
  mdLang?: "en" | "ru" | null;
  dryRun: boolean;
  verbose: boolean;
  doctorArgs?: string[];

};

type Config = BaseConfig & {
  scope: ResolvedScope;
  taskKey: string;
  jiraRef: string;
  jiraBrowseUrl?: string;
  jiraApiUrl?: string;
  jiraTaskFile?: string;
};

type DeclarativeFlowOverrides = {
  launchProfile?: ResolvedLaunchProfile;
};

type ParsedArgs = {
  command: CommandName;
  jiraRef?: string;
  scopeName?: string;
  dry: boolean;
  verbose: boolean;
  prompt?: string;
  autoFromPhase?: string;
  mdLang?: "en" | "ru";
  helpPhases: boolean;
  doctorArgs?: string[];
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
  return `${baseMessage}\nReason:\n${preview}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function usage(): string {
  return `Usage:
  agentweaver
  agentweaver <jira-browse-url|jira-issue-key>
  agentweaver --force <jira-browse-url|jira-issue-key>
  agentweaver git-commit [--dry] [--verbose] [--prompt <text>] [--scope <name>] [<jira-browse-url|jira-issue-key>]
  agentweaver gitlab-diff-review [--dry] [--verbose] [--prompt <text>] [--scope <name>]
  agentweaver gitlab-review [--dry] [--verbose] [--prompt <text>] [--scope <name>]
  agentweaver bug-analyze [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  agentweaver bug-fix [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  agentweaver design-review [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  agentweaver doctor [<category>|<check-id>] [--json]
  agentweaver mr-description [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  agentweaver plan [--dry] [--verbose] [--prompt <text>] [--md-lang <en|ru>] [<jira-browse-url|jira-issue-key>]
  agentweaver task-describe [--dry] [--verbose] [--prompt <text>] [<jira-browse-url|jira-issue-key>]
  agentweaver implement [--dry] [--verbose] [--prompt <text>] [--scope <name>] [<jira-browse-url|jira-issue-key>]
  agentweaver review [--dry] [--verbose] [--prompt <text>] [--scope <name>] [<jira-browse-url|jira-issue-key>]
  agentweaver review-fix [--dry] [--verbose] [--prompt <text>] [--scope <name>] [<jira-browse-url|jira-issue-key>]
  agentweaver review-loop [--dry] [--verbose] [--prompt <text>] [--scope <name>] [<jira-browse-url|jira-issue-key>]
  agentweaver run-go-tests-loop [--dry] [--verbose] [--prompt <text>] [--scope <name>] [<jira-browse-url|jira-issue-key>]
  agentweaver run-go-linter-loop [--dry] [--verbose] [--prompt <text>] [--scope <name>] [<jira-browse-url|jira-issue-key>]
  agentweaver auto-golang [--dry] [--verbose] [--prompt <text>] [<jira-browse-url|jira-issue-key>]
  agentweaver auto-golang [--dry] [--verbose] [--prompt <text>] --from <phase> [<jira-browse-url|jira-issue-key>]
  agentweaver auto-golang --help-phases
  agentweaver auto-status [<jira-browse-url|jira-issue-key>]
  agentweaver auto-reset [<jira-browse-url|jira-issue-key>]

Interactive Mode:
  When started without a command, the script opens an interactive UI.
  If a Jira task is provided, interactive mode starts in the current project scope with Jira context attached.
  Use Up/Down to move in the flow tree, Left/Right to collapse or expand folders, Enter to toggle a folder or run a flow, h for help, q to exit.

Flags:
  --version       Show package version
  --force         In interactive mode, regenerate task summary in Jira-backed flows
  --dry           Fetch Jira task, but print codex/opencode commands instead of executing them
  --verbose       Show live stdout/stderr of launched commands
  --scope         Explicit workflow scope name for non-Jira runs
  --prompt        Extra prompt text appended to the base prompt
  --md-lang       Language for markdown output files: en (English) or ru (Russian, default)

Required environment variables:
  JIRA_API_KEY    Jira API token used for Jira-backed flows (Bearer by default, or Basic with Jira Cloud)

Optional environment variables:
  JIRA_USERNAME   Required for Jira Cloud Basic auth (usually Atlassian account email)
  JIRA_AUTH_MODE  Override Jira auth mode: auto | basic | bearer
  JIRA_BASE_URL
  GITLAB_TOKEN
  AGENTWEAVER_HOME
  CODEX_BIN
  CODEX_MODEL
  OPENCODE_BIN
  OPENCODE_MODEL

Notes:
  - Jira-backed task flows will ask for Jira task via user-input when it is not passed as an argument. task-describe can also work from a manual task description without Jira.
  - All flow state and artifacts are stored in the current project scope by default.
  - gitlab-review and gitlab-diff-review ask for GitLab merge request URL via user-input.`;
}

function packageVersion(): string {
  const packageJsonPath = path.join(PACKAGE_ROOT, "package.json");
  const raw = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
  if (typeof raw.version !== "string" || !raw.version.trim()) {
    throw new TaskRunnerError(`Package version is missing in ${packageJsonPath}`);
  }
  return raw.version;
}

function normalizeAutoPhaseId(phaseId: string): string {
  return phaseId.trim().toLowerCase().replaceAll("-", "_");
}

function autoPhaseIds(): string[] {
  return loadDeclarativeFlow({ source: "built-in", fileName: "auto-golang.json" }).phases.map((phase) => phase.id);
}

function validateAutoPhaseId(phaseId: string): string {
  const normalized = normalizeAutoPhaseId(phaseId);
  if (!autoPhaseIds().includes(normalized)) {
    throw new TaskRunnerError(
      `Unknown auto-golang phase: ${phaseId}\nUse 'agentweaver auto-golang --help-phases' or '/help auto-golang' to list valid phases.`,
    );
  }
  return normalized;
}

function buildFlowResumeDetails(state: FlowRunState): string {
  const currentStep = findCurrentFlowExecutionStep(state) ?? state.currentStep ?? "-";
  const lines = [
    "Interrupted run found.",
    `Current step: ${currentStep}`,
    `Updated: ${state.updatedAt}`,
  ];
  if (state.launchProfile) {
    lines.push(`Launch profile: ${state.launchProfile.executor} / ${state.launchProfile.model}`);
  }
  if (state.lastError) {
    lines.push(`Last error: ${state.lastError.message ?? "-"} (exit ${state.lastError.returnCode ?? "-"})`);
  }
  return lines.join("\n");
}

function launchProfileSelectionForm(): UserInputFormDefinition {
  const defaultExecutor = DEFAULT_LAUNCH_PROFILE.executor;
  return {
    formId: "flow-launch-profile",
    title: "LLM Launch Settings",
    description: `Select an executor for the flow. Current default: ${defaultExecutor}.`,
    submitLabel: "Continue",
    fields: [
      {
        id: "executor",
        type: "single-select",
        label: "Executor",
        required: true,
        default: defaultExecutor,
        options: LLM_EXECUTOR_IDS.map((id) => ({
          value: id,
          label: id === defaultExecutor ? `${id} [default]` : id,
        })),
      },
    ],
  };
}

function launchModelSelectionForm(executor: LaunchProfileSelection["executor"]): UserInputFormDefinition {
  const resolvedExecutor = executor === "default" ? DEFAULT_LAUNCH_PROFILE.executor : executor;
  const defaultModel = defaultModelForExecutor(resolvedExecutor);
  const options = ALLOWED_MODELS_BY_EXECUTOR[resolvedExecutor].map((model) => ({
    value: model,
    label: model === defaultModel ? `${model} [default]` : model,
  }));
  return {
    formId: "flow-launch-model",
    title: "LLM Launch Settings",
    description: `Select a model for the flow. Current default for ${resolvedExecutor}: ${defaultModel}.`,
    submitLabel: "Start",
    fields: [
      {
        id: "model",
        type: "single-select",
        label: "Model",
        required: true,
        default: defaultModel,
        options,
      },
    ],
  };
}

function isFormCancellation(error: unknown, formId: string): boolean {
  return error instanceof TaskRunnerError && error.message === `User cancelled form '${formId}'.`;
}

async function requestInteractiveLaunchProfile(requestUserInput: UserInputRequester): Promise<ResolvedLaunchProfile> {
  for (; ;) {
    const executorFormResult = await requestUserInput(launchProfileSelectionForm());
    const rawExecutor = String(executorFormResult.values.executor ?? DEFAULT_LAUNCH_PROFILE.executor);
    const executor = LLM_EXECUTOR_IDS.find((id) => id === rawExecutor);
    if (!executor) {
      throw new TaskRunnerError(`Unsupported launch executor '${rawExecutor}'.`);
    }
    try {
      const modelFormResult = await requestUserInput(launchModelSelectionForm(executor));
      const rawModel = String(modelFormResult.values.model ?? defaultModelForExecutor(executor)).trim();
      return resolveLaunchProfile(
        {
          executor,
          model: rawModel.length > 0 ? rawModel : defaultModelForExecutor(executor),
        },
        DEFAULT_LAUNCH_PROFILE,
      );
    } catch (error) {
      if (isFormCancellation(error, "flow-launch-model")) {
        continue;
      }
      throw error;
    }
  }
}

type FlowResumeLookup = {
  resumeAvailable: boolean;
  hasExistingState: boolean;
  details?: string;
};

function buildResolverContext(
  pipelineContext: PipelineContext,
  flowParams: Record<string, unknown>,
  flowConstants: Record<string, unknown>,
  repeatVars: Record<string, unknown>,
  executionState: FlowExecutionState,
): DeclarativeResolverContext {
  return {
    flowParams,
    flowConstants,
    pipelineContext,
    repeatVars,
    executionState,
  };
}

function resolveResumeChecks(step: ExpandedStepSpec, context: DeclarativeResolverContext): NodeCheckSpec[] {
  return (step.expect ?? [])
    .filter((expectation) => evaluateCondition(expectation.when, context))
    .flatMap<NodeCheckSpec>((expectation) => {
      if (expectation.kind === "step-output") {
        const value = resolveValue(expectation.value, context);
        if (expectation.equals !== undefined) {
          const expected = resolveValue(expectation.equals, context);
          if (value !== expected) {
            throw new TaskRunnerError(expectation.message);
          }
          return [];
        }
        if (!value) {
          throw new TaskRunnerError(expectation.message);
        }
        return [];
      }
      if (expectation.kind === "require-artifacts") {
        const value = resolveValue(expectation.paths, context);
        if (!Array.isArray(value) || value.some((candidate) => typeof candidate !== "string")) {
          throw new TaskRunnerError("Expectation 'require-artifacts' must resolve to string[]");
        }
        return [{ kind: "require-artifacts", paths: value as string[], message: expectation.message }];
      }
      if (expectation.kind === "require-file") {
        const value = resolveValue(expectation.path, context);
        if (typeof value !== "string") {
          throw new TaskRunnerError("Expectation 'require-file' must resolve to string");
        }
        return [{ kind: "require-file", path: value, message: expectation.message }];
      }
      const items = expectation.items.map((item) => {
        const value = resolveValue(item.path, context);
        if (typeof value !== "string") {
          throw new TaskRunnerError("Expectation 'require-structured-artifacts' item path must resolve to string");
        }
        return {
          path: value,
          schemaId: item.schemaId,
        };
      });
      return [{ kind: "require-structured-artifacts", items, message: expectation.message }];
    });
}

function validateDeclarativePhaseResumeState(
  phase: ExpandedPhaseSpec,
  phaseState: ExpandedPhaseExecutionState,
  pipelineContext: PipelineContext,
  flowParams: Record<string, unknown>,
  flowConstants: Record<string, unknown>,
  executionState: FlowExecutionState,
): void {
  if (phaseState.status === "done") {
    return;
  }
  for (const [stepIndex, step] of phase.steps.entries()) {
    const stepState = phaseState.steps[stepIndex];
    if (!stepState || stepState.status !== "done") {
      continue;
    }
    const context = buildResolverContext(pipelineContext, flowParams, flowConstants, step.repeatVars, executionState);
    const checks = resolveResumeChecks(step, context);
    try {
      runNodeChecks(checks);
    } catch (error) {
      throw new TaskRunnerError(
        `Resume is impossible for '${phase.id}:${step.id}' because required artifacts are missing or invalid. Use restart.\n${(error as Error).message}`,
      );
    }
  }
}

function validateDeclarativeFlowResumeState(
  flowEntry: FlowCatalogEntry,
  config: Config,
  state: FlowRunState,
  launchProfile?: ResolvedLaunchProfile,
  runtime: RuntimeServices = runtimeServices,
): void {
  if (state.launchProfile) {
    if (!launchProfile) {
      throw new TaskRunnerError("Resume is impossible because launch profile is missing. Use restart.");
    }
    if (state.launchProfile.fingerprint !== launchProfile.fingerprint) {
      throw new TaskRunnerError(
        `Resume is impossible because launch profile changed (${state.launchProfile.executor}/${state.launchProfile.model} -> ${launchProfile.executor}/${launchProfile.model}). Use restart.`,
      );
    }
  }
  if (flowRequiresTaskScope(flowEntry) && !config.jiraRef) {
    throw new TaskRunnerError("Resume is impossible because Jira context is missing for this flow state. Use restart.");
  }

  const pipelineContext = createPipelineContext({
    issueKey: config.taskKey,
    jiraRef: config.jiraRef,
    dryRun: config.dryRun,
    verbose: config.verbose,
    ...(config.mdLang !== undefined ? { mdLang: config.mdLang } : {}),
    runtime,
    requestUserInput: requestUserInputInTerminal,
  });
  const flowParams = defaultDeclarativeFlowParams(
    config,
    false,
    launchProfile ? { launchProfile } : {},
  );

  for (const phase of flowEntry.flow.phases) {
    const phaseState = state.executionState.phases.find((candidate) => candidate.id === phase.id);
    if (!phaseState) {
      continue;
    }
    validateDeclarativePhaseResumeState(phase, phaseState, pipelineContext, flowParams, flowEntry.flow.constants, state.executionState);
  }
}

function scopeWithRestoredJiraContext(scope: ResolvedScope, state: FlowRunState | null): ResolvedScope {
  if (scope.jiraRef || !state?.jiraRef?.trim()) {
    return scope;
  }
  return resolveProjectScope(null, state.jiraRef);
}

function buildInteractiveBaseConfig(flowId: string, scope: ResolvedScope): BaseConfig {
  return buildBaseConfig(flowId, {
    ...(scope.jiraRef ? { jiraRef: scope.jiraRef } : {}),
  });
}

function lookupInteractiveFlowResume(flowEntry: FlowCatalogEntry, currentScope: ResolvedScope): FlowResumeLookup {
  const directState = loadFlowRunState(currentScope.scopeKey, flowEntry.id);
  if (directState && hasResumableFlowState(directState)) {
    try {
      const effectiveScope = scopeWithRestoredJiraContext(currentScope, directState);
      const baseConfig = buildInteractiveBaseConfig(flowEntry.id, effectiveScope);
      const config = buildRuntimeConfig(baseConfig, effectiveScope);
      validateDeclarativeFlowResumeState(flowEntry, config, directState, directState.launchProfile);
      return {
        resumeAvailable: true,
        hasExistingState: true,
        details: buildFlowResumeDetails(directState),
      };
    } catch (error) {
      return {
        resumeAvailable: false,
        hasExistingState: true,
        details: `Interrupted run found, but resume is unavailable.\n${(error as Error).message}`,
      };
    }
  }
  return {
    resumeAvailable: false,
    hasExistingState: Boolean(directState),
  };
}

function printAutoPhasesHelp(): void {
  const phaseLines = ["Available auto-golang phases:", "", ...autoPhaseIds()];
  phaseLines.push("", "You can resume auto-golang from a phase with:", "agentweaver auto-golang --from <phase> <jira>", "or in interactive mode:", "/auto-golang --from <phase>");
  printPanel("Auto-Golang Phases", phaseLines.join("\n"), "magenta");
}

function autoCommonPhaseIds(): string[] {
  return loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" }).phases.map((phase) => phase.id);
}

function printAutoCommonPhasesHelp(): void {
  const phaseLines = ["Available auto-common phases:", "", ...autoCommonPhaseIds()];
  phaseLines.push("", "You can run auto-common with:", "agentweaver auto-common <jira>");
  printPanel("Auto-Common Phases", phaseLines.join("\n"), "magenta");
}

function nextReviewIterationForTask(taskKey: string): number {
  return nextArtifactIteration(taskKey, "review");
}

function nextDesignReviewIterationForTask(taskKey: string): number {
  return nextArtifactIteration(taskKey, "design-review");
}

function buildBaseConfig(
  command: string,
  options: {
    jiraRef?: string | null;
    scopeName?: string | null;
    reviewFixPoints?: string | null;
    extraPrompt?: string | null;
    autoFromPhase?: string | null;
    mdLang?: "en" | "ru" | null;
    dryRun?: boolean;
    verbose?: boolean;
    doctorArgs?: string[];
  } = {},
): BaseConfig {
  return {
    command,
    jiraRef: options.jiraRef ?? null,
    scopeName: options.scopeName ?? null,
    reviewFixPoints: options.reviewFixPoints ?? null,
    extraPrompt: options.extraPrompt ?? null,
    autoFromPhase: options.autoFromPhase ? validateAutoPhaseId(options.autoFromPhase) : null,
    mdLang: options.mdLang ?? null,
    dryRun: options.dryRun ?? false,
    verbose: options.verbose ?? false,
    ...(options.doctorArgs !== undefined ? { doctorArgs: options.doctorArgs } : {}),
  };
}

function commandRequiresTask(command: string): boolean {
  return (
    command === "plan" ||
    command === "bug-analyze" ||
    command === "bug-fix" ||
    command === "design-review" ||
    command === "mr-description" ||
    command === "auto-golang" ||
    command === "auto-common" ||
    command === "auto-status" ||
    command === "auto-reset"
  );
}

function commandSupportsProjectScope(command: string): boolean {
  return (
    command === "git-commit" ||
    command === "gitlab-diff-review" ||
    command === "gitlab-review" ||
    command === "task-describe" ||
    command === "implement" ||
    command === "review" ||
    command === "review-fix" ||
    command === "review-loop" ||
    command === "run-go-tests-loop" ||
    command === "run-go-linter-loop"
  );
}

async function resolveScopeForCommand(
  config: BaseConfig,
  requestUserInput: UserInputRequester,
): Promise<ResolvedScope> {
  if (config.jiraRef?.trim()) {
    return resolveProjectScope(config.scopeName, config.jiraRef);
  }
  if (commandRequiresTask(config.command)) {
    try {
      const jiraContext = await requestJiraContext(requestUserInput);
      return resolveProjectScope(config.scopeName, jiraContext.jiraRef);
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
  return {
    ...baseConfig,
    scope,
    taskKey: scope.scopeKey,
    jiraRef: scope.jiraRef ?? scope.scopeKey,
    ...(scope.jiraBrowseUrl ? { jiraBrowseUrl: scope.jiraBrowseUrl } : {}),
    ...(scope.jiraApiUrl ? { jiraApiUrl: scope.jiraApiUrl } : {}),
    ...(scope.jiraTaskFile ? { jiraTaskFile: scope.jiraTaskFile } : {}),
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
}

function checkAutoPrerequisites(config: Config): void {
  resolveCmd("codex", "CODEX_BIN");
}

function autoFlowParams(config: Config, forceRefreshSummary = false): Record<string, unknown> {
  return {
    jiraApiUrl: config.jiraApiUrl,
    taskKey: config.taskKey,
    extraPrompt: config.extraPrompt,
    reviewFixPoints: config.reviewFixPoints,
    forceRefresh: forceRefreshSummary,
    mdLang: config.mdLang,
    runGoTestsScript: path.join(agentweaverHome(PACKAGE_ROOT), "run_go_tests.py"),
    runGoLinterScript: path.join(agentweaverHome(PACKAGE_ROOT), "run_go_linter.py"),
    runGoTestsIteration: nextArtifactIteration(config.taskKey, "run-go-tests-result", "json"),
    runGoLinterIteration: nextArtifactIteration(config.taskKey, "run-go-linter-result", "json"),
  };
}

function interactiveFlowDefinition(entry: FlowCatalogEntry): InteractiveFlowDefinition {
  const flow = entry.flow;
  return {
    id: entry.id,
    label: entry.id,
    description: flow.description ?? "No description available for this flow.",
    source: entry.source,
    treePath: [...entry.treePath],
    ...(entry.source === "project-local" ? { sourcePath: entry.absolutePath } : {}),
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

function interactiveFlowDefinitions(catalog: FlowCatalogEntry[]): InteractiveFlowDefinition[] {
  return catalog.map((entry) => interactiveFlowDefinition(entry));
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
  if (forceRefresh) {
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

async function runDeclarativeFlowByRef(
  flowId: string,
  flowRef: DeclarativeFlowRef,
  config: Config,
  flowParams: Record<string, unknown>,
  overrides: DeclarativeFlowOverrides = {},
  requestUserInput: UserInputRequester = requestUserInputInTerminal,
  setSummary?: (markdown: string) => void,
  launchMode: FlowLaunchMode = "restart",
  runtime: RuntimeServices = runtimeServices,
): Promise<void> {
  const context = createPipelineContext({
    issueKey: config.taskKey,
    jiraRef: config.jiraRef,
    dryRun: config.dryRun,
    verbose: config.verbose,
    ...(config.mdLang !== undefined ? { mdLang: config.mdLang } : {}),
    runtime,
    ...(setSummary ? { setSummary } : {}),
    requestUserInput,
  });
  const flow = loadDeclarativeFlow(flowRef);
  const initialExecutionState: FlowExecutionState = {
    flowKind: flow.kind,
    flowVersion: flow.version,
    terminated: false,
    phases: [],
  };
  let persistedState = launchMode === "resume" ? loadFlowRunState(config.scope.scopeKey, flowId) : null;
  if (persistedState && launchMode === "resume") {
    validateDeclarativeFlowResumeState(
      {
        id: flowId,
        source: flow.source,
        fileName: flow.fileName,
        absolutePath: flow.absolutePath,
        treePath: [],
        flow,
      },
      config,
      persistedState,
      overrides.launchProfile,
      runtime,
    );
    persistedState = prepareFlowStateForResume(persistedState);
  } else if (launchMode === "restart") {
    resetFlowRunState(config.scope.scopeKey, flowId);
  }
  const executionState = persistedState?.executionState ?? initialExecutionState;
  const state = persistedState
    ?? createFlowRunState(config.scope.scopeKey, flowId, executionState, config.jiraRef, overrides.launchProfile);
  if (overrides.launchProfile) {
    state.launchProfile = overrides.launchProfile;
  }
  state.status = "running";
  state.lastError = null;
  state.currentStep = findCurrentFlowExecutionStep(state);
  state.executionState = executionState;
  saveFlowRunState(state);
  publishFlowState(flowId, executionState);
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
          publishFlowState(flowId, nextExecutionState);
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

async function runDeclarativeFlowBySpecFile(
  fileName: string,
  config: Config,
  flowParams: Record<string, unknown>,
  overrides: DeclarativeFlowOverrides = {},
  requestUserInput: UserInputRequester = requestUserInputInTerminal,
  setSummary?: (markdown: string) => void,
  launchMode: FlowLaunchMode = "restart",
  runtime: RuntimeServices = runtimeServices,
): Promise<void> {
  const mergedFlowParams = {
    ...defaultDeclarativeFlowParams(config, false, overrides),
    ...flowParams,
  };
  await runDeclarativeFlowByRef(
    config.command,
    { source: "built-in", fileName },
    config,
    mergedFlowParams,
    overrides,
    requestUserInput,
    setSummary,
    launchMode,
    runtime,
  );
}

function defaultDeclarativeFlowParams(
  config: Config,
  forceRefreshSummary = false,
  overrides: DeclarativeFlowOverrides = {},
): Record<string, unknown> {
  const iteration = nextReviewIterationForTask(config.taskKey);
  const latestIteration = latestArtifactIteration(config.taskKey, "review");
  const launchProfile = overrides.launchProfile ?? resolveLaunchProfile({ executor: "default", model: "default" }, DEFAULT_LAUNCH_PROFILE);
  return {
    taskKey: config.taskKey,
    jiraRef: config.jiraRef,
    jiraBrowseUrl: config.jiraBrowseUrl,
    jiraApiUrl: config.jiraApiUrl,
    jiraTaskFile: config.jiraTaskFile,
    scopeKey: config.scope.scopeKey,
    workspaceDir: scopeWorkspaceDir(config.taskKey),
    extraPrompt: config.extraPrompt,
    reviewFixPoints: config.reviewFixPoints,
    mdLang: config.mdLang,
    llmExecutor: launchProfile.executor,
    llmModel: launchProfile.model,
    launchProfile,
    iteration,
    latestIteration,
    taskSummaryIteration: nextArtifactIteration(config.taskKey, "task"),
    designIteration: nextArtifactIteration(config.taskKey, "design"),
    planIteration: nextArtifactIteration(config.taskKey, "plan"),
    qaIteration: nextArtifactIteration(config.taskKey, "qa"),
    ...(latestIteration !== null ? { reviewFixSelectionJsonFile: reviewFixSelectionJsonFile(config.taskKey, latestIteration) } : {}),
    forceRefresh: forceRefreshSummary,
  };
}

const TASK_SCOPE_PARAM_REFS = new Set(["params.jiraApiUrl", "params.jiraBrowseUrl", "params.jiraTaskFile"]);

function valueReferencesTaskScopeParams(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => valueReferencesTaskScopeParams(item));
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  if (
    "ref" in value &&
    typeof (value as { ref?: unknown }).ref === "string" &&
    TASK_SCOPE_PARAM_REFS.has((value as { ref: string }).ref)
  ) {
    return true;
  }
  return Object.values(value).some((item) => valueReferencesTaskScopeParams(item));
}

function flowRequiresTaskScope(entry: FlowCatalogEntry): boolean {
  if (entry.source === "built-in" && isBuiltInCommandFlowId(entry.id)) {
    return commandRequiresTask(entry.id);
  }
  return valueReferencesTaskScopeParams(entry.flow.phases);
}

async function summarizeBuildFailure(output: string): Promise<string> {
  return summarizeBuildFailureViaPipeline(
    createPipelineContext({
      issueKey: "build-failure-summary",
      jiraRef: "build-failure-summary",
      dryRun: false,
      verbose: false,
      mdLang: null,
      runtime: runtimeServices,
      requestUserInput: requestUserInputInTerminal,
    }),
    output,
  );
}

function requireJiraConfig(config: Config): asserts config is Config & { jiraBrowseUrl: string; jiraApiUrl: string; jiraTaskFile: string } {
  if (!config.jiraBrowseUrl || !config.jiraApiUrl || !config.jiraTaskFile) {
    throw new TaskRunnerError(`Command '${config.command}' requires Jira context in the current project scope.`);
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
  launchProfile?: ResolvedLaunchProfile,
  runtime: RuntimeServices = runtimeServices,
): Promise<boolean> {
  if (baseConfig.command === "doctor") {
    const exitCode = await runDoctorCommand(baseConfig.doctorArgs ?? []);
    return exitCode === 0;
  }

  const config = buildRuntimeConfig(baseConfig, resolvedScope ?? (await resolveScopeForCommand(baseConfig, requestUserInput)));
  if (config.command === "auto-golang") {
    requireJiraConfig(config);
    checkAutoPrerequisites(config);
    process.env.JIRA_BROWSE_URL = config.jiraBrowseUrl;
    process.env.JIRA_API_URL = config.jiraApiUrl;
    process.env.JIRA_TASK_FILE = config.jiraTaskFile;

    let effectiveLaunchMode = launchMode;
    let effectiveLaunchProfile = launchProfile;
    if (config.autoFromPhase) {
      const flow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-golang.json" });
      const persistedState = loadFlowRunState(config.scope.scopeKey, "auto-golang");
      if (!persistedState) {
        throw new TaskRunnerError(
          `Cannot restart auto-golang from phase '${config.autoFromPhase}' because persisted flow state was not found.`,
        );
      }
      rewindFlowRunStateToPhase(persistedState, flow.phases, config.autoFromPhase);
      saveFlowRunState(persistedState);
      effectiveLaunchMode = "resume";
      effectiveLaunchProfile ??= persistedState.launchProfile;
      printPanel("Auto-Golang Resume", `Auto-golang pipeline will continue from phase: ${config.autoFromPhase}`, "yellow");
    }

    await runDeclarativeFlowBySpecFile(
      "auto-golang.json",
      config,
      autoFlowParams(config, forceRefreshSummary),
      effectiveLaunchProfile ? { launchProfile: effectiveLaunchProfile } : {},
      requestUserInput,
      setSummary,
      effectiveLaunchMode,
      runtime,
    );
    return false;
  }
  if (config.command === "auto-common") {
    requireJiraConfig(config);
    checkAutoPrerequisites(config);
    process.env.JIRA_BROWSE_URL = config.jiraBrowseUrl;
    process.env.JIRA_API_URL = config.jiraApiUrl;
    process.env.JIRA_TASK_FILE = config.jiraTaskFile;

    await runDeclarativeFlowBySpecFile(
      "auto-common.json",
      config,
      autoFlowParams(config, forceRefreshSummary),
      launchProfile ? { launchProfile } : {},
      requestUserInput,
      setSummary,
      launchMode,
      runtime,
    );
    return false;
  }
  if (config.command === "auto-status") {
    const state = loadFlowRunState(config.scope.scopeKey, "auto-golang");
    if (!state) {
      printPanel("Auto-Golang Status", `No flow state file found for ${config.taskKey}.`, "yellow");
      return false;
    }
    const currentStep = findCurrentFlowExecutionStep(state) ?? state.currentStep ?? "-";
    const phaseOrder = loadDeclarativeFlow({ source: "built-in", fileName: "auto-golang.json" }).phases;
    const lines = [
      `Issue: ${config.taskKey}`,
      `Status: ${state.status}`,
      `Current step: ${currentStep}`,
      `Updated: ${state.updatedAt}`,
    ];
    if (state.launchProfile) {
      lines.push(`Launch profile: ${state.launchProfile.executor} / ${state.launchProfile.model}`);
    }
    if (state.lastError) {
      lines.push(
        `Last error: ${state.lastError.step ?? "-"} (exit ${state.lastError.returnCode ?? "-"}, ${state.lastError.message ?? "-"})`,
      );
    }
    lines.push("");
    for (const phase of phaseOrder) {
      const phaseState = state.executionState.phases.find((candidate) => candidate.id === phase.id);
      lines.push(`[${phaseState?.status ?? "pending"}] ${phase.id}`);
      for (const step of phase.steps) {
        const stepState = phaseState?.steps.find((candidate) => candidate.id === step.id);
        lines.push(`  - [${stepState?.status ?? "pending"}] ${step.id}`);
      }
    }
    if (state.executionState.terminated) {
      lines.push("", `Execution terminated: ${state.executionState.terminationReason ?? "yes"}`);
    }
    printPanel("Auto-Golang Status", lines.join("\n"), "cyan");
    return false;
  }
  if (config.command === "auto-reset") {
    const removed = resetFlowRunState(config.scope.scopeKey, "auto-golang");
    printPanel(
      "Auto-Golang Reset",
      removed ? `State file ${flowStateFile(config.scope.scopeKey, "auto-golang")} removed.` : "No flow state file found.",
      "yellow",
    );
    return false;
  }

  checkPrerequisites(config);
  if (config.jiraBrowseUrl && config.jiraApiUrl && config.jiraTaskFile) {
    process.env.JIRA_BROWSE_URL = config.jiraBrowseUrl ?? "";
    process.env.JIRA_API_URL = config.jiraApiUrl ?? "";
    process.env.JIRA_TASK_FILE = config.jiraTaskFile ?? "";
  } else {
    delete process.env.JIRA_BROWSE_URL;
    delete process.env.JIRA_API_URL;
    delete process.env.JIRA_TASK_FILE;
  }

  if (config.command === "plan") {
    requireJiraConfig(config);
    if (config.verbose) {
      process.stdout.write(`Fetching Jira issue from browse URL: ${config.jiraBrowseUrl}\n`);
      process.stdout.write(`Resolved Jira API URL: ${config.jiraApiUrl}\n`);
      process.stdout.write(`Saving Jira issue JSON to: ${config.jiraTaskFile}\n`);
    }
    await runDeclarativeFlowBySpecFile("plan.json", config, {
      jiraApiUrl: config.jiraApiUrl,
      taskKey: config.taskKey,
      taskSummaryIteration: nextArtifactIteration(config.taskKey, "task"),
      designIteration: nextArtifactIteration(config.taskKey, "design"),
      planIteration: nextArtifactIteration(config.taskKey, "plan"),
      qaIteration: nextArtifactIteration(config.taskKey, "qa"),
      extraPrompt: config.extraPrompt,
      forceRefresh: forceRefreshSummary,
    }, launchProfile ? { launchProfile } : {}, requestUserInput, setSummary, launchMode, runtime);
    return false;
  }

  if (config.command === "bug-analyze") {
    requireJiraConfig(config);
    if (config.verbose) {
      process.stdout.write(`Fetching Jira issue from browse URL: ${config.jiraBrowseUrl}\n`);
      process.stdout.write(`Resolved Jira API URL: ${config.jiraApiUrl}\n`);
      process.stdout.write(`Saving Jira issue JSON to: ${config.jiraTaskFile}\n`);
    }
    await runDeclarativeFlowBySpecFile("bugz/bug-analyze.json", config, {
      jiraApiUrl: config.jiraApiUrl,
      taskKey: config.taskKey,
      taskSummaryIteration: nextArtifactIteration(config.taskKey, "task"),
      bugAnalyzeIteration: nextArtifactIteration(config.taskKey, "bug-analyze"),
      bugFixDesignIteration: nextArtifactIteration(config.taskKey, "bug-fix-design"),
      bugFixPlanIteration: nextArtifactIteration(config.taskKey, "bug-fix-plan"),
      extraPrompt: config.extraPrompt,
      forceRefresh: forceRefreshSummary,
    }, launchProfile ? { launchProfile } : {}, requestUserInput, setSummary, launchMode, runtime);
    return false;
  }

  if (config.command === "design-review") {
    const iteration = nextDesignReviewIterationForTask(config.taskKey);
    const inputContract = resolveDesignReviewInputContract(config.taskKey);
    if (!config.dryRun) {
      clearReadyToMergeFile(config.taskKey);
    }
    await runDeclarativeFlowBySpecFile(
      "design-review.json",
      config,
      {
        taskKey: config.taskKey,
        iteration,
        planningIteration: inputContract.planningIteration,
        designFile: inputContract.designFile,
        designJsonFile: inputContract.designJsonFile,
        planFile: inputContract.planFile,
        planJsonFile: inputContract.planJsonFile,
        hasQaArtifacts: inputContract.hasQaArtifacts,
        qaFilePath: inputContract.qaFilePath,
        qaJsonFilePath: inputContract.qaJsonFilePath,
        qaFile: inputContract.qaFile,
        qaJsonFile: inputContract.qaJsonFile,
        hasJiraTaskFile: inputContract.hasJiraTaskFile,
        jiraTaskFilePath: inputContract.jiraTaskFilePath,
        jiraTaskFile: inputContract.jiraTaskFile,
        hasJiraAttachmentsManifestFile: inputContract.hasJiraAttachmentsManifestFile,
        jiraAttachmentsManifestFilePath: inputContract.jiraAttachmentsManifestFilePath,
        jiraAttachmentsManifestFile: inputContract.jiraAttachmentsManifestFile,
        hasJiraAttachmentsContextFile: inputContract.hasJiraAttachmentsContextFile,
        jiraAttachmentsContextFilePath: inputContract.jiraAttachmentsContextFilePath,
        jiraAttachmentsContextFile: inputContract.jiraAttachmentsContextFile,
        hasPlanningAnswersJsonFile: inputContract.hasPlanningAnswersJsonFile,
        planningAnswersJsonFilePath: inputContract.planningAnswersJsonFilePath,
        planningAnswersJsonFile: inputContract.planningAnswersJsonFile,
        extraPrompt: config.extraPrompt,
      },
      launchProfile ? { launchProfile } : {},
      requestUserInput,
      undefined,
      launchMode,
      runtime,
    );
    if (!config.dryRun) {
      printSummary(
        "Design Review",
        `Artifacts:\n${designReviewFile(config.taskKey, iteration)}\n${designReviewJsonFile(config.taskKey, iteration)}`,
      );
    }
    return false;
  }

  if (config.command === "gitlab-review") {
    const iteration = nextReviewIterationForTask(config.taskKey);
    const gitlabReviewIteration = nextArtifactIteration(config.taskKey, "gitlab-review");
    await runDeclarativeFlowBySpecFile(
      "gitlab/gitlab-review.json",
      config,
      {
        taskKey: config.taskKey,
        iteration,
        gitlabReviewIteration,
        extraPrompt: config.extraPrompt,
        reviewFixSelectionJsonFile: reviewFixSelectionJsonFile(config.taskKey, iteration),
        reviewFixPoints: config.reviewFixPoints,
      },
      launchProfile ? { launchProfile } : {},
      requestUserInput,
      undefined,
      launchMode,
      runtime,
    );
    if (!config.dryRun) {
      printSummary(
        "GitLab Review",
        `Artifacts:\n${gitlabReviewFile(config.taskKey)}\n${gitlabReviewJsonFile(config.taskKey)}\n${reviewFile(config.taskKey, iteration)}\n${reviewJsonFile(config.taskKey, iteration)}\n${reviewAssessmentFile(config.taskKey, iteration)}\n${reviewAssessmentJsonFile(config.taskKey, iteration)}`,
      );
    }
    return false;
  }

  if (config.command === "gitlab-diff-review") {
    const iteration = nextReviewIterationForTask(config.taskKey);
    const gitlabDiffIteration = nextArtifactIteration(config.taskKey, "gitlab-diff");
    await runDeclarativeFlowBySpecFile(
      "gitlab/gitlab-diff-review.json",
      config,
      {
        taskKey: config.taskKey,
        iteration,
        gitlabDiffIteration,
        extraPrompt: config.extraPrompt,
      },
      launchProfile ? { launchProfile } : {},
      requestUserInput,
      undefined,
      launchMode,
      runtime,
    );
    if (!config.dryRun) {
      printSummary(
        "GitLab Diff Review",
        `Artifacts:\n${gitlabDiffFile(config.taskKey)}\n${gitlabDiffJsonFile(config.taskKey)}\n${reviewFile(config.taskKey, iteration)}\n${reviewJsonFile(config.taskKey, iteration)}`,
      );
    }
    return false;
  }

  if (config.command === "bug-fix") {
    requireJiraConfig(config);
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
    await runDeclarativeFlowBySpecFile("bugz/bug-fix.json", config, {
      taskKey: config.taskKey,
      extraPrompt: config.extraPrompt,
    }, launchProfile ? { launchProfile } : {}, requestUserInput, undefined, launchMode, runtime);
    return false;
  }

  if (config.command === "mr-description") {
    requireJiraConfig(config);
    requireJiraTaskFile(config.jiraTaskFile);
    await runDeclarativeFlowBySpecFile("gitlab/mr-description.json", config, {
      taskKey: config.taskKey,
      iteration: nextArtifactIteration(config.taskKey, "mr-description"),
      extraPrompt: config.extraPrompt,
    }, launchProfile ? { launchProfile } : {}, requestUserInput, undefined, launchMode, runtime);
    return false;
  }

  if (config.command === "task-describe") {
    const iteration = nextArtifactIteration(config.taskKey, "jira-description");
    await runDeclarativeFlowBySpecFile("task-describe.json", config, {
      jiraApiUrl: config.jiraApiUrl,
      taskKey: config.taskKey,
      iteration,
      extraPrompt: config.extraPrompt,
    }, launchProfile ? { launchProfile } : {}, requestUserInput, undefined, launchMode, runtime);
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
    }, launchProfile ? { launchProfile } : {}, requestUserInput, undefined, launchMode);
    return false;
  }

  if (config.command === "review") {
    const iteration = nextReviewIterationForTask(config.taskKey);
    if (config.jiraBrowseUrl && config.jiraApiUrl && config.jiraTaskFile) {
      requireJiraConfig(config);
      validateStructuredArtifacts(
        [
          { path: designJsonFile(config.taskKey), schemaId: "implementation-design/v1" },
          { path: planJsonFile(config.taskKey), schemaId: "implementation-plan/v1" },
        ],
        "Review mode requires valid structured plan artifacts from the planning phase.",
      );
      await runDeclarativeFlowBySpecFile("review/review.json", config, {
        taskKey: config.taskKey,
        iteration,
        extraPrompt: config.extraPrompt,
      }, launchProfile ? { launchProfile } : {}, requestUserInput, undefined, launchMode, runtime);
    } else {
      await runDeclarativeFlowBySpecFile("review/review-project.json", config, {
        taskKey: config.taskKey,
        iteration,
        extraPrompt: config.extraPrompt,
      }, launchProfile ? { launchProfile } : {}, requestUserInput, undefined, launchMode, runtime);
    }
    return !config.dryRun && existsSync(readyToMergeFile(config.taskKey));
  }

  if (config.command === "review-fix") {
    const latestIteration = latestArtifactIteration(config.taskKey, "review");
    if (latestIteration === null) {
      throw new TaskRunnerError("Review-fix mode requires at least one review artifact.");
    }
    validateStructuredArtifacts(
      [
        { path: reviewJsonFile(config.taskKey, latestIteration), schemaId: "review-findings/v1" },
      ],
      "Review-fix mode requires valid structured review artifacts.",
    );
    await runDeclarativeFlowBySpecFile("review/review-fix.json", config, {
      taskKey: config.taskKey,
      latestIteration,
      reviewAssessmentJsonFile: null,
      reviewFixSelectionJsonFile: reviewFixSelectionJsonFile(config.taskKey, latestIteration),
      extraPrompt: config.extraPrompt,
      reviewFixPoints: config.reviewFixPoints,
    }, launchProfile ? { launchProfile } : {}, requestUserInput, undefined, launchMode, runtime);
    return false;
  }

  if (config.command === "review-loop") {
    const iteration = nextReviewIterationForTask(config.taskKey);
    if (config.jiraBrowseUrl && config.jiraApiUrl && config.jiraTaskFile) {
      requireJiraConfig(config);
      validateStructuredArtifacts(
        [
          { path: designJsonFile(config.taskKey), schemaId: "implementation-design/v1" },
          { path: planJsonFile(config.taskKey), schemaId: "implementation-plan/v1" },
        ],
        "Review-loop mode requires valid structured plan artifacts from the planning phase.",
      );
    }
    await runDeclarativeFlowBySpecFile("review/review-loop.json", config, {
      taskKey: config.taskKey,
      iteration,
      extraPrompt: config.extraPrompt,
    }, launchProfile ? { launchProfile } : {}, requestUserInput, undefined, launchMode, runtime);
    return !config.dryRun && existsSync(readyToMergeFile(config.taskKey));
  }

  if (config.command === "run-go-tests-loop" || config.command === "run-go-linter-loop") {
    await runDeclarativeFlowBySpecFile(
      config.command === "run-go-tests-loop" ? "go/run-go-tests-loop.json" : "go/run-go-linter-loop.json",
      config,
      {
        taskKey: config.taskKey,
        runGoTestsScript: path.join(agentweaverHome(PACKAGE_ROOT), "run_go_tests.py"),
        runGoLinterScript: path.join(agentweaverHome(PACKAGE_ROOT), "run_go_linter.py"),
        runGoTestsIteration: nextArtifactIteration(config.taskKey, "run-go-tests-result", "json"),
        runGoLinterIteration: nextArtifactIteration(config.taskKey, "run-go-linter-result", "json"),
        extraPrompt: config.extraPrompt,
      },
      launchProfile ? { launchProfile } : {},
      requestUserInput,
      undefined,
      launchMode,
      runtime,
    );
    return false;
  }

  if (config.command === "git-commit") {
    await runDeclarativeFlowBySpecFile(
      "git-commit.json",
      config,
      {
        taskKey: config.taskKey,
        extraPrompt: config.extraPrompt,
      },
      launchProfile ? { launchProfile } : {},
      requestUserInput,
      undefined,
      launchMode,
      runtime,
    );
    return false;
  }

  throw new TaskRunnerError(`Unsupported command: ${config.command}`);
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
  let mdLang: "en" | "ru" | undefined;
  const doctorArgs: string[] = [];

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
    if (token === "--md-lang") {
      const langValue = argv[index + 1];
      if (langValue === "en" || langValue === "ru") {
        mdLang = langValue;
      } else {
        process.stderr.write("Error: --md-lang accepts only 'en' or 'ru' as values.\n");
        process.exit(1);
      }
      index += 1;
      continue;
    }
    if (token.startsWith("--md-lang=")) {
      const langValue = token.slice("--md-lang=".length);
      if (langValue === "en" || langValue === "ru") {
        mdLang = langValue;
      } else {
        process.stderr.write("Error: --md-lang accepts only 'en' or 'ru' as values.\n");
        process.exit(1);
      }
      continue;
    }
    if (command === "doctor") {
      doctorArgs.push(token);
    } else {
      jiraRef = token;
    }
  }

  if (command === "auto-golang" && helpPhases) {
    printAutoPhasesHelp();
    process.exit(0);
  }
  if (command === "auto-common" && helpPhases) {
    printAutoCommonPhasesHelp();
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
    ...(mdLang !== undefined ? { mdLang } : {}),
    ...(doctorArgs.length > 0 ? { doctorArgs } : {}),
  };
}

function buildConfigFromArgs(args: ParsedArgs): BaseConfig {
  return buildBaseConfig(args.command, {
    ...(args.jiraRef !== undefined ? { jiraRef: args.jiraRef } : {}),
    ...(args.scopeName !== undefined ? { scopeName: args.scopeName } : {}),
    ...(args.prompt !== undefined ? { extraPrompt: args.prompt } : {}),
    ...(args.autoFromPhase !== undefined ? { autoFromPhase: args.autoFromPhase } : {}),
    ...(args.mdLang !== undefined ? { mdLang: args.mdLang } : {}),
    dryRun: args.dry,
    verbose: args.verbose,
    ...(args.doctorArgs !== undefined ? { doctorArgs: args.doctorArgs } : {}),
  });
}

async function runInteractive(jiraRef?: string | null, forceRefresh = false, scopeName?: string | null): Promise<number> {
  let currentScope = resolveProjectScope(scopeName, jiraRef);
  const gitBranchName = detectGitBranchName();
  const flowCatalog = loadInteractiveFlowCatalog(process.cwd());
  let activeAbortController: AbortController | null = null;
  let activeFlowId: string | null = null;

  let exiting = false;
  const ui = new InteractiveUi(
    {
      scopeKey: currentScope.scopeKey,
      jiraIssueKey: currentScope.jiraIssueKey ?? null,
      summaryText: "",
      cwd: process.cwd(),
      gitBranchName,
      version: packageVersion(),
      flows: interactiveFlowDefinitions(flowCatalog),
      getRunConfirmation: async (flowId) => {
        const flowEntry = findCatalogEntry(flowId, flowCatalog);
        if (!flowEntry) {
          throw new TaskRunnerError(`Unknown flow: ${flowId}`);
        }
        const resumeLookup = lookupInteractiveFlowResume(flowEntry, currentScope);
        return resumeLookup;
      },
      onRun: async (flowId, launchMode) => {
        const abortController = new AbortController();
        activeAbortController = abortController;
        activeFlowId = flowId;
        try {
          const flowEntry = findCatalogEntry(flowId, flowCatalog);
          if (!flowEntry) {
            throw new TaskRunnerError(`Unknown flow: ${flowId}`);
          }
          const resumeState = launchMode === "resume" ? loadFlowRunState(currentScope.scopeKey, flowId) : null;
          if (resumeState) {
            currentScope = scopeWithRestoredJiraContext(currentScope, resumeState);
          }
          const launchProfile = launchMode === "resume"
            ? resumeState?.launchProfile
            : await requestInteractiveLaunchProfile((form) => ui.requestUserInput(form));
          if (!launchProfile) {
            throw new TaskRunnerError("Resume is impossible because launch profile was not saved. Use restart.");
          }
          const previousScopeKey = currentScope.scopeKey;
          const baseConfig = buildInteractiveBaseConfig(flowId, currentScope);
          if (flowEntry.source === "built-in" && isBuiltInCommandFlowId(flowId)) {
            const nextScope = await resolveScopeForCommand(baseConfig, (form) => ui.requestUserInput(form));
            currentScope = nextScope;
          } else if (flowRequiresTaskScope(flowEntry) && !currentScope.jiraRef) {
            const jiraContext = await requestJiraContext((form) => ui.requestUserInput(form));
            currentScope = resolveProjectScope(null, jiraContext.jiraRef);
          }
          ui.setScope(currentScope.scopeKey, currentScope.jiraIssueKey ?? null);
          if (previousScopeKey !== currentScope.scopeKey || currentScope.jiraIssueKey) {
            syncInteractiveTaskSummary(ui, currentScope, forceRefresh);
          }
          printPanel(
            "Effective Launch Config",
            `executor: ${launchProfile.executor}\nmodel: ${launchProfile.model}\nmode: ${launchMode}`,
            "cyan",
          );
          if (flowEntry.source === "built-in" && isBuiltInCommandFlowId(flowId)) {
            await executeCommand(
              baseConfig,
              true,
              (form) => ui.requestUserInput(form),
              currentScope,
              (markdown) => ui.setSummary(markdown),
              forceRefresh,
              launchMode,
              launchProfile,
              createRuntimeServices(abortController.signal),
            );
            return;
          }

          const runtimeConfig = buildRuntimeConfig(baseConfig, currentScope);
          await runDeclarativeFlowByRef(
            flowId,
            toDeclarativeFlowRef(flowEntry),
            runtimeConfig,
            defaultDeclarativeFlowParams(runtimeConfig, forceRefresh, { launchProfile }),
            { launchProfile },
            (form) => ui.requestUserInput(form),
            (markdown) => ui.setSummary(markdown),
            launchMode,
            createRuntimeServices(abortController.signal),
          );
        } catch (error) {
          if (error instanceof FlowInterruptedError) {
            ui.appendLog(`[interrupt] ${error.message}`);
            printInfo(error.message);
            return;
          }
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
        } finally {
          if (activeAbortController === abortController) {
            activeAbortController = null;
            activeFlowId = null;
          }
        }
      },
      onInterrupt: async (flowId) => {
        if (!activeAbortController || activeFlowId !== flowId) {
          return;
        }
        ui.interruptActiveForm();
        activeAbortController.abort();
      },
      onExit: () => {
        exiting = true;
      },
    },
  );

  ui.mount();
  printInfo(`Interactive mode for ${currentScope.scopeKey}`);
  printInfo("Use h to see help.");
  if (!currentScope.jiraIssueKey) {
    ui.appendLog("[scope] project scope active; task summary will appear after a Jira-backed flow runs");
  }
  syncInteractiveTaskSummary(ui, currentScope, forceRefresh);

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
  loadTieredEnv(process.cwd());

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
    const commandCompleted = await executeCommand(buildConfigFromArgs(parsedArgs));
    if (parsedArgs.command === "doctor") {
      return commandCompleted ? 0 : 1;
    }
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
