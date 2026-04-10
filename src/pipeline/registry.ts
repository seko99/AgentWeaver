import { commandCheckExecutor } from "../executors/command-check-executor.js";
import { codexDockerExecutor } from "../executors/codex-docker-executor.js";
import { codexLocalExecutor } from "../executors/codex-local-executor.js";
import { fetchGitLabDiffExecutor } from "../executors/fetch-gitlab-diff-executor.js";
import { fetchGitLabReviewExecutor } from "../executors/fetch-gitlab-review-executor.js";
import { jiraFetchExecutor } from "../executors/jira-fetch-executor.js";
import { opencodeExecutor } from "../executors/opencode-executor.js";
import { processExecutor } from "../executors/process-executor.js";
import { verifyBuildExecutor } from "../executors/verify-build-executor.js";
import type { ExecutorDefinition, JsonValue } from "../executors/types.js";

export type ExecutorId =
  | "process"
  | "command-check"
  | "fetch-gitlab-diff"
  | "fetch-gitlab-review"
  | "jira-fetch"
  | "codex-local"
  | "codex-docker"
  | "opencode"
  | "verify-build";

export type ExecutorRegistry = {
  get: <TConfig extends JsonValue, TInput, TResult>(
    id: ExecutorId,
  ) => ExecutorDefinition<TConfig, TInput, TResult>;
  has: (id: string) => id is ExecutorId;
  ids: () => ExecutorId[];
};

type AnyExecutorDefinition = ExecutorDefinition<JsonValue, unknown, unknown>;

const builtInExecutors: Record<ExecutorId, AnyExecutorDefinition> = {
  process: processExecutor as unknown as AnyExecutorDefinition,
  "command-check": commandCheckExecutor as unknown as AnyExecutorDefinition,
  "fetch-gitlab-diff": fetchGitLabDiffExecutor as unknown as AnyExecutorDefinition,
  "fetch-gitlab-review": fetchGitLabReviewExecutor as unknown as AnyExecutorDefinition,
  "jira-fetch": jiraFetchExecutor as unknown as AnyExecutorDefinition,
  "codex-local": codexLocalExecutor as unknown as AnyExecutorDefinition,
  "codex-docker": codexDockerExecutor as unknown as AnyExecutorDefinition,
  opencode: opencodeExecutor as unknown as AnyExecutorDefinition,
  "verify-build": verifyBuildExecutor as unknown as AnyExecutorDefinition,
};

export function createExecutorRegistry(): ExecutorRegistry {
  return {
    get<TConfig extends JsonValue, TInput, TResult>(id: ExecutorId) {
      return builtInExecutors[id] as unknown as ExecutorDefinition<TConfig, TInput, TResult>;
    },
    has(id: string): id is ExecutorId {
      return id in builtInExecutors;
    },
    ids() {
      return Object.keys(builtInExecutors) as ExecutorId[];
    },
  };
}
