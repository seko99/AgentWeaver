import type { ExecutorContext, ExecutorDefinition, JsonObject } from "./types.js";
import { processExecutor } from "./process-executor.js";

export type VerifyBuildExecutorConfig = JsonObject & {
  service: string;
  composeFileFlag: string;
  runArgs: string[];
  printFailureOutput: boolean;
  verbose: boolean;
};

export type VerifyBuildExecutorInput = {
  dockerComposeFile: string;
};

export type VerifyBuildExecutorResult = {
  output: string;
  composeCommand: string[];
};

export const verifyBuildExecutor: ExecutorDefinition<
  VerifyBuildExecutorConfig,
  VerifyBuildExecutorInput,
  VerifyBuildExecutorResult
> = {
  kind: "verify-build",
  version: 1,
  defaultConfig: {
    service: "verify-build",
    composeFileFlag: "-f",
    runArgs: ["run", "--rm"],
    printFailureOutput: false,
    verbose: false,
  },
  async execute(context: ExecutorContext, input: VerifyBuildExecutorInput, config: VerifyBuildExecutorConfig) {
    const composeCommand = context.runtime.resolveDockerComposeCmd();
    const result = await processExecutor.execute(
      context,
      {
        argv: [...composeCommand, config.composeFileFlag, input.dockerComposeFile, ...config.runArgs, config.service],
        env: context.runtime.dockerRuntimeEnv(),
        verbose: config.verbose,
        label: config.service,
      },
      {
        printFailureOutput: config.printFailureOutput,
      },
    );
    return {
      output: result.output,
      composeCommand,
    };
  },
};
