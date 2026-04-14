import { processExecutorDefaultConfig } from "./configs/process-config.js";
import type { ExecutorContext, ExecutorDefinition, JsonObject } from "./types.js";

export type ProcessExecutorConfig = JsonObject & {
  printFailureOutput: boolean;
};

export type ProcessExecutorInput = {
  argv: string[];
  env?: NodeJS.ProcessEnv;
  dryRun?: boolean;
  verbose?: boolean;
  label?: string;
  stdin?: string;
};

export type ProcessExecutorResult = {
  output: string;
};

export const processExecutor: ExecutorDefinition<ProcessExecutorConfig, ProcessExecutorInput, ProcessExecutorResult> = {
  kind: "process",
  version: 1,
  defaultConfig: processExecutorDefaultConfig,
  async execute(context: ExecutorContext, input: ProcessExecutorInput, config: ProcessExecutorConfig) {
    const options: Parameters<ExecutorContext["runtime"]["runCommand"]>[1] = {
      dryRun: input.dryRun ?? context.dryRun,
      verbose: input.verbose ?? context.verbose,
      printFailureOutput: config.printFailureOutput,
    };
    if (input.env) {
      options.env = input.env;
    }
    if (input.label) {
      options.label = input.label;
    }
    if (input.stdin !== undefined) {
      options.stdin = input.stdin;
    }
    const output = await context.runtime.runCommand(input.argv, options);
    return { output };
  },
};
