import type { CodexLocalExecutorConfig } from "../codex-local-executor.js";

export const codexLocalExecutorDefaultConfig: CodexLocalExecutorConfig = {
  commandEnvVar: "CODEX_BIN",
  defaultCommand: "codex",
  modelEnvVar: "CODEX_MODEL",
  defaultModel: "gpt-5.4",
  subcommand: "exec",
  fullAutoFlag: "--full-auto",
};
