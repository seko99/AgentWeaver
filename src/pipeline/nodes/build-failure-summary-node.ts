import type {
  CodexLocalExecutorConfig,
  CodexLocalExecutorInput,
  CodexLocalExecutorResult,
} from "../../executors/codex-local-executor.js";
import type { PipelineNodeDefinition } from "../types.js";
import { toExecutorContext } from "../types.js";

export type BuildFailureSummaryNodeParams = {
  output: string;
};

export type BuildFailureSummaryNodeResult = {
  summaryText: string;
};

const DEFAULT_CODEX_MODEL = "gpt-5.4-mini";

function truncateText(text: string, maxChars = 12000): string {
  return text.length <= maxChars ? text.trim() : text.trim().slice(-maxChars);
}

function fallbackBuildFailureSummary(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const tail = lines.length > 0 ? lines.slice(-8) : ["No build output captured."];
  return `Failed to get summary via Codex.\n\nLast log lines:\n${tail.join("\n")}`;
}

function codexModel(env: NodeJS.ProcessEnv): string {
  return env.CODEX_MODEL?.trim() || DEFAULT_CODEX_MODEL;
}

export const buildFailureSummaryNode: PipelineNodeDefinition<BuildFailureSummaryNodeParams, BuildFailureSummaryNodeResult> = {
  kind: "build-failure-summary",
  version: 1,
  async run(context, params) {
    if (!params.output.trim()) {
      return {
        value: {
          summaryText: "Build verification failed, but no output was captured.",
        },
      };
    }

    const model = codexModel(context.env);
    const prompt =
      "Below is the log from a failing build verification.\n" +
      "Provide a brief summary in English, no fluff.\n" +
      "Must highlight:\n" +
      "1. Where exactly it failed.\n" +
      "2. The main cause of the failure.\n" +
      "3. What needs to be fixed next, if obvious.\n" +
      "Respond with at most 5 short bullet points.\n\n" +
      `Log:\n${truncateText(params.output)}`;

    try {
      const executor = context.executors.get<CodexLocalExecutorConfig, CodexLocalExecutorInput, CodexLocalExecutorResult>(
        "codex",
      );
      const result = await executor.execute(
        toExecutorContext(context),
        {
          prompt,
          model,
          env: { ...context.env },
        },
        executor.defaultConfig,
      );
      return {
        value: {
          summaryText: result.output.trim() || fallbackBuildFailureSummary(params.output),
        },
      };
    } catch {
      return {
        value: {
          summaryText: fallbackBuildFailureSummary(params.output),
        },
      };
    }
  },
};
