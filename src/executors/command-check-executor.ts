import type { ExecutorContext, ExecutorDefinition, JsonObject } from "./types.js";

export type CommandCheckExecutorConfig = JsonObject;

export type CommandCheckExecutorInput = {
  commands: Array<{
    commandName: string;
    envVarName: string;
  }>;
};

export type CommandCheckExecutorResult = {
  resolved: Array<{
    commandName: string;
    envVarName: string;
    path: string;
  }>;
};

export const commandCheckExecutor: ExecutorDefinition<
  CommandCheckExecutorConfig,
  CommandCheckExecutorInput,
  CommandCheckExecutorResult
> = {
  kind: "command-check",
  version: 1,
  defaultConfig: {},
  async execute(context: ExecutorContext, input: CommandCheckExecutorInput) {
    return {
      resolved: input.commands.map((candidate) => ({
        commandName: candidate.commandName,
        envVarName: candidate.envVarName,
        path: context.runtime.resolveCmd(candidate.commandName, candidate.envVarName),
      })),
    };
  },
};
