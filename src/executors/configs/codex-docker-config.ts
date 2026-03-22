import type { CodexDockerExecutorConfig } from "../codex-docker-executor.js";

export const codexDockerExecutorDefaultConfig: CodexDockerExecutorConfig = {
  service: "codex-exec",
  composeFileFlag: "-f",
  runArgs: ["run", "--rm"],
  modelEnvVar: "CODEX_MODEL",
  defaultModel: "gpt-5.4",
  promptEnvVar: "CODEX_PROMPT",
  flagsEnvVar: "CODEX_EXEC_FLAGS",
  execFlagsTemplate: "--model {model} --dangerously-bypass-approvals-and-sandbox",
};
