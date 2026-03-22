import type { ProcessExecutorConfig, ProcessExecutorInput, ProcessExecutorResult } from "../../executors/process-executor.js";
import type { PipelineNodeDefinition } from "../types.js";
import { toExecutorContext } from "../types.js";

export type BuildFailureSummaryNodeParams = {
  output: string;
};

export type BuildFailureSummaryNodeResult = {
  summaryText: string;
};

const DEFAULT_CLAUDE_SUMMARY_MODEL = "haiku";

function truncateText(text: string, maxChars = 12000): string {
  return text.length <= maxChars ? text.trim() : text.trim().slice(-maxChars);
}

function fallbackBuildFailureSummary(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const tail = lines.length > 0 ? lines.slice(-8) : ["No build output captured."];
  return `Не удалось получить summary через Claude.\n\nПоследние строки лога:\n${tail.join("\n")}`;
}

function claudeSummaryModel(env: NodeJS.ProcessEnv): string {
  return env.CLAUDE_SUMMARY_MODEL?.trim() || DEFAULT_CLAUDE_SUMMARY_MODEL;
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

    let claudeCmd: string;
    try {
      claudeCmd = context.runtime.resolveCmd("claude", "CLAUDE_BIN");
    } catch {
      return {
        value: {
          summaryText: fallbackBuildFailureSummary(params.output),
        },
      };
    }

    const model = claudeSummaryModel(context.env);
    const prompt =
      "Ниже лог упавшей build verification.\n" +
      "Сделай краткое резюме на русском языке, без воды.\n" +
      "Нужно обязательно выделить:\n" +
      "1. Где именно упало.\n" +
      "2. Главную причину падения.\n" +
      "3. Что нужно исправить дальше, если это очевидно.\n" +
      "Ответ дай максимум 5 короткими пунктами.\n\n" +
      `Лог:\n${truncateText(params.output)}`;

    try {
      const executor = context.executors.get<ProcessExecutorConfig, ProcessExecutorInput, ProcessExecutorResult>("process");
      const result = await executor.execute(
        toExecutorContext(context),
        {
          argv: [claudeCmd, "--model", model, "-p", prompt],
          env: { ...context.env },
          dryRun: false,
          verbose: false,
          label: `claude:${model}`,
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
