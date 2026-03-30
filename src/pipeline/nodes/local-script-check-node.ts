import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

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
  outputFile?: string;
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

function fallbackStructuredResult(output: string, commandLabel: string, exitCode: number): LocalScriptCheckResult {
  return {
    ok: false,
    kind: "check",
    stage: commandLabel,
    exitCode,
    summary: `${commandLabel} failed`,
    command: commandLabel,
    details: output.trim().length > 0 ? { raw: output } : {},
  };
}

function persistStructuredResult(filePath: string, parsed: LocalScriptCheckResult): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

export const localScriptCheckNode: PipelineNodeDefinition<LocalScriptCheckNodeParams, { output: string; parsed: LocalScriptCheckResult }> = {
  kind: "local-script-check",
  version: 1,
  async run(context, params) {
    printInfo(params.labelText);
    const commandLabel = params.argv.join(" ");
    let output = "";
    let parsed: LocalScriptCheckResult;

    try {
      output = await context.runtime.runCommand(params.argv, {
        dryRun: context.dryRun,
        verbose: context.verbose,
        label: commandLabel,
        printFailureOutput: true,
        env: { ...context.env },
      });
      parsed = parseStructuredResult(output, commandLabel);
    } catch (error) {
      output = String((error as { output?: string }).output ?? "");
      const exitCode = Number((error as { returnCode?: number }).returnCode ?? 1);
      try {
        parsed = parseStructuredResult(output, commandLabel);
      } catch {
        parsed = fallbackStructuredResult(output, commandLabel, exitCode);
      }
    }

    if (params.outputFile) {
      persistStructuredResult(params.outputFile, parsed);
    }

    return {
      value: {
        output,
        parsed,
      },
    };
  },
};
