import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { opencodeExecutorDefaultConfig } from "./configs/opencode-config.js";
import type { ExecutorContext, ExecutorDefinition, JsonObject } from "./types.js";
import { processExecutor } from "./process-executor.js";

export type OpenCodeExecutorConfig = JsonObject & {
  commandEnvVar: string;
  defaultCommand: string;
  modelEnvVar: string;
  subcommand: string;
};

export type OpenCodeExecutorInput = {
  prompt: string;
  command?: string;
  model?: string;
  env?: NodeJS.ProcessEnv;
};

export type OpenCodeExecutorResult = {
  output: string;
  command: string;
  model?: string;
};

function resolveModel(config: OpenCodeExecutorConfig, inputModel: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
  const explicitModel = inputModel?.trim();
  if (explicitModel) {
    return explicitModel;
  }
  const envModel = env[config.modelEnvVar]?.trim();
  return envModel || undefined;
}

export const opencodeExecutor: ExecutorDefinition<OpenCodeExecutorConfig, OpenCodeExecutorInput, OpenCodeExecutorResult> = {
  kind: "opencode",
  version: 1,
  defaultConfig: opencodeExecutorDefaultConfig,
  async execute(context: ExecutorContext, input: OpenCodeExecutorInput, config: OpenCodeExecutorConfig) {
    const env = input.env ?? context.env;
    const command = input.command ?? context.runtime.resolveCmd(config.defaultCommand, config.commandEnvVar);
    const model = resolveModel(config, input.model, env);
    const argv = [command, config.subcommand];
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "agentweaver-opencode-"));
    const promptFile = path.join(tempDir, "prompt.md");
    writeFileSync(promptFile, input.prompt, "utf8");
    if (model) {
      argv.push("--model", model);
    }
    argv.push(
      "--file",
      promptFile,
      "--",
      "Use the attached file as the full task prompt. Follow it exactly.",
    );

    try {
      const result = await processExecutor.execute(
        context,
        {
          argv,
          env,
          label: model ? `opencode:${model}` : "opencode",
        },
        processExecutor.defaultConfig,
      );
      return {
        output: result.output,
        command,
        ...(model ? { model } : {}),
      };
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  },
};
