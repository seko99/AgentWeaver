import { codexLocalExecutorDefaultConfig } from "./configs/codex-local-config.js";
import type { ExecutorContext, ExecutorDefinition, JsonObject } from "./types.js";
import { processExecutor } from "./process-executor.js";

export type CodexLocalExecutorConfig = JsonObject & {
  commandEnvVar: string;
  defaultCommand: string;
  modelEnvVar: string;
  defaultModel: string;
  subcommand: string;
  fullAutoFlag: string;
};

export type CodexLocalExecutorInput = {
  prompt: string;
  command?: string;
  env?: NodeJS.ProcessEnv;
};

export type CodexLocalExecutorResult = {
  output: string;
  command: string;
  model: string;
};

function resolveModel(config: CodexLocalExecutorConfig, env: NodeJS.ProcessEnv): string {
  return env[config.modelEnvVar]?.trim() || config.defaultModel;
}

export const codexLocalExecutor: ExecutorDefinition<
  CodexLocalExecutorConfig,
  CodexLocalExecutorInput,
  CodexLocalExecutorResult
> = {
  kind: "codex-local",
  version: 1,
  defaultConfig: codexLocalExecutorDefaultConfig,
  async execute(context: ExecutorContext, input: CodexLocalExecutorInput, config: CodexLocalExecutorConfig) {
    const env = input.env ?? context.env;
    const command = input.command ?? context.runtime.resolveCmd(config.defaultCommand, config.commandEnvVar);
    const model = resolveModel(config, env);
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
