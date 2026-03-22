import type { VerifyBuildExecutorConfig } from "../verify-build-executor.js";

export const verifyBuildExecutorDefaultConfig: VerifyBuildExecutorConfig = {
  service: "verify-build",
  composeFileFlag: "-f",
  runArgs: ["run", "--rm"],
  printFailureOutput: false,
  verbose: false,
};
