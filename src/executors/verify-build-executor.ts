import { verifyBuildExecutorDefaultConfig } from "./configs/verify-build-config.js";
import { TaskRunnerError } from "../errors.js";
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
  service?: string;
};

export type VerifyBuildStructuredResult = JsonObject & {
  ok: boolean;
  kind: string;
  stage: string;
  exitCode: number;
  summary: string;
  command: string;
  details: JsonObject;
};

export type VerifyBuildExecutorResult = {
  output: string;
  composeCommand: string[];
  parsed: VerifyBuildStructuredResult;
};

function parseStructuredResult(output: string, service: string): VerifyBuildStructuredResult {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.replace(/\u001b\[[0-9;]*m/g, "").trim())
    .filter(Boolean);
  if (lines.length === 0) {
    throw new TaskRunnerError(`Structured result is missing from service '${service}' output.`);
  }

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }

    const candidates: string[] = [];
    if (line.startsWith("{") && line.endsWith("}")) {
      candidates.push(line);
    }
    const firstBrace = line.indexOf("{");
    const lastBrace = line.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const slice = line.slice(firstBrace, lastBrace + 1).trim();
      if (slice && !candidates.includes(slice)) {
        candidates.push(slice);
      }
    }

    for (const rawJson of candidates) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawJson);
      } catch {
        continue;
      }

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        continue;
      }

      const candidate = parsed as Record<string, unknown>;
      if (
        typeof candidate.ok !== "boolean" ||
        typeof candidate.kind !== "string" ||
        typeof candidate.stage !== "string" ||
        typeof candidate.exitCode !== "number" ||
        typeof candidate.summary !== "string" ||
        typeof candidate.command !== "string"
      ) {
        continue;
      }

      const details = candidate.details;
      if (details !== undefined && (!details || typeof details !== "object" || Array.isArray(details))) {
        continue;
      }

      return {
        ok: candidate.ok,
        kind: candidate.kind,
        stage: candidate.stage,
        exitCode: candidate.exitCode,
        summary: candidate.summary,
        command: candidate.command,
        details: (details as JsonObject | undefined) ?? {},
      };
    }
  }

  throw new TaskRunnerError(`Structured result is missing or invalid in service '${service}' output.`);
}

export const verifyBuildExecutor: ExecutorDefinition<
  VerifyBuildExecutorConfig,
  VerifyBuildExecutorInput,
  VerifyBuildExecutorResult
> = {
  kind: "verify-build",
  version: 1,
  defaultConfig: verifyBuildExecutorDefaultConfig,
  async execute(context: ExecutorContext, input: VerifyBuildExecutorInput, config: VerifyBuildExecutorConfig) {
    const composeCommand = context.runtime.resolveDockerComposeCmd();
    const service = input.service ?? config.service;
    if (context.dryRun) {
      await processExecutor.execute(
        context,
        {
          argv: [...composeCommand, config.composeFileFlag, input.dockerComposeFile, ...config.runArgs, service],
          env: context.runtime.dockerRuntimeEnv(),
          verbose: config.verbose,
          label: service,
        },
        {
          printFailureOutput: config.printFailureOutput,
        },
      );
      return {
        output: "",
        composeCommand,
        parsed: {
          ok: true,
          kind: service,
          stage: "dry_run",
          exitCode: 0,
          summary: `Dry run for service '${service}'`,
          command: [...composeCommand, config.composeFileFlag, input.dockerComposeFile, ...config.runArgs, service].join(" "),
          details: {},
        },
      };
    }

    let output = "";
    let exitCode = 0;
    try {
      const result = await processExecutor.execute(
        context,
        {
          argv: [...composeCommand, config.composeFileFlag, input.dockerComposeFile, ...config.runArgs, service],
          env: context.runtime.dockerRuntimeEnv(),
          verbose: config.verbose,
          label: service,
        },
        {
          printFailureOutput: config.printFailureOutput,
        },
      );
      output = result.output;
    } catch (error) {
      output = String((error as { output?: string }).output ?? "");
      exitCode = Number((error as { returnCode?: number }).returnCode ?? 1);
    }

    const parsed = parseStructuredResult(output, service);
    if (parsed.exitCode !== exitCode && exitCode !== 0) {
      throw new TaskRunnerError(
        `Structured result exit code mismatch for service '${service}': script=${parsed.exitCode}, runtime=${exitCode}.`,
      );
    }
    return {
      output,
      composeCommand,
      parsed,
    };
  },
};
