import type { ExecutorContext, ExecutorDefinition, JsonObject } from "./types.js";

export type GitCommitExecutorConfig = JsonObject;

export type GitCommitExecutorInput = {
  message: string;
  files: string[];
};

export type GitCommitExecutorResult = {
  output: string;
  commitHash: string | null;
};

export const gitCommitExecutor: ExecutorDefinition<
  GitCommitExecutorConfig,
  GitCommitExecutorInput,
  GitCommitExecutorResult
> = {
  kind: "git-commit",
  version: 1,
  defaultConfig: {},
  async execute(context: ExecutorContext, input: GitCommitExecutorInput) {
    if (input.files.length > 0) {
      await context.runtime.runCommand(["git", "add", ...input.files], {
        dryRun: context.dryRun,
        verbose: context.verbose,
        label: "git add",
      });
    }

    const output = await context.runtime.runCommand(
      ["git", "commit", "-m", input.message],
      {
        dryRun: context.dryRun,
        verbose: context.verbose,
        label: "git commit",
      },
    );

    const match = output.match(/\[\S+ ([0-9a-f]{7,40})\]/);
    const commitHash = match?.[1] ?? null;

    return { output, commitHash };
  },
};
