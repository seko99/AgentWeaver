import { readFileSync } from "node:fs";

import { requireArtifacts } from "../artifacts.js";
import type { ExecutorContext, ExecutorDefinition, JsonObject } from "./types.js";
import { processExecutor } from "./process-executor.js";

export type ClaudeSummaryExecutorConfig = JsonObject & {
  commandEnvVar: string;
  defaultCommand: string;
  modelEnvVar: string;
  defaultModel: string;
  promptFlag: string;
  allowedTools: string;
};

export type ClaudeSummaryExecutorInput = {
  prompt: string;
  outputFile: string;
  command?: string;
  env?: NodeJS.ProcessEnv;
  verbose?: boolean;
};

export type ClaudeSummaryExecutorResult = {
  output: string;
  artifactText: string;
  command: string;
  model: string;
};

function resolveModel(config: ClaudeSummaryExecutorConfig, env: NodeJS.ProcessEnv): string {
  return env[config.modelEnvVar]?.trim() || config.defaultModel;
}

export const claudeSummaryExecutor: ExecutorDefinition<
  ClaudeSummaryExecutorConfig,
  ClaudeSummaryExecutorInput,
  ClaudeSummaryExecutorResult
> = {
  kind: "claude-summary",
  version: 1,
  defaultConfig: {
    commandEnvVar: "CLAUDE_BIN",
    defaultCommand: "claude",
    modelEnvVar: "CLAUDE_SUMMARY_MODEL",
    defaultModel: "haiku",
    promptFlag: "-p",
    allowedTools: "Read,Write,Edit",
  },
  async execute(context: ExecutorContext, input: ClaudeSummaryExecutorInput, config: ClaudeSummaryExecutorConfig) {
    const env = input.env ?? context.env;
    const command = input.command ?? context.runtime.resolveCmd(config.defaultCommand, config.commandEnvVar);
    const model = resolveModel(config, env);
    const argv = [command, "--model", model, config.promptFlag, `--allowedTools=${config.allowedTools}`, input.prompt];
    const processInput = {
      argv,
      env,
      label: `claude:${model}`,
    };
    const result = await processExecutor.execute(
      context,
      input.verbose === undefined ? processInput : { ...processInput, verbose: input.verbose },
      processExecutor.defaultConfig,
    );
    requireArtifacts([input.outputFile], `Claude summary did not produce ${input.outputFile}.`);
    return {
      output: result.output,
      artifactText: readFileSync(input.outputFile, "utf8").trim(),
      command,
      model,
    };
  },
};
