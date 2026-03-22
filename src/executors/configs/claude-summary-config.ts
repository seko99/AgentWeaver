import type { ClaudeSummaryExecutorConfig } from "../claude-summary-executor.js";

export const claudeSummaryExecutorDefaultConfig: ClaudeSummaryExecutorConfig = {
  commandEnvVar: "CLAUDE_BIN",
  defaultCommand: "claude",
  modelEnvVar: "CLAUDE_SUMMARY_MODEL",
  defaultModel: "haiku",
  promptFlag: "-p",
  allowedTools: "Read,Write,Edit",
};
