import type { ClaudeExecutorConfig } from "../claude-executor.js";

export const claudeExecutorDefaultConfig: ClaudeExecutorConfig = {
  commandEnvVar: "CLAUDE_BIN",
  defaultCommand: "claude",
  modelEnvVar: "CLAUDE_REVIEW_MODEL",
  defaultModel: "opus",
  promptFlag: "-p",
  allowedTools: "Read,Write,Edit",
  outputFormat: "stream-json",
  includePartialMessages: true,
  verboseMode: true,
};
