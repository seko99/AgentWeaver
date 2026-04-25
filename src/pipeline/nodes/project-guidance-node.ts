import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { buildLogicalKeyForPayload } from "../../artifact-manifest.js";
import { TaskRunnerError } from "../../errors.js";
import { buildProjectGuidance, renderProjectGuidanceMarkdown, type InvalidPlaybookPolicy } from "../../runtime/project-guidance.js";
import { validateStructuredArtifactValue } from "../../structured-artifacts.js";
import type { PipelineNodeDefinition } from "../types.js";

export type ProjectGuidanceNodeParams = {
  taskContextJsonFile: string;
  phase: string;
  outputJsonFile: string;
  outputFile: string;
  markdownLanguage?: "en" | "ru" | null;
  budgetLimit?: number;
  inlineThreshold?: number;
  invalidPlaybookPolicy?: InvalidPlaybookPolicy;
};

export type ProjectGuidanceNodeResult = {
  status: string;
  phase: string;
  outputJsonFile: string;
  outputFile: string;
};

function readTaskContext(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new TaskRunnerError(`Failed to read task context JSON ${filePath}: ${(error as Error).message}`);
  }
}

export const projectGuidanceNode: PipelineNodeDefinition<ProjectGuidanceNodeParams, ProjectGuidanceNodeResult> = {
  kind: "project-guidance",
  version: 1,
  async run(context, params) {
    const taskContext = readTaskContext(params.taskContextJsonFile);
    const guidance = buildProjectGuidance({
      projectRoot: context.cwd,
      taskContext,
      phase: params.phase,
      ...(params.budgetLimit !== undefined ? { budgetLimit: params.budgetLimit } : {}),
      ...(params.inlineThreshold !== undefined ? { inlineThreshold: params.inlineThreshold } : {}),
      invalidPlaybookPolicy: params.invalidPlaybookPolicy ?? "fail_before_prompt",
    });
    validateStructuredArtifactValue(guidance, "project-guidance/v1", params.outputJsonFile);
    mkdirSync(path.dirname(params.outputJsonFile), { recursive: true });
    writeFileSync(params.outputJsonFile, `${JSON.stringify(guidance, null, 2)}\n`, "utf8");

    const markdown = renderProjectGuidanceMarkdown(guidance, params.markdownLanguage ?? context.mdLang ?? "en");
    mkdirSync(path.dirname(params.outputFile), { recursive: true });
    writeFileSync(params.outputFile, markdown, "utf8");

    return {
      value: {
        status: guidance.status,
        phase: guidance.phase,
        outputJsonFile: params.outputJsonFile,
        outputFile: params.outputFile,
      },
      outputs: [
        {
          kind: "artifact" as const,
          path: params.outputJsonFile,
          required: true,
          manifest: {
            publish: true,
            logicalKey: buildLogicalKeyForPayload(context.issueKey, params.outputJsonFile),
            payloadFamily: "structured-json" as const,
            schemaId: "project-guidance/v1",
            schemaVersion: 1,
          },
        },
        {
          kind: "artifact" as const,
          path: params.outputFile,
          required: true,
          manifest: {
            publish: true,
            logicalKey: buildLogicalKeyForPayload(context.issueKey, params.outputFile),
            payloadFamily: "markdown" as const,
            schemaId: "markdown/v1",
            schemaVersion: 1,
          },
        },
      ],
    };
  },
};
