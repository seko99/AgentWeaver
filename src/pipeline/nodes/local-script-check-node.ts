import { TaskRunnerError } from "../../errors.js";
import { printInfo } from "../../tui.js";
import type { JsonObject } from "../../executors/types.js";
import type { PipelineNodeDefinition } from "../types.js";

export type LocalScriptCheckResult = {
  ok: boolean;
  kind: string;
  stage: string;
  exitCode: number;
  summary: string;
  command: string;
  details: JsonObject;
};

export type LocalScriptCheckNodeParams = {
  argv: string[];
  labelText: string;
};

function parseStructuredResult(output: string, commandLabel: string): LocalScriptCheckResult {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.replace(/\u001b\[[0-9;]*m/g, "").trim())
    .filter(Boolean);

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

  throw new TaskRunnerError(`Structured result is missing or invalid in output of '${commandLabel}'.`);
}

export const localScriptCheckNode: PipelineNodeDefinition<LocalScriptCheckNodeParams, { output: string; parsed: LocalScriptCheckResult }> = {
  kind: "local-script-check",
  version: 1,
  async run(context, params) {
    printInfo(params.labelText);
    const output = await context.runtime.runCommand(params.argv, {
      dryRun: context.dryRun,
      verbose: context.verbose,
      label: params.argv.join(" "),
      printFailureOutput: true,
      env: { ...context.env },
    });

    return {
      value: {
        output,
        parsed: parseStructuredResult(output, params.argv.join(" ")),
      },
    };
  },
};
