import { readFileSync } from "node:fs";

import { requireArtifacts } from "../../artifacts.js";
import type { ClaudeExecutorConfig, ClaudeExecutorInput, ClaudeExecutorResult } from "../../executors/claude-executor.js";
import { printInfo, printPrompt, printSummary } from "../../tui.js";
import type { PipelineNodeDefinition } from "../types.js";
import { toExecutorContext } from "../types.js";

export type ClaudePromptNodeParams = {
  prompt: string;
  labelText: string;
  command?: string;
  model?: string;
  outputFile?: string;
  summaryTitle?: string;
  requiredArtifacts?: string[];
  missingArtifactsMessage?: string;
};

export type ClaudePromptNodeResult = ClaudeExecutorResult & {
  artifactText?: string;
};

export const claudePromptNode: PipelineNodeDefinition<ClaudePromptNodeParams, ClaudePromptNodeResult> = {
  kind: "claude-prompt",
  version: 1,
  async run(context, params) {
    printInfo(params.labelText);
    printPrompt("Claude", params.prompt);
    const executor = context.executors.get<ClaudeExecutorConfig, ClaudeExecutorInput, ClaudeExecutorResult>("claude");
    const value = await executor.execute(
      toExecutorContext(context),
      {
        prompt: params.prompt,
        ...(params.command ? { command: params.command } : {}),
        ...(params.model ? { model: params.model } : {}),
        env: { ...context.env },
      },
      executor.defaultConfig,
    );
    const outputs = [
      ...(params.requiredArtifacts ?? []).map((path) => ({ kind: "artifact" as const, path, required: true })),
      ...(params.outputFile ? [{ kind: "artifact" as const, path: params.outputFile, required: true }] : []),
    ];
    if (!params.outputFile) {
      return { value, outputs };
    }

    requireArtifacts([params.outputFile], params.missingArtifactsMessage ?? `Claude prompt did not produce ${params.outputFile}.`);
    const artifactText = readFileSync(params.outputFile, "utf8").trim();
    if (params.summaryTitle) {
      printSummary(params.summaryTitle, artifactText);
    }
    return {
      value: {
        ...value,
        artifactText,
      },
      outputs,
    };
  },
  checks(_context, params) {
    const requiredArtifacts = [
      ...(params.requiredArtifacts ?? []),
      ...(params.outputFile ? [params.outputFile] : []),
    ];
    if (requiredArtifacts.length === 0) {
      return [];
    }
    return [
      {
        kind: "require-artifacts",
        paths: requiredArtifacts,
        message: params.missingArtifactsMessage ?? "Claude prompt node did not produce required artifacts.",
      },
    ];
  },
};
