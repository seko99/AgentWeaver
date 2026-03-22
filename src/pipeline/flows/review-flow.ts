import { existsSync, readdirSync } from "node:fs";

import {
  READY_TO_MERGE_FILE,
  REVIEW_REPLY_FILE_RE,
  artifactFile,
  planArtifacts,
  requireArtifacts,
} from "../../artifacts.js";
import { TaskRunnerError } from "../../errors.js";
import { REVIEW_REPLY_SUMMARY_PROMPT_TEMPLATE, REVIEW_SUMMARY_PROMPT_TEMPLATE, formatTemplate } from "../../prompts.js";
import { printPanel } from "../../tui.js";
import { runFlow } from "../flow-runner.js";
import type { FlowDefinition } from "../flow-types.js";
import { runNode } from "../node-runner.js";
import { claudeSummaryNode } from "../nodes/claude-summary-node.js";
import { reviewClaudeNode } from "../nodes/review-claude-node.js";
import { reviewReplyCodexNode } from "../nodes/review-reply-codex-node.js";
import type { PipelineContext } from "../types.js";

function nextReviewIterationForTask(taskKey: string): number {
  let maxIndex = 0;
  for (const entry of readdirSync(process.cwd(), { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    const match = REVIEW_REPLY_FILE_RE.exec(entry.name);
    if (match && match[1] === taskKey) {
      const current = Number.parseInt(match[2] ?? "0", 10);
      maxIndex = Math.max(maxIndex, current);
    }
  }
  return maxIndex + 1;
}

export type ReviewFlowParams = {
  jiraTaskFile: string;
  taskKey: string;
  extraPrompt?: string | null;
  claudeCmd: string;
  codexCmd: string;
};

async function runReviewFlowInternal(
  context: PipelineContext,
  params: ReviewFlowParams,
  iteration: number,
): Promise<{ readyToMerge: boolean }> {
  requireArtifacts(planArtifacts(params.taskKey), "Review mode requires plan artifacts from the planning phase.");
  const reviewFile = artifactFile("review", params.taskKey, iteration);
  const reviewSummaryFile = artifactFile("review-summary", params.taskKey, iteration);
  const reviewReplyFile = artifactFile("review-reply", params.taskKey, iteration);
  const reviewReplySummaryFile = artifactFile("review-reply-summary", params.taskKey, iteration);
  let readyToMerge = false;
  const reviewFlowDefinition: FlowDefinition<ReviewFlowParams> = {
    kind: "review-flow",
    version: 1,
    steps: [
      {
        id: "run_claude_review",
        async run(stepContext, stepParams) {
          await runNode(reviewClaudeNode, stepContext, {
            jiraTaskFile: stepParams.jiraTaskFile,
            taskKey: stepParams.taskKey,
            iteration,
            claudeCmd: stepParams.claudeCmd,
            ...(stepParams.extraPrompt !== undefined ? { extraPrompt: stepParams.extraPrompt } : {}),
          });
          return { completed: true, metadata: { iteration } };
        },
      },
      {
        id: "summarize_review",
        async run(stepContext, stepParams) {
          if (stepContext.dryRun) {
            return { completed: true, metadata: { skipped: true } };
          }
          await runNode(claudeSummaryNode, stepContext, {
            claudeCmd: stepParams.claudeCmd,
            outputFile: reviewSummaryFile,
            prompt: formatTemplate(REVIEW_SUMMARY_PROMPT_TEMPLATE, {
              review_file: reviewFile,
              review_summary_file: reviewSummaryFile,
            }),
            summaryTitle: "Claude Comments",
            verbose: stepContext.verbose,
          });
          return { completed: true };
        },
      },
      {
        id: "run_codex_review_reply",
        async run(stepContext, stepParams) {
          await runNode(reviewReplyCodexNode, stepContext, {
            jiraTaskFile: stepParams.jiraTaskFile,
            taskKey: stepParams.taskKey,
            iteration,
            codexCmd: stepParams.codexCmd,
            ...(stepParams.extraPrompt !== undefined ? { extraPrompt: stepParams.extraPrompt } : {}),
          });
          return { completed: true };
        },
      },
      {
        id: "summarize_review_reply",
        async run(stepContext, stepParams) {
          if (stepContext.dryRun) {
            return { completed: true, metadata: { skipped: true } };
          }
          await runNode(claudeSummaryNode, stepContext, {
            claudeCmd: stepParams.claudeCmd,
            outputFile: reviewReplySummaryFile,
            prompt: formatTemplate(REVIEW_REPLY_SUMMARY_PROMPT_TEMPLATE, {
              review_reply_file: reviewReplyFile,
              review_reply_summary_file: reviewReplySummaryFile,
            }),
            summaryTitle: "Codex Reply Summary",
            verbose: stepContext.verbose,
          });
          return { completed: true };
        },
      },
      {
        id: "check_ready_to_merge",
        async run(stepContext) {
          if (!stepContext.dryRun && existsSync(READY_TO_MERGE_FILE)) {
            printPanel("Ready To Merge", "Изменения готовы к merge\nФайл ready-to-merge.md создан.", "green");
            readyToMerge = true;
          }
          return { completed: true, metadata: { readyToMerge } };
        },
      },
    ],
  };

  await runFlow(reviewFlowDefinition, context, params);
  return { readyToMerge };
}

export async function runReviewFlow(
  context: PipelineContext,
  params: ReviewFlowParams,
): Promise<{ readyToMerge: boolean; iteration: number }> {
  const iteration = nextReviewIterationForTask(params.taskKey);
  const result = await runReviewFlowInternal(context, params, iteration);
  return { readyToMerge: result.readyToMerge, iteration };
}
