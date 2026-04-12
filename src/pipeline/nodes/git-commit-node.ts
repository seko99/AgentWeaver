import type {
  GitCommitExecutorConfig,
  GitCommitExecutorInput,
  GitCommitExecutorResult,
} from "../../executors/git-commit-executor.js";
import { printInfo } from "../../tui.js";
import type { PipelineNodeDefinition } from "../types.js";
import { toExecutorContext } from "../types.js";

export type GitCommitNodeParams = {
  message: string;
  files: string[];
  labelText?: string;
  editInEditor?: boolean;
};

export const gitCommitNode: PipelineNodeDefinition<GitCommitNodeParams, GitCommitExecutorResult> = {
  kind: "git-commit",
  version: 1,
  async run(context, params) {
    printInfo(params.labelText ?? "Committing changes");

    if (context.dryRun) {
      printInfo("DRY RUN: git commit не выполнен");
      return {
        value: {
          output: "",
          commitHash: null,
        },
      };
    }

    const executor = context.executors.get<
      GitCommitExecutorConfig,
      GitCommitExecutorInput,
      GitCommitExecutorResult
    >("git-commit");
    const executorInput: GitCommitExecutorInput = {
      message: params.message,
      files: params.files,
    };
    if (params.editInEditor) {
      executorInput.editEnabled = true;
    }

    const value = await executor.execute(
      toExecutorContext(context),
      executorInput,
      executor.defaultConfig,
    );

    return { value };
  },
};
