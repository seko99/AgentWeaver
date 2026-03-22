import type { ExecutorContext, ExecutorDefinition, JsonObject } from "./types.js";
import { processExecutor } from "./process-executor.js";

export type CodexDockerExecutorConfig = JsonObject & {
  service: string;
  composeFileFlag: string;
  runArgs: string[];
  modelEnvVar: string;
  defaultModel: string;
  promptEnvVar: string;
  flagsEnvVar: string;
  execFlagsTemplate: string;
};

export type CodexDockerExecutorInput = {
  dockerComposeFile: string;
  prompt: string;
};

export type CodexDockerExecutorResult = {
  output: string;
  composeCommand: string[];
  model: string;
};

function resolveModel(config: CodexDockerExecutorConfig, env: NodeJS.ProcessEnv): string {
  return env[config.modelEnvVar]?.trim() || config.defaultModel;
}

export const codexDockerExecutor: ExecutorDefinition<
  CodexDockerExecutorConfig,
  CodexDockerExecutorInput,
  CodexDockerExecutorResult
> = {
  kind: "codex-docker",
  version: 1,
  defaultConfig: {
    service: "codex-exec",
    composeFileFlag: "-f",
    runArgs: ["run", "--rm"],
    modelEnvVar: "CODEX_MODEL",
    defaultModel: "gpt-5.4",
    promptEnvVar: "CODEX_PROMPT",
    flagsEnvVar: "CODEX_EXEC_FLAGS",
    execFlagsTemplate: "--model {model} --dangerously-bypass-approvals-and-sandbox",
  },
  async execute(context: ExecutorContext, input: CodexDockerExecutorInput, config: CodexDockerExecutorConfig) {
    const composeCommand = context.runtime.resolveDockerComposeCmd();
    const env = context.runtime.dockerRuntimeEnv();
    const model = resolveModel(config, env);
    env[config.promptEnvVar] = input.prompt;
    env[config.flagsEnvVar] = config.execFlagsTemplate.replace("{model}", model);
    const result = await processExecutor.execute(
      context,
      {
        argv: [...composeCommand, config.composeFileFlag, input.dockerComposeFile, ...config.runArgs, config.service],
        env,
        label: `codex:${model}`,
      },
      processExecutor.defaultConfig,
    );
    return {
      output: result.output,
      composeCommand,
      model,
    };
  },
};
