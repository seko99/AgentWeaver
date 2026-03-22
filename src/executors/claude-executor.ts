import { claudeExecutorDefaultConfig } from "./configs/claude-config.js";
import type { ExecutorContext, ExecutorDefinition, JsonObject } from "./types.js";
import { processExecutor } from "./process-executor.js";

export type ClaudeExecutorConfig = JsonObject & {
  commandEnvVar: string;
  defaultCommand: string;
  modelEnvVar: string;
  defaultModel: string;
  promptFlag: string;
  allowedTools: string;
  outputFormat: string;
  includePartialMessages: boolean;
  verboseMode: boolean;
};

export type ClaudeExecutorInput = {
  prompt: string;
  command?: string;
  env?: NodeJS.ProcessEnv;
};

export type ClaudeExecutorResult = {
  output: string;
  command: string;
  model: string;
};

function resolveModel(config: ClaudeExecutorConfig, env: NodeJS.ProcessEnv): string {
  return env[config.modelEnvVar]?.trim() || config.defaultModel;
}

export const claudeExecutor: ExecutorDefinition<ClaudeExecutorConfig, ClaudeExecutorInput, ClaudeExecutorResult> = {
  kind: "claude",
  version: 1,
  defaultConfig: claudeExecutorDefaultConfig,
  async execute(context: ExecutorContext, input: ClaudeExecutorInput, config: ClaudeExecutorConfig) {
    const env = input.env ?? context.env;
    const command = input.command ?? context.runtime.resolveCmd(config.defaultCommand, config.commandEnvVar);
    const model = resolveModel(config, env);
    const argv = [command, "--model", model, config.promptFlag, `--allowedTools=${config.allowedTools}`];
    if (config.outputFormat) {
      argv.push("--output-format", config.outputFormat);
    }
    if (config.verboseMode) {
      argv.push("--verbose");
    }
    if (config.includePartialMessages) {
      argv.push("--include-partial-messages");
    }
    argv.push(input.prompt);

    const result = await processExecutor.execute(
      context,
      {
        argv,
        env,
        label: `claude:${model}`,
      },
      processExecutor.defaultConfig,
    );
    return {
      output: result.output,
      command,
      model,
    };
  },
};
