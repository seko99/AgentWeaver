import { buildFailureSummaryNode } from "./nodes/build-failure-summary-node.js";
import { codexPromptNode } from "./nodes/codex-prompt-node.js";
import { commandCheckNode } from "./nodes/command-check-node.js";
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
import { planningQuestionsFormNode } from "./nodes/planning-questions-form-node.js";
import { reviewFindingsFormNode } from "./nodes/review-findings-form-node.js";
import { summaryFileLoadNode } from "./nodes/summary-file-load-node.js";
import { userInputNode } from "./nodes/user-input-node.js";
import type { ExecutorId } from "./registry.js";
import type { PipelineNodeDefinition } from "./types.js";

export type NodeKind =
  | "build-failure-summary"
  | "codex-prompt"
  | "command-check"
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
  | "planning-questions-form"
  | "review-findings-form"
  | "summary-file-load"
  | "user-input";

type AnyNodeDefinition = PipelineNodeDefinition<Record<string, unknown>, unknown>;

export type NodeRegistry = {
  get: <TParams, TResult>(kind: NodeKind) => PipelineNodeDefinition<TParams, TResult>;
  getMeta: (kind: NodeKind) => NodeContractMetadata;
  has: (kind: string) => kind is NodeKind;
  kinds: () => NodeKind[];
};

export type NodeContractMetadata = {
  kind: NodeKind;
  version: number;
  prompt: "required" | "allowed" | "forbidden";
  requiredParams?: string[];
  executors?: ExecutorId[];
  nestedFlowParam?: string;
};

const builtInNodes: Record<NodeKind, AnyNodeDefinition> = {
  "build-failure-summary": buildFailureSummaryNode as unknown as AnyNodeDefinition,
  "codex-prompt": codexPromptNode as unknown as AnyNodeDefinition,
  "command-check": commandCheckNode as unknown as AnyNodeDefinition,
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
  "planning-questions-form": planningQuestionsFormNode as unknown as AnyNodeDefinition,
  "review-findings-form": reviewFindingsFormNode as unknown as AnyNodeDefinition,
  "summary-file-load": summaryFileLoadNode as unknown as AnyNodeDefinition,
  "user-input": userInputNode as unknown as AnyNodeDefinition,
};

const builtInNodeMetadata: Record<NodeKind, NodeContractMetadata> = {
  "build-failure-summary": {
    kind: "build-failure-summary",
    version: 1,
    prompt: "forbidden",
    requiredParams: ["output"],
    executors: ["codex"],
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
    requiredParams: ["labelText", "executor"],
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
  "planning-questions-form": {
    kind: "planning-questions-form",
    version: 1,
    prompt: "forbidden",
    requiredParams: ["planningQuestionsJsonFile", "formId", "title"],
  },
  "review-findings-form": {
    kind: "review-findings-form",
    version: 1,
    prompt: "forbidden",
    requiredParams: ["reviewFindingsJsonFile", "formId", "title"],
  },
  "summary-file-load": { kind: "summary-file-load", version: 1, prompt: "forbidden", requiredParams: ["path"] },
  "user-input": {
    kind: "user-input",
    version: 1,
    prompt: "forbidden",
    requiredParams: ["formId", "title", "fields", "outputFile"],
  },
};

export function createNodeRegistry(): NodeRegistry {
  return {
    get<TParams, TResult>(kind: NodeKind) {
      return builtInNodes[kind] as unknown as PipelineNodeDefinition<TParams, TResult>;
    },
    getMeta(kind: NodeKind) {
      return builtInNodeMetadata[kind];
    },
    has(kind: string): kind is NodeKind {
      return kind in builtInNodes;
    },
    kinds() {
      return Object.keys(builtInNodes) as NodeKind[];
    },
  };
}
