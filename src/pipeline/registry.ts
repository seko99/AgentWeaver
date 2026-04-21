import { commandCheckExecutor } from "../executors/command-check-executor.js";
import { codexExecutor } from "../executors/codex-executor.js";
import { fetchGitLabDiffExecutor } from "../executors/fetch-gitlab-diff-executor.js";
import { fetchGitLabReviewExecutor } from "../executors/fetch-gitlab-review-executor.js";
import { gitCommitExecutor } from "../executors/git-commit-executor.js";
import { jiraFetchExecutor } from "../executors/jira-fetch-executor.js";
import { opencodeExecutor } from "../executors/opencode-executor.js";
import { processExecutor } from "../executors/process-executor.js";
import { telegramNotifierExecutor } from "../executors/telegram-notifier-executor.js";

import type { ExecutorDefinition, JsonValue } from "../executors/types.js";
import type { NormalizedPluginExecutorRegistration, PluginOwner } from "./plugin-types.js";
import { TaskRunnerError } from "../errors.js";

export type BuiltInExecutorId =
  | "process"
  | "command-check"
  | "fetch-gitlab-diff"
  | "fetch-gitlab-review"
  | "git-commit"
  | "jira-fetch"
  | "codex"
  | "opencode"
  | "telegram-notifier";

export type ExecutorId = string;

export type ExecutorRegistry = {
  get: <TConfig extends JsonValue, TInput, TResult>(
    id: string,
  ) => ExecutorDefinition<TConfig, TInput, TResult>;
  has: (id: string) => boolean;
  ids: () => string[];
};

type AnyExecutorDefinition = ExecutorDefinition<JsonValue, unknown, unknown>;

export const BUILT_IN_EXECUTOR_IDS = [
  "process",
  "command-check",
  "fetch-gitlab-diff",
  "fetch-gitlab-review",
  "git-commit",
  "jira-fetch",
  "codex",
  "opencode",
  "telegram-notifier",
] as const satisfies readonly BuiltInExecutorId[];

const builtInExecutors: Record<BuiltInExecutorId, AnyExecutorDefinition> = {
  process: processExecutor as unknown as AnyExecutorDefinition,
  "command-check": commandCheckExecutor as unknown as AnyExecutorDefinition,
  "fetch-gitlab-diff": fetchGitLabDiffExecutor as unknown as AnyExecutorDefinition,
  "fetch-gitlab-review": fetchGitLabReviewExecutor as unknown as AnyExecutorDefinition,
  "git-commit": gitCommitExecutor as unknown as AnyExecutorDefinition,
  "jira-fetch": jiraFetchExecutor as unknown as AnyExecutorDefinition,
  codex: codexExecutor as unknown as AnyExecutorDefinition,
  opencode: opencodeExecutor as unknown as AnyExecutorDefinition,
  "telegram-notifier": telegramNotifierExecutor as unknown as AnyExecutorDefinition,
};

function coreOwner(id: string): PluginOwner {
  return {
    kind: "core",
    id: `core:${id}`,
    manifestPath: "built-in executor registry",
  };
}

export function createExecutorRegistry(
  pluginExecutors: readonly NormalizedPluginExecutorRegistration[] = [],
): ExecutorRegistry {
  const definitions = new Map<string, AnyExecutorDefinition>(Object.entries(builtInExecutors));
  const owners = new Map<string, PluginOwner>(
    Object.keys(builtInExecutors).map((id) => [id, coreOwner(id)]),
  );
  for (const registration of pluginExecutors) {
    const existingOwner = owners.get(registration.id);
    if (existingOwner) {
      throw new TaskRunnerError(
        `Duplicate executor id '${registration.id}' conflicts between ${existingOwner.id} (${existingOwner.manifestPath}) and plugin '${registration.pluginId}' (${registration.manifestPath}).`,
      );
    }
    definitions.set(registration.id, registration.definition as AnyExecutorDefinition);
    owners.set(registration.id, {
      kind: "plugin",
      id: registration.pluginId,
      manifestPath: registration.manifestPath,
      entrypointPath: registration.entrypointPath,
    });
  }
  return {
    get<TConfig extends JsonValue, TInput, TResult>(id: string) {
      const definition = definitions.get(id);
      if (!definition) {
        throw new TaskRunnerError(`Unknown executor '${id}'.`);
      }
      return definition as unknown as ExecutorDefinition<TConfig, TInput, TResult>;
    },
    has(id: string) {
      return definitions.has(id);
    },
    ids() {
      return [...definitions.keys()];
    },
  };
}
