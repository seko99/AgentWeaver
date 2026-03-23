import { taskSummaryFile } from "../../artifacts.js";
import type {
  ClaudeSummaryExecutorConfig,
  ClaudeSummaryExecutorInput,
  ClaudeSummaryExecutorResult,
} from "../../executors/claude-summary-executor.js";
import { TASK_SUMMARY_PROMPT_TEMPLATE, formatTemplate } from "../../prompts.js";
import type { PipelineNodeDefinition } from "../types.js";
import { toExecutorContext } from "../types.js";

export type TaskSummaryNodeParams = {
  jiraTaskFile: string;
  taskKey: string;
  claudeCmd?: string;
  verbose?: boolean;
};

export const taskSummaryNode: PipelineNodeDefinition<TaskSummaryNodeParams, ClaudeSummaryExecutorResult> = {
  kind: "task-summary",
  version: 1,
  async run(context, params) {
    const outputFile = taskSummaryFile(params.taskKey);
    const prompt = formatTemplate(TASK_SUMMARY_PROMPT_TEMPLATE, {
      jira_task_file: params.jiraTaskFile,
      task_summary_file: outputFile,
    });
    const executor = context.executors.get<
      ClaudeSummaryExecutorConfig,
      ClaudeSummaryExecutorInput,
      ClaudeSummaryExecutorResult
    >("claude-summary");
    const value = await executor.execute(
      toExecutorContext(context),
      {
        prompt,
        outputFile,
        ...(params.claudeCmd ? { command: params.claudeCmd } : {}),
        env: { ...context.env },
        verbose: params.verbose ?? context.verbose,
      },
      executor.defaultConfig,
    );
    context.setSummary?.(value.artifactText);
    return {
      value,
      outputs: [{ kind: "artifact", path: outputFile, required: true }],
    };
  },
  checks(_context, params) {
    return [
      {
        kind: "require-artifacts",
        paths: [taskSummaryFile(params.taskKey)],
        message: `Claude summary did not produce ${taskSummaryFile(params.taskKey)}.`,
      },
    ];
  },
};
