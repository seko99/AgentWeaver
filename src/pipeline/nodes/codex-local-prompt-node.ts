import { readFileSync } from "node:fs";

import type {
  CodexLocalExecutorConfig,
  CodexLocalExecutorInput,
  CodexLocalExecutorResult,
} from "../../executors/codex-local-executor.js";
import { printInfo, printPrompt, printSummary } from "../../tui.js";
import type { PipelineNodeDefinition } from "../types.js";
import { toExecutorContext } from "../types.js";

export type CodexLocalPromptNodeParams = {
  prompt: string;
  labelText: string;
  model?: string;
  outputFile?: string;
  requiredArtifacts?: string[];
  missingArtifactsMessage?: string;
  summaryTitle?: string;
};

export const codexLocalPromptNode: PipelineNodeDefinition<CodexLocalPromptNodeParams, CodexLocalExecutorResult> = {
  kind: "codex-local-prompt",
  version: 1,
  async run(context, params) {
    printInfo(params.labelText);
    printPrompt("Codex", params.prompt);
    const executor = context.executors.get<CodexLocalExecutorConfig, CodexLocalExecutorInput, CodexLocalExecutorResult>(
      "codex-local",
    );
    const value = await executor.execute(
      toExecutorContext(context),
      {
        prompt: params.prompt,
        ...(params.model ? { model: params.model } : {}),
        env: { ...context.env },
      },
      executor.defaultConfig,
    );
    const outputPaths = Array.from(new Set([...(params.requiredArtifacts ?? []), ...(params.outputFile ? [params.outputFile] : [])]));
    if (params.outputFile && params.summaryTitle) {
      const summaryText = readFileSync(params.outputFile, "utf8").trim();
      context.setSummary?.(summaryText);
      printSummary(params.summaryTitle, summaryText);
    }
    return {
      value,
      outputs: outputPaths.map((path) => ({ kind: "artifact" as const, path, required: true })),
    };
  },
  checks(_context, params) {
    const requiredPaths = Array.from(new Set([...(params.requiredArtifacts ?? []), ...(params.outputFile ? [params.outputFile] : [])]));
    if (requiredPaths.length === 0) {
      return [];
    }
    return [
      {
        kind: "require-artifacts",
        paths: requiredPaths,
        message: params.missingArtifactsMessage
          ?? (params.outputFile ? `Codex local node did not produce ${params.outputFile}.` : "Codex local node did not produce required artifacts."),
      },
    ];
  },
};
