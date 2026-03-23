import { buildFailureSummaryNode } from "./nodes/build-failure-summary-node.js";
import { claudePromptNode } from "./nodes/claude-prompt-node.js";
import { claudeSummaryNode } from "./nodes/claude-summary-node.js";
import { codexDockerPromptNode } from "./nodes/codex-docker-prompt-node.js";
import { codexLocalPromptNode } from "./nodes/codex-local-prompt-node.js";
import { commandCheckNode } from "./nodes/command-check-node.js";
import { fileCheckNode } from "./nodes/file-check-node.js";
import { jiraFetchNode } from "./nodes/jira-fetch-node.js";
import { planCodexNode } from "./nodes/plan-codex-node.js";
import { reviewClaudeNode } from "./nodes/review-claude-node.js";
import { reviewReplyCodexNode } from "./nodes/review-reply-codex-node.js";
import { summaryFileLoadNode } from "./nodes/summary-file-load-node.js";
import { taskSummaryNode } from "./nodes/task-summary-node.js";
import { verifyBuildNode } from "./nodes/verify-build-node.js";
import type { PipelineNodeDefinition } from "./types.js";

export type NodeKind =
  | "build-failure-summary"
  | "claude-prompt"
  | "claude-summary"
  | "codex-docker-prompt"
  | "codex-local-prompt"
  | "command-check"
  | "file-check"
  | "jira-fetch"
  | "plan-codex"
  | "review-claude"
  | "review-reply-codex"
  | "summary-file-load"
  | "task-summary"
  | "verify-build";

type AnyNodeDefinition = PipelineNodeDefinition<Record<string, unknown>, unknown>;

export type NodeRegistry = {
  get: <TParams, TResult>(kind: NodeKind) => PipelineNodeDefinition<TParams, TResult>;
  has: (kind: string) => kind is NodeKind;
  kinds: () => NodeKind[];
};

const builtInNodes: Record<NodeKind, AnyNodeDefinition> = {
  "build-failure-summary": buildFailureSummaryNode as unknown as AnyNodeDefinition,
  "claude-prompt": claudePromptNode as unknown as AnyNodeDefinition,
  "claude-summary": claudeSummaryNode as unknown as AnyNodeDefinition,
  "codex-docker-prompt": codexDockerPromptNode as unknown as AnyNodeDefinition,
  "codex-local-prompt": codexLocalPromptNode as unknown as AnyNodeDefinition,
  "command-check": commandCheckNode as unknown as AnyNodeDefinition,
  "file-check": fileCheckNode as unknown as AnyNodeDefinition,
  "jira-fetch": jiraFetchNode as unknown as AnyNodeDefinition,
  "plan-codex": planCodexNode as unknown as AnyNodeDefinition,
  "review-claude": reviewClaudeNode as unknown as AnyNodeDefinition,
  "review-reply-codex": reviewReplyCodexNode as unknown as AnyNodeDefinition,
  "summary-file-load": summaryFileLoadNode as unknown as AnyNodeDefinition,
  "task-summary": taskSummaryNode as unknown as AnyNodeDefinition,
  "verify-build": verifyBuildNode as unknown as AnyNodeDefinition,
};

export function createNodeRegistry(): NodeRegistry {
  return {
    get<TParams, TResult>(kind: NodeKind) {
      return builtInNodes[kind] as unknown as PipelineNodeDefinition<TParams, TResult>;
    },
    has(kind: string): kind is NodeKind {
      return kind in builtInNodes;
    },
    kinds() {
      return Object.keys(builtInNodes) as NodeKind[];
    },
  };
}
