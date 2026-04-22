import { AGENTWEAVER_PLUGIN_SDK_VERSION } from "agentweaver/plugin-sdk";

export const CLAUDE_EXAMPLE_PLUGIN_SDK_VERSION = AGENTWEAVER_PLUGIN_SDK_VERSION;
export const CLAUDE_EXECUTOR_ID = "claude";
export const CLAUDE_AUTH_STATUS_ERROR = "Claude CLI authentication is required. Run 'claude auth status' and sign in before using the example flow.";
export const CLAUDE_NORMALIZATION_ERROR =
  "Claude JSON normalization failed: no supported assistant text was found in result, message.content[*].text, or content[*].text.";

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function resolveSetting(override, env, envKey, defaultValue) {
  const direct = nonEmptyString(typeof override === "number" ? String(override) : override);
  if (direct) {
    return direct;
  }
  const fromEnv = nonEmptyString(env?.[envKey]);
  if (fromEnv) {
    return fromEnv;
  }
  return nonEmptyString(defaultValue);
}

function extractTextFragments(items) {
  if (!Array.isArray(items)) {
    return null;
  }
  const fragments = items
    .map((item) => (item && typeof item === "object" ? item.text : undefined))
    .filter((text) => typeof text === "string" && text.trim().length > 0);
  return fragments.length > 0 ? fragments.join("\n") : null;
}

export function normalizeClaudePayload(payload, effectiveModel = "") {
  const resultText = nonEmptyString(payload?.result);
  const messageContentText = extractTextFragments(payload?.message?.content);
  const contentText = extractTextFragments(payload?.content);
  const output = resultText ?? messageContentText ?? contentText;
  if (!output) {
    throw new Error(CLAUDE_NORMALIZATION_ERROR);
  }
  return {
    output,
    model: nonEmptyString(payload?.model) ?? effectiveModel,
    rawResponse: payload,
  };
}

export async function verifyClaudeAuth(runtime, env, config) {
  const command = runtime.resolveCmd(config.defaultCommand, config.commandEnvVar);
  try {
    await runtime.runCommand([command, "auth", "status"], {
      env,
      label: "claude:auth-status",
      printFailureOutput: false,
    });
  } catch {
    throw new Error(CLAUDE_AUTH_STATUS_ERROR);
  }
  return command;
}

export const claudeExecutorDefinition = {
  kind: CLAUDE_EXECUTOR_ID,
  version: 1,
  defaultConfig: {
    commandEnvVar: "CLAUDE_BIN",
    defaultCommand: "claude",
    modelEnvVar: "CLAUDE_MODEL",
    defaultModel: "",
    maxTurnsEnvVar: "CLAUDE_MAX_TURNS",
    defaultMaxTurns: "",
  },
  async execute(context, input, config) {
    const env = input?.env ?? context.env;
    const command = input?.command ?? context.runtime.resolveCmd(config.defaultCommand, config.commandEnvVar);
    const effectiveModel = resolveSetting(input?.model, env, config.modelEnvVar, config.defaultModel);
    const effectiveMaxTurns = resolveSetting(input?.maxTurns, env, config.maxTurnsEnvVar, config.defaultMaxTurns);
    const argv = [
      command,
      "-p",
      String(input?.prompt ?? ""),
      "--output-format",
      "json",
      ...(effectiveModel ? ["--model", effectiveModel] : []),
      ...(effectiveMaxTurns ? ["--max-turns", effectiveMaxTurns] : []),
    ];
    const stdout = await context.runtime.runCommand(argv, {
      env,
      dryRun: context.dryRun,
      verbose: context.verbose,
      label: `claude:${effectiveModel || "default"}`,
      printFailureOutput: true,
    });
    let payload;
    try {
      payload = JSON.parse(stdout);
    } catch (error) {
      throw new Error(`Claude CLI returned invalid JSON: ${error.message}`);
    }
    const normalized = normalizeClaudePayload(payload, effectiveModel ?? "");
    return {
      output: normalized.output,
      command,
      model: normalized.model ?? "",
      rawResponse: normalized.rawResponse,
    };
  },
};

export const executors = [
  {
    id: CLAUDE_EXECUTOR_ID,
    definition: claudeExecutorDefinition,
    routing: {
      kind: "llm",
      defaultModel: "sonnet",
      models: ["sonnet", "opus", "haiku"],
    },
  },
];
