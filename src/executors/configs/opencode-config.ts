import type { OpenCodeExecutorConfig } from "../opencode-executor.js";

export const opencodeExecutorDefaultConfig: OpenCodeExecutorConfig = {
  commandEnvVar: "OPENCODE_BIN",
  defaultCommand: "opencode",
  modelEnvVar: "OPENCODE_MODEL",
  subcommand: "run",
};
