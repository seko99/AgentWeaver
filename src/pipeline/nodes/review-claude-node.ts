import { artifactFile, designFile, planFile } from "../../artifacts.js";
import type { ClaudeExecutorConfig, ClaudeExecutorInput, ClaudeExecutorResult } from "../../executors/claude-executor.js";
import { REVIEW_PROMPT_TEMPLATE, formatPrompt, formatTemplate } from "../../prompts.js";
import { printInfo, printPrompt } from "../../tui.js";
import type { PipelineNodeDefinition } from "../types.js";
import { toExecutorContext } from "../types.js";

export type ReviewClaudeNodeParams = {
  jiraTaskFile: string;
  taskKey: string;
  iteration: number;
  extraPrompt?: string | null;
  claudeCmd: string;
};

export const reviewClaudeNode: PipelineNodeDefinition<ReviewClaudeNodeParams, ClaudeExecutorResult> = {
  kind: "review-claude",
  version: 1,
  async run(context, params) {
    const reviewFile = artifactFile("review", params.taskKey, params.iteration);
    const prompt = formatPrompt(
      formatTemplate(REVIEW_PROMPT_TEMPLATE, {
        jira_task_file: params.jiraTaskFile,
        design_file: designFile(params.taskKey),
        plan_file: planFile(params.taskKey),
        review_file: reviewFile,
      }),
      params.extraPrompt,
    );
    printInfo(`Running Claude review mode (iteration ${params.iteration})`);
    printPrompt("Claude", prompt);
    const executor = context.executors.get<ClaudeExecutorConfig, ClaudeExecutorInput, ClaudeExecutorResult>("claude");
    const value = await executor.execute(
      toExecutorContext(context),
      {
        prompt,
        command: params.claudeCmd,
        env: { ...context.env },
      },
      executor.defaultConfig,
    );
    return {
      value,
      outputs: [{ kind: "artifact", path: reviewFile, required: true }],
    };
  },
  checks(_context, params) {
    return [
      {
        kind: "require-artifacts",
        paths: [artifactFile("review", params.taskKey, params.iteration)],
        message: "Claude review did not produce the required review artifact.",
      },
    ];
  },
};
