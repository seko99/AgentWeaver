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
  gitlabDiffFile,
  gitlabDiffJsonFile,
  ensureScopeWorkspaceDir,
  gitlabReviewFile,
  gitlabReviewJsonFile,
  latestArtifactIteration,
  nextArtifactIteration,
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
import {
  AGENTWEAVER_REVIEW_BLOCKING_SEVERITIES_ENV,
  parseReviewSeverityCsv,
  resolveReviewBlockingSeveritiesFromEnv,
  type ReviewSeverity,
} from "./review-severity.js";
import { summarizeBuildFailure as summarizeBuildFailureViaPipeline } from "./pipeline/build-failure-summary.js";
import { runNodeChecks } from "./pipeline/checks.js";
import { createPipelineContext } from "./pipeline/context.js";
import { collectFlowRoutingGroups, loadDeclarativeFlow, type DeclarativeFlowRef } from "./pipeline/declarative-flows.js";
import { runExpandedPhase } from "./pipeline/declarative-flow-runner.js";
import {
  builtInCommandFlowFile,
  findCatalogEntry,
  flowRoutingGroups,
  isBuiltInCommandFlowId,
  loadInteractiveFlowCatalog,
  toDeclarativeFlowRef,
  type FlowCatalogEntry,
} from "./pipeline/flow-catalog.js";
import {
  EXECUTION_ROUTING_GROUPS,
  type ExecutionRoutingGroup,
  type ResolvedExecutionRouting,
  type SelectedExecutionPreset,
} from "./pipeline/execution-routing-config.js";
import {
  DEFAULT_LAUNCH_PROFILE,
  type LlmExecutorId,
  type ResolvedLaunchProfile,
} from "./pipeline/launch-profile-config.js";
import type { ExpandedPhaseExecutionState, ExpandedPhaseSpec, ExpandedStepSpec, FlowExecutionState } from "./pipeline/spec-types.js";
import type { NodeCheckSpec, PipelineContext } from "./pipeline/types.js";
import { evaluateCondition, resolveValue, type DeclarativeResolverContext } from "./pipeline/value-resolver.js";
import { resolveCmd } from "./runtime/command-resolution.js";
import { loadTieredEnv } from "./runtime/env-loader.js";
import { agentweaverHome } from "./runtime/agentweaver-home.js";
import { runCommand } from "./runtime/process-runner.js";
import { createArtifactRegistry } from "./runtime/artifact-registry.js";
import { resolveDesignReviewInputContract } from "./runtime/design-review-input-contract.js";
import { resolvePlanReviseInputContract } from "./runtime/plan-revise-input-contract.js";
import { resolveLatestPlanningBundle } from "./runtime/planning-bundle.js";
import { inspectReviewInputContract, resolveReviewInputContract } from "./runtime/review-input-contract.js";
import { clearReadyToMergeFile } from "./runtime/ready-to-merge.js";
import {
  describeExecutionRouting,
  executorsForRoutingGroups,
  resolveExecutionRouting,
} from "./runtime/execution-routing.js";
import { requestInteractiveExecutionRouting } from "./runtime/interactive-execution-routing.js";
import { createInteractiveSession } from "./interactive/create-interactive-session.js";
import type { InteractiveSession } from "./interactive/session.js";
import type { InteractiveFlowDefinition } from "./interactive/types.js";
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
import type { UserInputFieldDefinition, UserInputFormDefinition } from "./user-input.js";
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
  "auto-simple",
  "auto-status",
  "auto-reset",
  "bug-analyze",
  "bug-fix",
  "design-review",
  "doctor",
  "git-commit",
  "gitlab-diff-review",
  "gitlab-review",
  "instant-task",
  "mr-description",
  "plan",
  "plan-revise",
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
    artifactRegistry: createArtifactRegistry(),
  };
}

const runtimeServices = createRuntimeServices();

type BaseConfig = {
  command: string;
  jiraRef?: string | null;
  scopeName?: string | null;
  reviewFixPoints?: string | null;
  reviewBlockingSeverities: ReviewSeverity[];
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
  executionRouting?: ResolvedExecutionRouting;
  selectedRoutingPreset?: SelectedExecutionPreset;
};

type ParsedArgs = {
  command: CommandName;
  jiraRef?: string;
  scopeName?: string;
  reviewBlockingSeverities?: ReviewSeverity[];
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
  agentweaver instant-task [--dry] [--verbose] [--prompt <text>] [--md-lang <en|ru>]
  agentweaver mr-description [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  agentweaver plan [--dry] [--verbose] [--prompt <text>] [--md-lang <en|ru>] [<jira-browse-url|jira-issue-key>]
  agentweaver plan-revise [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  agentweaver task-describe [--dry] [--verbose] [--prompt <text>] [<jira-browse-url|jira-issue-key>]
  agentweaver implement [--dry] [--verbose] [--prompt <text>] [--scope <name>] [<jira-browse-url|jira-issue-key>]
  agentweaver review [--dry] [--verbose] [--prompt <text>] [--scope <name>] [--blocking-severities <list>] [<jira-browse-url|jira-issue-key>]
  agentweaver review-fix [--dry] [--verbose] [--prompt <text>] [--scope <name>] [--blocking-severities <list>] [<jira-browse-url|jira-issue-key>]
  agentweaver review-loop [--dry] [--verbose] [--prompt <text>] [--scope <name>] [--blocking-severities <list>] [<jira-browse-url|jira-issue-key>]
  agentweaver run-go-tests-loop [--dry] [--verbose] [--prompt <text>] [--scope <name>] [<jira-browse-url|jira-issue-key>]
  agentweaver run-go-linter-loop [--dry] [--verbose] [--prompt <text>] [--scope <name>] [<jira-browse-url|jira-issue-key>]
  agentweaver auto-golang [--dry] [--verbose] [--prompt <text>] [<jira-browse-url|jira-issue-key>]
  agentweaver auto-golang [--dry] [--verbose] [--prompt <text>] --from <phase> [<jira-browse-url|jira-issue-key>]
  agentweaver auto-golang --help-phases
  agentweaver auto-common [--dry] [--verbose] [--prompt <text>] [--md-lang <en|ru>] <jira-browse-url|jira-issue-key>
  agentweaver auto-common --help-phases
  agentweaver auto-simple [--dry] [--verbose] [--prompt <text>] [--md-lang <en|ru>] <jira-browse-url|jira-issue-key>
  agentweaver auto-simple --help-phases
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
  --scope         Explicit workflow scope name for non-Jira runs except instant-task
  --prompt        Extra prompt text appended to the base prompt
  --blocking-severities  Comma-separated severities that block merge and drive review-fix auto-selection
  --md-lang       Language for markdown output files: en (English) or ru (Russian, default)

Required environment variables:
  JIRA_API_KEY    Jira API token used for Jira-backed flows (Bearer by default, or Basic with Jira Cloud)

Optional environment variables:
  JIRA_USERNAME   Required for Jira Cloud Basic auth (usually Atlassian account email)
  JIRA_AUTH_MODE  Override Jira auth mode: auto | basic | bearer
  JIRA_BASE_URL
  GITLAB_TOKEN
  AGENTWEAVER_HOME
  ${AGENTWEAVER_REVIEW_BLOCKING_SEVERITIES_ENV}
  CODEX_BIN
  CODEX_MODEL
  OPENCODE_BIN
  OPENCODE_MODEL

Notes:
  - Jira-backed task flows will ask for Jira task via user-input when it is not passed as an argument. task-describe can also work from a manual task description without Jira.
  - instant-task always uses the current branch-derived project scope and rejects explicit scope overrides or Jira arguments.
  - All flow state and artifacts are stored in the current project scope by default.
  - gitlab-review and gitlab-diff-review ask for GitLab merge request URL via user-input.
  - ${AGENTWEAVER_REVIEW_BLOCKING_SEVERITIES_ENV} sets the default blocking severities. Default: blocker,critical,high.
  - Interactive mode requires Ink runtime dependencies and a real TTY.`;
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
  if (state.executionRouting) {
    lines.push(`Default route: ${state.executionRouting.defaultRoute.executor} / ${state.executionRouting.defaultRoute.model}`);
    lines.push(`Routing fingerprint: ${state.executionRouting.fingerprint}`);
  } else if (state.launchProfile) {
    lines.push(`Launch profile: ${state.launchProfile.executor} / ${state.launchProfile.model}`);
  }
  if (state.lastError) {
    lines.push(`Last error: ${state.lastError.message ?? "-"} (exit ${state.lastError.returnCode ?? "-"})`);
  }
  return lines.join("\n");
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
  executionRouting?: ResolvedExecutionRouting,
  runtime: RuntimeServices = runtimeServices,
): void {
  if (state.flowId === "auto-common") {
    const persistedPhaseIds = state.executionState.phases.map((p) => p.id);
    const hasLegacyPlanningGatePhases = persistedPhaseIds.some((id) =>
      ["design_review", "verdict", "plan_revision", "design_review_repeat", "verdict_repeat"].includes(id),
    );
    if (hasLegacyPlanningGatePhases) {
      throw new TaskRunnerError(
        "Resume is impossible because the persisted state was created with the legacy phase graph. Use restart.",
      );
    }
  }

  const persistedFingerprint = state.routingFingerprint ?? state.executionRouting?.fingerprint ?? state.launchProfile?.fingerprint;
  if (persistedFingerprint) {
    if (!executionRouting) {
      throw new TaskRunnerError("Resume is impossible because execution routing is missing. Use restart.");
    }
    if (persistedFingerprint !== executionRouting.fingerprint) {
      throw new TaskRunnerError("Resume is impossible because execution routing changed. Use restart.");
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
    ...(executionRouting ? { executionRouting } : {}),
  });
  const flowParams = defaultDeclarativeFlowParams(
    config,
    false,
    executionRouting ? { executionRouting, launchProfile: executionRouting.defaultRoute } : {},
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
    ...(flowId !== "instant-task" && scope.jiraRef ? { jiraRef: scope.jiraRef } : {}),
  });
}

function lookupInteractiveFlowResume(flowEntry: FlowCatalogEntry, currentScope: ResolvedScope): FlowResumeLookup {
  const directState = loadFlowRunState(currentScope.scopeKey, flowEntry.id);
  if (directState && hasResumableFlowState(directState)) {
    try {
      const effectiveScope = scopeWithRestoredJiraContext(currentScope, directState);
      const baseConfig = buildInteractiveBaseConfig(flowEntry.id, effectiveScope);
      const config = buildRuntimeConfig(baseConfig, effectiveScope);
      validateDeclarativeFlowResumeState(flowEntry, config, directState, directState.executionRouting);
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

function autoSimplePhaseIds(): string[] {
  return loadDeclarativeFlow({ source: "built-in", fileName: "auto-simple.json" }).phases.map((phase) => phase.id);
}

function printAutoSimplePhasesHelp(): void {
  const phaseLines = ["Available auto-simple phases:", "", ...autoSimplePhaseIds()];
  phaseLines.push("", "You can run auto-simple with:", "agentweaver auto-simple <jira>");
  printPanel("Auto-Simple Phases", phaseLines.join("\n"), "magenta");
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
    reviewBlockingSeverities?: ReviewSeverity[] | null;
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
    reviewBlockingSeverities: options.reviewBlockingSeverities ?? resolveReviewBlockingSeveritiesFromEnv(),
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
    command === "plan-revise" ||
    command === "bug-analyze" ||
    command === "bug-fix" ||
    command === "design-review" ||
    command === "mr-description" ||
    command === "auto-golang" ||
    command === "auto-common" ||
    command === "auto-simple" ||
    command === "auto-status" ||
    command === "auto-reset"
  );
}

function commandSupportsProjectScope(command: string): boolean {
  return (
    command === "git-commit" ||
    command === "gitlab-diff-review" ||
    command === "gitlab-review" ||
    command === "instant-task" ||
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
  if (config.command === "instant-task") {
    if (config.scopeName?.trim()) {
      throw new TaskRunnerError(
        "Command 'instant-task' rejects explicit scope overrides. The current branch-derived scope is the only supported lineage identity.",
      );
    }
    if (config.jiraRef?.trim()) {
      throw new TaskRunnerError(
        "Command 'instant-task' does not accept a Jira task argument. Start it without a positional Jira reference.",
      );
    }
    return resolveProjectScope();
  }

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

function routingForPrerequisites(
  launchProfile?: ResolvedLaunchProfile,
  executionRouting?: ResolvedExecutionRouting,
): ResolvedExecutionRouting {
  if (executionRouting) {
    return executionRouting;
  }
  return resolveExecutionRouting({
    defaultRoute: launchProfile
      ? {
          executor: launchProfile.executor,
          model: launchProfile.model,
        }
      : {
          executor: DEFAULT_LAUNCH_PROFILE.executor,
          model: DEFAULT_LAUNCH_PROFILE.model,
        },
  });
}

function flowSpecFileForPrerequisiteChecks(command: Config["command"]): string | null {
  return isBuiltInCommandFlowId(command) ? builtInCommandFlowFile(command) : null;
}

function commandRoutingGroupsForPrerequisiteChecks(command: Config["command"], cwd: string): ExecutionRoutingGroup[] {
  const fileName = flowSpecFileForPrerequisiteChecks(command);
  if (!fileName) {
    return [];
  }
  return collectFlowRoutingGroups(loadDeclarativeFlow({ source: "built-in", fileName }), cwd);
}

function resolveExecutorPrerequisite(executor: LlmExecutorId): void {
  if (executor === "codex") {
    resolveCmd("codex", "CODEX_BIN");
    return;
  }
  resolveCmd("opencode", "OPENCODE_BIN");
}

function checkPrerequisites(
  config: Config,
  launchProfile?: ResolvedLaunchProfile,
  executionRouting?: ResolvedExecutionRouting,
): void {
  const routing = routingForPrerequisites(launchProfile, executionRouting);
  const groups = commandRoutingGroupsForPrerequisiteChecks(config.command, process.cwd());
  for (const executor of executorsForRoutingGroups(routing, groups)) {
    resolveExecutorPrerequisite(executor);
  }
}

function checkAutoPrerequisites(
  config: Config,
  launchProfile?: ResolvedLaunchProfile,
  executionRouting?: ResolvedExecutionRouting,
): void {
  checkPrerequisites(config, launchProfile, executionRouting);
}

function autoFlowParams(config: Config, forceRefreshSummary = false): Record<string, unknown> {
  return {
    jiraApiUrl: config.jiraApiUrl,
    taskKey: config.taskKey,
    taskSummaryIteration: nextArtifactIteration(config.taskKey, "task"),
    designIteration: nextArtifactIteration(config.taskKey, "design"),
    planIteration: nextArtifactIteration(config.taskKey, "plan"),
    qaIteration: nextArtifactIteration(config.taskKey, "qa"),
    extraPrompt: config.extraPrompt,
    reviewFixPoints: config.reviewFixPoints,
    reviewBlockingSeverities: config.reviewBlockingSeverities,
    forceRefresh: forceRefreshSummary,
    mdLang: config.mdLang,
    runGoTestsScript: path.join(agentweaverHome(PACKAGE_ROOT), "run_go_tests.py"),
    runGoLinterScript: path.join(agentweaverHome(PACKAGE_ROOT), "run_go_linter.py"),
    runGoTestsIteration: nextArtifactIteration(config.taskKey, "run-go-tests-result", "json"),
    runGoLinterIteration: nextArtifactIteration(config.taskKey, "run-go-linter-result", "json"),
  };
}

function reviewFlowParamsFromContract(config: Config) {
  const contract = resolveReviewInputContract(config.taskKey);
  return {
    taskKey: config.taskKey,
    planningIteration: contract.planningIteration,
    designFile: contract.designFile,
    designJsonFile: contract.designJsonFile,
    planFile: contract.planFile,
    planJsonFile: contract.planJsonFile,
    hasJiraTaskFile: contract.hasJiraTaskFile,
    jiraTaskFilePath: contract.jiraTaskFilePath,
    jiraTaskFile: contract.jiraTaskFile,
    hasTaskInputJsonFile: contract.hasTaskInputJsonFile,
    taskInputJsonFilePath: contract.taskInputJsonFilePath,
    taskInputJsonFile: contract.taskInputJsonFile,
  };
}

function hasStructuredReviewInputs(taskKey: string): boolean {
  const inspection = inspectReviewInputContract(taskKey);
  if (inspection.status === "ready") {
    return true;
  }
  if (inspection.status === "missing-planning") {
    return false;
  }
  throw new TaskRunnerError(
    `Structured review requires either Jira task context or an instant-task input artifact in scope '${taskKey}'.`,
  );
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
  ui: InteractiveSession,
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
    ...(overrides.executionRouting ? { executionRouting: overrides.executionRouting } : {}),
  });
  const flow = loadDeclarativeFlow(flowRef);
  const initialExecutionState: FlowExecutionState = {
    flowKind: flow.kind,
    flowVersion: flow.version,
    terminated: false,
    terminationOutcome: "success",
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
      overrides.executionRouting ?? (overrides.launchProfile ? resolveExecutionRouting({ defaultRoute: {
        executor: overrides.launchProfile.executor,
        model: overrides.launchProfile.model,
      } }) : undefined),
      runtime,
    );
    persistedState = prepareFlowStateForResume(persistedState);
  } else if (launchMode === "restart") {
    resetFlowRunState(config.scope.scopeKey, flowId);
  }
  const executionState = persistedState?.executionState ?? initialExecutionState;
  const state = persistedState
    ?? createFlowRunState(
      config.scope.scopeKey,
      flowId,
      executionState,
      config.jiraRef,
      overrides.launchProfile,
      overrides.executionRouting,
      overrides.selectedRoutingPreset,
    );
  if (overrides.executionRouting) {
    state.executionRouting = overrides.executionRouting;
    state.routingFingerprint = overrides.executionRouting.fingerprint;
    state.launchProfile = overrides.executionRouting.defaultRoute;
  } else if (overrides.launchProfile) {
    state.launchProfile = overrides.launchProfile;
  }
  if (overrides.selectedRoutingPreset) {
    state.selectedRoutingPreset = overrides.selectedRoutingPreset;
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
    if (executionState.terminated) {
      state.status = executionState.terminationOutcome === "success" ? "completed" : "blocked";
    } else {
      state.status = "completed";
    }
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
  const executionRouting = overrides.executionRouting ?? resolveExecutionRouting({
    defaultRoute: overrides.launchProfile
      ? {
          executor: overrides.launchProfile.executor,
          model: overrides.launchProfile.model,
        }
      : {
          executor: DEFAULT_LAUNCH_PROFILE.executor,
          model: DEFAULT_LAUNCH_PROFILE.model,
        },
  });
  const launchProfile = executionRouting.defaultRoute;
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
    reviewBlockingSeverities: config.reviewBlockingSeverities,
    mdLang: config.mdLang,
    llmExecutor: launchProfile.executor,
    llmModel: launchProfile.model,
    launchProfile,
    executionRouting,
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
  executionRouting?: ResolvedExecutionRouting,
  selectedRoutingPreset?: SelectedExecutionPreset,
  runtime: RuntimeServices = runtimeServices,
): Promise<boolean> {
  if (baseConfig.command === "doctor") {
    const exitCode = await runDoctorCommand(baseConfig.doctorArgs ?? []);
    return exitCode === 0;
  }

  const config = buildRuntimeConfig(baseConfig, resolvedScope ?? (await resolveScopeForCommand(baseConfig, requestUserInput)));
  const flowOverrides: DeclarativeFlowOverrides = executionRouting
    ? {
        launchProfile: executionRouting.defaultRoute,
        executionRouting,
        ...(selectedRoutingPreset ? { selectedRoutingPreset } : {}),
      }
    : launchProfile
      ? { launchProfile }
      : {};
  if (config.command === "instant-task") {
    checkPrerequisites(config, launchProfile, executionRouting);
    await runDeclarativeFlowBySpecFile(
      "instant-task.json",
      config,
      {
        taskKey: config.taskKey,
        designIteration: nextArtifactIteration(config.taskKey, "design"),
        planIteration: nextArtifactIteration(config.taskKey, "plan"),
        qaIteration: nextArtifactIteration(config.taskKey, "qa"),
        extraPrompt: config.extraPrompt,
        mdLang: config.mdLang,
      },
      flowOverrides,
      requestUserInput,
      setSummary,
      launchMode,
      runtime,
    );
    return !config.dryRun && existsSync(readyToMergeFile(config.taskKey));
  }
  if (config.command === "auto-golang") {
    requireJiraConfig(config);
    process.env.JIRA_BROWSE_URL = config.jiraBrowseUrl;
    process.env.JIRA_API_URL = config.jiraApiUrl;
    process.env.JIRA_TASK_FILE = config.jiraTaskFile;

    let effectiveLaunchMode = launchMode;
    let effectiveLaunchProfile = launchProfile;
    let effectiveExecutionRouting = executionRouting;
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
      effectiveExecutionRouting ??= persistedState.executionRouting;
      printPanel("Auto-Golang Resume", `Auto-golang pipeline will continue from phase: ${config.autoFromPhase}`, "yellow");
    }
    checkAutoPrerequisites(config, effectiveLaunchProfile, effectiveExecutionRouting);

    await runDeclarativeFlowBySpecFile(
      "auto-golang.json",
      config,
      autoFlowParams(config, forceRefreshSummary),
      effectiveExecutionRouting
        ? {
            launchProfile: effectiveExecutionRouting.defaultRoute,
            executionRouting: effectiveExecutionRouting,
            ...(selectedRoutingPreset ? { selectedRoutingPreset } : {}),
          }
        : effectiveLaunchProfile
          ? { launchProfile: effectiveLaunchProfile }
          : {},
      requestUserInput,
      setSummary,
      effectiveLaunchMode,
      runtime,
    );
    return false;
  }
  if (config.command === "auto-common") {
    requireJiraConfig(config);
    checkAutoPrerequisites(config, launchProfile, executionRouting);
    process.env.JIRA_BROWSE_URL = config.jiraBrowseUrl;
    process.env.JIRA_API_URL = config.jiraApiUrl;
    process.env.JIRA_TASK_FILE = config.jiraTaskFile;

    await runDeclarativeFlowBySpecFile(
      "auto-common.json",
      config,
      autoFlowParams(config, forceRefreshSummary),
      flowOverrides,
      requestUserInput,
      setSummary,
      launchMode,
      runtime,
    );
    return false;
  }
  if (config.command === "auto-simple") {
    requireJiraConfig(config);
    checkAutoPrerequisites(config, launchProfile, executionRouting);
    process.env.JIRA_BROWSE_URL = config.jiraBrowseUrl;
    process.env.JIRA_API_URL = config.jiraApiUrl;
    process.env.JIRA_TASK_FILE = config.jiraTaskFile;

    await runDeclarativeFlowBySpecFile(
      "auto-simple.json",
      config,
      autoFlowParams(config, forceRefreshSummary),
      flowOverrides,
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
    if (state.executionRouting) {
      lines.push(`Default route: ${state.executionRouting.defaultRoute.executor} / ${state.executionRouting.defaultRoute.model}`);
      lines.push(`Routing fingerprint: ${state.executionRouting.fingerprint}`);
    } else if (state.launchProfile) {
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

  checkPrerequisites(config, launchProfile, executionRouting);
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
    }, flowOverrides, requestUserInput, setSummary, launchMode, runtime);
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
    }, flowOverrides, requestUserInput, setSummary, launchMode, runtime);
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
        hasTaskInputJsonFile: inputContract.hasTaskInputJsonFile,
        taskInputJsonFilePath: inputContract.taskInputJsonFilePath,
        taskInputJsonFile: inputContract.taskInputJsonFile,
        extraPrompt: config.extraPrompt,
      },
      flowOverrides,
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

  if (config.command === "plan-revise") {
    const inputContract = resolvePlanReviseInputContract(config.taskKey);
    if (!config.dryRun) {
      clearReadyToMergeFile(config.taskKey);
    }
    await runDeclarativeFlowBySpecFile(
      "plan-revise.json",
      config,
      {
        taskKey: config.taskKey,
        reviewIteration: inputContract.reviewIteration,
        reviewFile: inputContract.reviewFile,
        reviewJsonFile: inputContract.reviewJsonFile,
        sourcePlanningIteration: inputContract.sourcePlanningIteration,
        outputIteration: inputContract.outputIteration,
        designFile: inputContract.designFile,
        designJsonFile: inputContract.designJsonFile,
        planFile: inputContract.planFile,
        planJsonFile: inputContract.planJsonFile,
        hasQaArtifacts: inputContract.hasQaArtifacts,
        qaFilePath: inputContract.qaFilePath,
        qaJsonFilePath: inputContract.qaJsonFilePath,
        qaFile: inputContract.qaFile,
        qaJsonFile: inputContract.qaJsonFile,
        revisedDesignFile: inputContract.revisedDesignFile,
        revisedDesignJsonFile: inputContract.revisedDesignJsonFile,
        revisedPlanFile: inputContract.revisedPlanFile,
        revisedPlanJsonFile: inputContract.revisedPlanJsonFile,
        revisedQaFile: inputContract.revisedQaFile,
        revisedQaJsonFile: inputContract.revisedQaJsonFile,
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
        hasTaskInputJsonFile: inputContract.hasTaskInputJsonFile,
        taskInputJsonFilePath: inputContract.taskInputJsonFilePath,
        taskInputJsonFile: inputContract.taskInputJsonFile,
        extraPrompt: config.extraPrompt,
      },
      flowOverrides,
      requestUserInput,
      undefined,
      launchMode,
      runtime,
    );
    if (!config.dryRun) {
      printSummary(
        "Plan Revise",
        `Artifacts:\n${inputContract.revisedDesignFile}\n${inputContract.revisedDesignJsonFile}\n${inputContract.revisedPlanFile}\n${inputContract.revisedPlanJsonFile}\n${inputContract.revisedQaFile}\n${inputContract.revisedQaJsonFile}`,
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
      flowOverrides,
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
      flowOverrides,
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
    }, flowOverrides, requestUserInput, undefined, launchMode, runtime);
    return false;
  }

  if (config.command === "mr-description") {
    requireJiraConfig(config);
    requireJiraTaskFile(config.jiraTaskFile);
    await runDeclarativeFlowBySpecFile("gitlab/mr-description.json", config, {
      taskKey: config.taskKey,
      iteration: nextArtifactIteration(config.taskKey, "mr-description"),
      extraPrompt: config.extraPrompt,
    }, flowOverrides, requestUserInput, undefined, launchMode, runtime);
    return false;
  }

  if (config.command === "task-describe") {
    const iteration = nextArtifactIteration(config.taskKey, "jira-description");
    await runDeclarativeFlowBySpecFile("task-describe.json", config, {
      jiraApiUrl: config.jiraApiUrl,
      taskKey: config.taskKey,
      iteration,
      extraPrompt: config.extraPrompt,
    }, flowOverrides, requestUserInput, undefined, launchMode, runtime);
    return false;
  }

  if (config.command === "implement") {
    const planningBundle = resolveLatestPlanningBundle(config.taskKey);
    await runDeclarativeFlowBySpecFile("implement.json", config, {
      taskKey: config.taskKey,
      planningIteration: planningBundle.planningIteration,
      extraPrompt: config.extraPrompt,
    }, flowOverrides, requestUserInput, undefined, launchMode);
    return false;
  }

  if (config.command === "review") {
    const iteration = nextReviewIterationForTask(config.taskKey);
    if (hasStructuredReviewInputs(config.taskKey)) {
      await runDeclarativeFlowBySpecFile("review/review.json", config, {
        ...reviewFlowParamsFromContract(config),
        iteration,
        extraPrompt: config.extraPrompt,
      }, flowOverrides, requestUserInput, undefined, launchMode, runtime);
    } else {
      await runDeclarativeFlowBySpecFile("review/review-project.json", config, {
        taskKey: config.taskKey,
        iteration,
        extraPrompt: config.extraPrompt,
      }, flowOverrides, requestUserInput, undefined, launchMode, runtime);
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
    }, flowOverrides, requestUserInput, undefined, launchMode, runtime);
    return false;
  }

  if (config.command === "review-loop") {
    const iteration = nextReviewIterationForTask(config.taskKey);
    const reviewLoopSpec = hasStructuredReviewInputs(config.taskKey)
      ? "review/review-loop.json"
      : "review/review-project-loop.json";
    await runDeclarativeFlowBySpecFile(reviewLoopSpec, config, {
      ...(reviewLoopSpec === "review/review-loop.json"
        ? reviewFlowParamsFromContract(config)
        : { taskKey: config.taskKey }),
      iteration,
      extraPrompt: config.extraPrompt,
    }, flowOverrides, requestUserInput, undefined, launchMode, runtime);
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
      flowOverrides,
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
      flowOverrides,
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
  let reviewBlockingSeverities: ReviewSeverity[] | undefined;
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
    if (token === "--blocking-severities") {
      reviewBlockingSeverities = parseReviewSeverityCsv(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (token.startsWith("--blocking-severities=")) {
      reviewBlockingSeverities = parseReviewSeverityCsv(token.slice("--blocking-severities=".length));
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
  if (command === "auto-simple" && helpPhases) {
    printAutoSimplePhasesHelp();
    process.exit(0);
  }

  return {
    command: command as CommandName,
    dry,
    verbose,
    helpPhases,
    ...(jiraRef !== undefined ? { jiraRef } : {}),
    ...(scopeName !== undefined ? { scopeName } : {}),
    ...(reviewBlockingSeverities !== undefined ? { reviewBlockingSeverities } : {}),
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
    ...(args.reviewBlockingSeverities !== undefined ? { reviewBlockingSeverities: args.reviewBlockingSeverities } : {}),
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
  const ui = createInteractiveSession(
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
          const routingGroups = flowRoutingGroups(flowEntry, process.cwd());
          const resumeState = launchMode === "resume" ? loadFlowRunState(currentScope.scopeKey, flowId) : null;
          if (resumeState) {
            currentScope = scopeWithRestoredJiraContext(currentScope, resumeState);
          }
          const routingSelection = launchMode === "resume"
            ? (resumeState?.executionRouting
                ? {
                    routing: resumeState.executionRouting,
                    selectedPreset: resumeState.selectedRoutingPreset ?? { kind: "custom", label: "Saved routing" } as const,
                  }
                : null)
            : await requestInteractiveExecutionRouting(flowEntry, (form) => ui.requestUserInput(form));
          if (launchMode === "resume" && !routingSelection?.routing) {
            throw new TaskRunnerError("Resume is impossible because execution routing was not saved. Use restart.");
          }
          const launchProfile = routingSelection?.routing?.defaultRoute;
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
          if (routingSelection?.routing) {
            printPanel(
              "Effective Launch Config",
              `preset: ${routingSelection.selectedPreset.label}\nmode: ${launchMode}\n${describeExecutionRouting(
                routingSelection.routing,
                routingGroups,
              )}`,
              "cyan",
            );
          }
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
              routingSelection?.routing,
              routingSelection?.selectedPreset,
              createRuntimeServices(abortController.signal),
            );
            return;
          }

          const runtimeConfig = buildRuntimeConfig(baseConfig, currentScope);
          const flowOverrides = {
            ...(launchProfile ? { launchProfile } : {}),
            ...(routingSelection?.routing ? { executionRouting: routingSelection.routing } : {}),
            ...(routingSelection?.selectedPreset ? { selectedRoutingPreset: routingSelection.selectedPreset } : {}),
          };
          await runDeclarativeFlowByRef(
            flowId,
            toDeclarativeFlowRef(flowEntry),
            runtimeConfig,
            defaultDeclarativeFlowParams(runtimeConfig, forceRefresh, flowOverrides),
            flowOverrides,
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
