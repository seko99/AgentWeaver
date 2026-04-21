import { buildFailureSummaryNode } from "./nodes/build-failure-summary-node.js";
import { buildReviewFixPromptNode } from "./nodes/build-review-fix-prompt-node.js";
import { clearReadyToMergeNode } from "./nodes/clear-ready-to-merge-node.js";
import { codexPromptNode } from "./nodes/codex-prompt-node.js";
import { commandCheckNode } from "./nodes/command-check-node.js";
import { commitMessageFormNode } from "./nodes/commit-message-form-node.js";
import { designReviewVerdictNode } from "./nodes/design-review-verdict-node.js";
import { ensureSummaryJsonNode } from "./nodes/ensure-summary-json-node.js";
import { fetchGitLabDiffNode } from "./nodes/fetch-gitlab-diff-node.js";
import { fetchGitLabReviewNode } from "./nodes/fetch-gitlab-review-node.js";
import { fileCheckNode } from "./nodes/file-check-node.js";
import { flowRunNode } from "./nodes/flow-run-node.js";
import { gitCommitFormNode } from "./nodes/git-commit-form-node.js";
import { gitCommitNode } from "./nodes/git-commit-node.js";
import { gitStatusNode } from "./nodes/git-status-node.js";
import { gitlabReviewArtifactsNode } from "./nodes/gitlab-review-artifacts-node.js";
import { jiraFetchNode } from "./nodes/jira-fetch-node.js";
import { jiraContextNode } from "./nodes/jira-context-node.js";
import { jiraIssueCheckNode } from "./nodes/jira-issue-check-node.js";
import { localScriptCheckNode } from "./nodes/local-script-check-node.js";
import { llmPromptNode } from "./nodes/llm-prompt-node.js";
import { opencodePromptNode } from "./nodes/opencode-prompt-node.js";
import { planCodexNode } from "./nodes/plan-codex-node.js";
import { planningBundleNode } from "./nodes/planning-bundle-node.js";
import { planningQuestionsFormNode } from "./nodes/planning-questions-form-node.js";
import { readFileNode } from "./nodes/read-file-node.js";
import { reviewFindingsFormNode } from "./nodes/review-findings-form-node.js";
import { reviewVerdictNode } from "./nodes/review-verdict-node.js";
import { selectFilesFormNode } from "./nodes/select-files-form-node.js";
import { structuredSummaryNode } from "./nodes/structured-summary-node.js";
import { summaryFileLoadNode } from "./nodes/summary-file-load-node.js";
import { telegramNotifierNode } from "./nodes/telegram-notifier-node.js";
import { userInputNode } from "./nodes/user-input-node.js";
import { writeSelectionFileNode } from "./nodes/write-selection-file-node.js";
import { TaskRunnerError } from "../errors.js";
import type { NodeContractMetadata } from "./node-contract.js";
import type { NormalizedPluginNodeRegistration, PluginOwner } from "./plugin-types.js";
import type { PipelineNodeDefinition } from "./types.js";

export type BuiltInNodeKind =
  | "build-failure-summary"
  | "build-review-fix-prompt"
  | "clear-ready-to-merge"
  | "codex-prompt"
  | "command-check"
  | "commit-message-form"
  | "design-review-verdict"
  | "ensure-summary-json"
  | "fetch-gitlab-diff"
  | "fetch-gitlab-review"
  | "file-check"
  | "flow-run"
  | "git-commit"
  | "git-commit-form"
  | "git-status"
  | "gitlab-review-artifacts"
  | "jira-context"
  | "jira-fetch"
  | "jira-issue-check"
  | "local-script-check"
  | "llm-prompt"
  | "opencode-prompt"
  | "plan-codex"
  | "planning-bundle"
  | "planning-questions-form"
  | "read-file"
  | "review-findings-form"
  | "review-verdict"
  | "select-files-form"
  | "structured-summary"
  | "summary-file-load"
  | "telegram-notify"
  | "user-input"
  | "write-selection-file";

export type NodeKind = string;

type AnyNodeDefinition = PipelineNodeDefinition<Record<string, unknown>, unknown>;

export type NodeRegistry = {
  get: <TParams, TResult>(kind: string) => PipelineNodeDefinition<TParams, TResult>;
  getMeta: (kind: string) => NodeContractMetadata;
  has: (kind: string) => boolean;
  kinds: () => string[];
};

export const BUILT_IN_NODE_KINDS = [
  "build-failure-summary",
  "build-review-fix-prompt",
  "clear-ready-to-merge",
  "codex-prompt",
  "command-check",
  "commit-message-form",
  "design-review-verdict",
  "ensure-summary-json",
  "fetch-gitlab-diff",
  "fetch-gitlab-review",
  "file-check",
  "flow-run",
  "git-commit",
  "git-commit-form",
  "git-status",
  "gitlab-review-artifacts",
  "jira-context",
  "jira-fetch",
  "jira-issue-check",
  "local-script-check",
  "llm-prompt",
  "opencode-prompt",
  "plan-codex",
  "planning-bundle",
  "planning-questions-form",
  "read-file",
  "review-findings-form",
  "review-verdict",
  "select-files-form",
  "structured-summary",
  "summary-file-load",
  "telegram-notify",
  "user-input",
  "write-selection-file",
] as const satisfies readonly BuiltInNodeKind[];

const builtInNodes: Record<BuiltInNodeKind, AnyNodeDefinition> = {
  "build-failure-summary": buildFailureSummaryNode as unknown as AnyNodeDefinition,
  "build-review-fix-prompt": buildReviewFixPromptNode as unknown as AnyNodeDefinition,
  "clear-ready-to-merge": clearReadyToMergeNode as unknown as AnyNodeDefinition,
  "codex-prompt": codexPromptNode as unknown as AnyNodeDefinition,
  "command-check": commandCheckNode as unknown as AnyNodeDefinition,
  "commit-message-form": commitMessageFormNode as unknown as AnyNodeDefinition,
  "design-review-verdict": designReviewVerdictNode as unknown as AnyNodeDefinition,
  "ensure-summary-json": ensureSummaryJsonNode as unknown as AnyNodeDefinition,
  "fetch-gitlab-diff": fetchGitLabDiffNode as unknown as AnyNodeDefinition,
  "fetch-gitlab-review": fetchGitLabReviewNode as unknown as AnyNodeDefinition,
  "file-check": fileCheckNode as unknown as AnyNodeDefinition,
  "flow-run": flowRunNode as unknown as AnyNodeDefinition,
  "git-commit": gitCommitNode as unknown as AnyNodeDefinition,
  "git-commit-form": gitCommitFormNode as unknown as AnyNodeDefinition,
  "git-status": gitStatusNode as unknown as AnyNodeDefinition,
  "gitlab-review-artifacts": gitlabReviewArtifactsNode as unknown as AnyNodeDefinition,
  "jira-context": jiraContextNode as unknown as AnyNodeDefinition,
  "jira-fetch": jiraFetchNode as unknown as AnyNodeDefinition,
  "jira-issue-check": jiraIssueCheckNode as unknown as AnyNodeDefinition,
  "local-script-check": localScriptCheckNode as unknown as AnyNodeDefinition,
  "llm-prompt": llmPromptNode as unknown as AnyNodeDefinition,
  "opencode-prompt": opencodePromptNode as unknown as AnyNodeDefinition,
  "plan-codex": planCodexNode as unknown as AnyNodeDefinition,
  "planning-bundle": planningBundleNode as unknown as AnyNodeDefinition,
  "planning-questions-form": planningQuestionsFormNode as unknown as AnyNodeDefinition,
  "read-file": readFileNode as unknown as AnyNodeDefinition,
  "review-findings-form": reviewFindingsFormNode as unknown as AnyNodeDefinition,
  "review-verdict": reviewVerdictNode as unknown as AnyNodeDefinition,
  "select-files-form": selectFilesFormNode as unknown as AnyNodeDefinition,
  "structured-summary": structuredSummaryNode as unknown as AnyNodeDefinition,
  "summary-file-load": summaryFileLoadNode as unknown as AnyNodeDefinition,
  "telegram-notify": telegramNotifierNode as unknown as AnyNodeDefinition,
  "user-input": userInputNode as unknown as AnyNodeDefinition,
  "write-selection-file": writeSelectionFileNode as unknown as AnyNodeDefinition,
};

const builtInNodeMetadata: Record<BuiltInNodeKind, NodeContractMetadata> = {
  "build-failure-summary": {
    kind: "build-failure-summary",
    version: 1,
    prompt: "forbidden",
    requiredParams: ["output"],
    executors: ["codex"],
  },
  "build-review-fix-prompt": {
    kind: "build-review-fix-prompt",
    version: 1,
    prompt: "forbidden",
    requiredParams: ["selectionFile", "autoMode"],
  },
  "clear-ready-to-merge": {
    kind: "clear-ready-to-merge",
    version: 1,
    prompt: "forbidden",
    requiredParams: ["taskKey"],
  },
  "codex-prompt": {
    kind: "codex-prompt",
    version: 1,
    prompt: "required",
    requiredParams: ["labelText"],
    executors: ["codex"],
  },
  "command-check": {
    kind: "command-check",
    version: 1,
    prompt: "forbidden",
    requiredParams: ["commands"],
    executors: ["command-check"],
  },
  "commit-message-form": {
    kind: "commit-message-form",
    version: 1,
    prompt: "forbidden",
    requiredParams: ["commitMessageFile", "formId", "title", "outputFile"],
  },
  "design-review-verdict": {
    kind: "design-review-verdict",
    version: 1,
    prompt: "forbidden",
    requiredParams: ["taskKey"],
  },
  "ensure-summary-json": {
    kind: "ensure-summary-json",
    version: 1,
    prompt: "forbidden",
    requiredParams: ["markdownFile", "outputFile"],
  },
  "fetch-gitlab-diff": {
    kind: "fetch-gitlab-diff",
    version: 1,
    prompt: "forbidden",
    requiredParams: ["mergeRequestUrl", "outputFile", "outputJsonFile"],
    executors: ["fetch-gitlab-diff"],
  },
  "fetch-gitlab-review": {
    kind: "fetch-gitlab-review",
    version: 1,
    prompt: "forbidden",
    requiredParams: ["mergeRequestUrl", "outputFile", "outputJsonFile"],
    executors: ["fetch-gitlab-review"],
  },
  "file-check": { kind: "file-check", version: 1, prompt: "forbidden", requiredParams: ["path"] },
  "flow-run": {
    kind: "flow-run",
    version: 1,
    prompt: "forbidden",
    requiredParams: ["fileName"],
    nestedFlowParam: "fileName",
  },
  "gitlab-review-artifacts": {
    kind: "gitlab-review-artifacts",
    version: 1,
    prompt: "forbidden",
    requiredParams: ["gitlabReviewJsonFile", "reviewFile", "reviewJsonFile"],
  },
  "git-commit": { kind: "git-commit", version: 1, prompt: "forbidden", requiredParams: ["message", "files"], executors: ["git-commit"] },
  "git-commit-form": {
    kind: "git-commit-form",
    version: 1,
    prompt: "forbidden",
    requiredParams: ["gitStatusJsonFile", "commitMessageFile", "formId", "title", "outputFile"],
  },
  "git-status": { kind: "git-status", version: 1, prompt: "forbidden", requiredParams: ["outputFile"] },
  "jira-context": {
    kind: "jira-context",
    version: 1,
    prompt: "forbidden",
    requiredParams: ["jiraRef"],
  },
  "jira-fetch": {
    kind: "jira-fetch",
    version: 1,
    prompt: "forbidden",
    requiredParams: ["jiraApiUrl", "outputFile"],
    executors: ["jira-fetch"],
  },
  "jira-issue-check": {
    kind: "jira-issue-check",
    version: 1,
    prompt: "forbidden",
    requiredParams: ["jiraTaskFile", "allowedIssueTypes"],
  },
  "local-script-check": { kind: "local-script-check", version: 1, prompt: "forbidden", requiredParams: ["argv", "labelText"] },
  "llm-prompt": {
    kind: "llm-prompt",
    version: 1,
    prompt: "required",
    requiredParams: ["labelText"],
    executors: ["codex", "opencode"],
  },
  "opencode-prompt": { kind: "opencode-prompt", version: 1, prompt: "required", requiredParams: ["labelText"] },
  "plan-codex": {
    kind: "plan-codex",
    version: 1,
    prompt: "forbidden",
    requiredParams: ["prompt", "requiredArtifacts"],
    executors: ["codex"],
  },
  "planning-bundle": {
    kind: "planning-bundle",
    version: 1,
    prompt: "forbidden",
    requiredParams: ["taskKey"],
  },
  "planning-questions-form": {
    kind: "planning-questions-form",
    version: 1,
    prompt: "forbidden",
    requiredParams: ["planningQuestionsJsonFile", "formId", "title"],
  },
  "read-file": { kind: "read-file", version: 1, prompt: "forbidden", requiredParams: ["path"] },
  "review-findings-form": {
    kind: "review-findings-form",
    version: 1,
    prompt: "forbidden",
    requiredParams: ["reviewFindingsJsonFile", "formId", "title"],
  },
  "review-verdict": {
    kind: "review-verdict",
    version: 1,
    prompt: "forbidden",
    requiredParams: ["taskKey"],
  },
  "select-files-form": {
    kind: "select-files-form",
    version: 1,
    prompt: "forbidden",
    requiredParams: ["gitStatusJsonFile", "formId", "title", "outputFile"],
  },
  "structured-summary": {
    kind: "structured-summary",
    version: 1,
    prompt: "forbidden",
    requiredParams: ["path"],
  },
  "summary-file-load": { kind: "summary-file-load", version: 1, prompt: "forbidden", requiredParams: ["path"] },
  "telegram-notify": {
    kind: "telegram-notify",
    version: 1,
    prompt: "forbidden",
    requiredParams: ["message"],
    executors: ["telegram-notifier"],
  },
  "user-input": {
    kind: "user-input",
    version: 1,
    prompt: "forbidden",
    requiredParams: ["formId", "title", "fields", "outputFile"],
  },
  "write-selection-file": {
    kind: "write-selection-file",
    version: 1,
    prompt: "forbidden",
    requiredParams: ["outputFile", "reviewFindingsJsonFile", "selectionMode"],
  },
};

function coreOwner(id: string): PluginOwner {
  return {
    kind: "core",
    id: `core:${id}`,
    manifestPath: "built-in node registry",
  };
}

export function createNodeRegistry(
  pluginNodes: readonly NormalizedPluginNodeRegistration[] = [],
): NodeRegistry {
  const definitions = new Map<string, AnyNodeDefinition>(Object.entries(builtInNodes));
  const metadata = new Map<string, NodeContractMetadata>(Object.entries(builtInNodeMetadata));
  const owners = new Map<string, PluginOwner>(
    Object.keys(builtInNodes).map((id) => [id, coreOwner(id)]),
  );
  for (const registration of pluginNodes) {
    const existingOwner = owners.get(registration.id);
    if (existingOwner) {
      throw new TaskRunnerError(
        `Duplicate node id '${registration.id}' conflicts between ${existingOwner.id} (${existingOwner.manifestPath}) and plugin '${registration.pluginId}' (${registration.manifestPath}).`,
      );
    }
    definitions.set(registration.id, registration.definition as AnyNodeDefinition);
    metadata.set(registration.id, registration.metadata);
    owners.set(registration.id, {
      kind: "plugin",
      id: registration.pluginId,
      manifestPath: registration.manifestPath,
      entrypointPath: registration.entrypointPath,
    });
  }
  return {
    get<TParams, TResult>(kind: string) {
      const definition = definitions.get(kind);
      if (!definition) {
        throw new TaskRunnerError(`Unknown node kind '${kind}'.`);
      }
      return definition as unknown as PipelineNodeDefinition<TParams, TResult>;
    },
    getMeta(kind: string) {
      const definition = metadata.get(kind);
      if (!definition) {
        throw new TaskRunnerError(`Unknown node metadata '${kind}'.`);
      }
      return definition;
    },
    has(kind: string) {
      return definitions.has(kind);
    },
    kinds() {
      return [...definitions.keys()];
    },
  };
}
