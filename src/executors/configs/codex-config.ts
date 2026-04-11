import type { CodexExecutorConfig } from "../codex-executor.js";

export const codexExecutorDefaultConfig: CodexExecutorConfig = {
  commandEnvVar: "CODEX_BIN",
  defaultCommand: "codex",
  modelEnvVar: "CODEX_MODEL",
  defaultModel: "gpt-5.4",
  subcommand: "exec",
  fullAutoFlag: "--full-auto",
};
