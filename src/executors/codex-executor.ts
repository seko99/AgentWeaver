import { codexExecutorDefaultConfig } from "./configs/codex-config.js";
import type { ExecutorContext, ExecutorDefinition, JsonObject } from "./types.js";
import { processExecutor } from "./process-executor.js";

export type CodexExecutorConfig = JsonObject & {
  commandEnvVar: string;
  defaultCommand: string;
  modelEnvVar: string;
  defaultModel: string;
  subcommand: string;
  fullAutoFlag: string;
};

export type CodexExecutorInput = {
  prompt: string;
  command?: string;
  model?: string;
  env?: NodeJS.ProcessEnv;
};

export type CodexExecutorResult = {
  output: string;
  command: string;
  model: string;
};

function resolveModel(config: CodexExecutorConfig, env: NodeJS.ProcessEnv): string {
  return env[config.modelEnvVar]?.trim() || config.defaultModel;
}

export const codexExecutor: ExecutorDefinition<
  CodexExecutorConfig,
  CodexExecutorInput,
  CodexExecutorResult
> = {
  kind: "codex",
  version: 1,
  defaultConfig: codexExecutorDefaultConfig,
  async execute(context: ExecutorContext, input: CodexExecutorInput, config: CodexExecutorConfig) {
    const env = input.env ?? context.env;
    const command = input.command ?? context.runtime.resolveCmd(config.defaultCommand, config.commandEnvVar);
    const model = input.model?.trim() || resolveModel(config, env);
    const result = await processExecutor.execute(
      context,
      {
        argv: [command, config.subcommand, "--model", model, config.fullAutoFlag, input.prompt],
        env,
        label: `codex:${model}`,
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
