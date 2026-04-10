import { artifactFile, designFile, planFile } from "../../artifacts.js";
import type {
  CodexLocalExecutorConfig,
  CodexLocalExecutorInput,
  CodexLocalExecutorResult,
} from "../../executors/codex-local-executor.js";
import { REVIEW_REPLY_PROMPT_TEMPLATE, formatPrompt, formatTemplate } from "../../prompts.js";
import { printInfo, printPrompt } from "../../tui.js";
import type { PipelineNodeDefinition } from "../types.js";
import { toExecutorContext } from "../types.js";

export type ReviewReplyCodexNodeParams = {
  jiraTaskFile: string;
  taskKey: string;
  iteration: number;
  extraPrompt?: string | null;
  codexCmd: string;
};

export const reviewReplyCodexNode: PipelineNodeDefinition<ReviewReplyCodexNodeParams, CodexLocalExecutorResult> = {
  kind: "review-reply-codex",
  version: 1,
  async run(context, params) {
    const reviewFile = artifactFile("review", params.taskKey, params.iteration);
    const reviewReplyFile = artifactFile("review-reply", params.taskKey, params.iteration);
    const prompt = formatPrompt(
      formatTemplate(REVIEW_REPLY_PROMPT_TEMPLATE, {
        review_file: reviewFile,
        jira_task_file: params.jiraTaskFile,
        design_file: designFile(params.taskKey),
        plan_file: planFile(params.taskKey),
        review_reply_file: reviewReplyFile,
      }),
      params.extraPrompt,
    );
    printInfo(`Running Codex review reply mode (iteration ${params.iteration})`);
    printPrompt("Codex", prompt);
    const executor = context.executors.get<CodexLocalExecutorConfig, CodexLocalExecutorInput, CodexLocalExecutorResult>(
      "codex",
    );
    const value = await executor.execute(
      toExecutorContext(context),
      {
        prompt,
        command: params.codexCmd,
        env: { ...context.env },
      },
      executor.defaultConfig,
    );
    return {
      value,
      outputs: [{ kind: "artifact", path: reviewReplyFile, required: true }],
    };
  },
  checks(_context, params) {
    return [
      {
        kind: "require-artifacts",
        paths: [artifactFile("review-reply", params.taskKey, params.iteration)],
        message: "Codex review reply did not produce the required review-reply artifact.",
      },
    ];
  },
};
