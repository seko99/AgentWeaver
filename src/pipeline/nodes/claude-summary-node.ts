import type {
  ClaudeSummaryExecutorConfig,
  ClaudeSummaryExecutorInput,
  ClaudeSummaryExecutorResult,
} from "../../executors/claude-summary-executor.js";
import { printInfo, printPrompt, printSummary } from "../../tui.js";
import type { PipelineNodeDefinition } from "../types.js";
import { toExecutorContext } from "../types.js";

export type ClaudeSummaryNodeParams = {
  prompt: string;
  outputFile: string;
  summaryTitle: string;
  claudeCmd: string;
  verbose: boolean;
};

export const claudeSummaryNode: PipelineNodeDefinition<ClaudeSummaryNodeParams, ClaudeSummaryExecutorResult> = {
  kind: "claude-summary",
  version: 1,
  async run(context, params) {
    printInfo(`Preparing summary in ${params.outputFile}`);
    printPrompt("Claude", params.prompt);
    const executor = context.executors.get<
      ClaudeSummaryExecutorConfig,
      ClaudeSummaryExecutorInput,
      ClaudeSummaryExecutorResult
    >("claude-summary");
    const value = await executor.execute(
      toExecutorContext(context),
      {
        prompt: params.prompt,
        outputFile: params.outputFile,
        command: params.claudeCmd,
        env: { ...context.env },
        verbose: params.verbose,
      },
      executor.defaultConfig,
    );
    printSummary(params.summaryTitle, value.artifactText);
    return {
      value,
      outputs: [{ kind: "artifact", path: params.outputFile, required: true }],
    };
  },
  checks(_context, params) {
    return [
      {
        kind: "require-artifacts",
        paths: [params.outputFile],
        message: `Claude summary did not produce ${params.outputFile}.`,
      },
    ];
  },
};
