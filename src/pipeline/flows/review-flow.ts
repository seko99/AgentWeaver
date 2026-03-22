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

export async function runReviewFlow(
  context: PipelineContext,
  params: ReviewFlowParams,
): Promise<{ readyToMerge: boolean; iteration: number }> {
  requireArtifacts(planArtifacts(params.taskKey), "Review mode requires plan artifacts from the planning phase.");
  const iteration = nextReviewIterationForTask(params.taskKey);
  const reviewFile = artifactFile("review", params.taskKey, iteration);
  const reviewSummaryFile = artifactFile("review-summary", params.taskKey, iteration);
  const reviewReplyFile = artifactFile("review-reply", params.taskKey, iteration);
  const reviewReplySummaryFile = artifactFile("review-reply-summary", params.taskKey, iteration);

  await runNode(reviewClaudeNode, context, {
    jiraTaskFile: params.jiraTaskFile,
    taskKey: params.taskKey,
    iteration,
    claudeCmd: params.claudeCmd,
    ...(params.extraPrompt !== undefined ? { extraPrompt: params.extraPrompt } : {}),
  });

  if (!context.dryRun) {
    await runNode(claudeSummaryNode, context, {
      claudeCmd: params.claudeCmd,
      outputFile: reviewSummaryFile,
      prompt: formatTemplate(REVIEW_SUMMARY_PROMPT_TEMPLATE, {
        review_file: reviewFile,
        review_summary_file: reviewSummaryFile,
      }),
      summaryTitle: "Claude Comments",
      verbose: context.verbose,
    });
  }

  await runNode(reviewReplyCodexNode, context, {
    jiraTaskFile: params.jiraTaskFile,
    taskKey: params.taskKey,
    iteration,
    codexCmd: params.codexCmd,
    ...(params.extraPrompt !== undefined ? { extraPrompt: params.extraPrompt } : {}),
  });

  let readyToMerge = false;
  if (!context.dryRun) {
    await runNode(claudeSummaryNode, context, {
      claudeCmd: params.claudeCmd,
      outputFile: reviewReplySummaryFile,
      prompt: formatTemplate(REVIEW_REPLY_SUMMARY_PROMPT_TEMPLATE, {
        review_reply_file: reviewReplyFile,
        review_reply_summary_file: reviewReplySummaryFile,
      }),
      summaryTitle: "Codex Reply Summary",
      verbose: context.verbose,
    });
    if (existsSync(READY_TO_MERGE_FILE)) {
      printPanel("Ready To Merge", "Изменения готовы к merge\nФайл ready-to-merge.md создан.", "green");
      readyToMerge = true;
    }
  }

  return { readyToMerge, iteration };
}
