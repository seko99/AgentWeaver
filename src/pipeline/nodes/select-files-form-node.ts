import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { TaskRunnerError } from "../../errors.js";
import type { UserInputFieldDefinition, UserInputFormDefinition, UserInputFormValues } from "../../user-input.js";
import { validateUserInputValues } from "../../user-input.js";
import type { PipelineNodeDefinition } from "../types.js";
import type { GitStatusFileEntry } from "./git-status-node.js";

export type SelectFilesFormNodeParams = {
  gitStatusJsonFile: string;
  formId: string;
  title: string;
  description?: string;
  outputFile: string;
};

export type SelectFilesFormNodeResult = {
  formId: string;
  submittedAt: string;
  values: UserInputFormValues;
  outputFile: string;
};

export const selectFilesFormNode: PipelineNodeDefinition<SelectFilesFormNodeParams, SelectFilesFormNodeResult> = {
  kind: "select-files-form",
  version: 1,
  async run(context, params) {
    let gitStatusFiles: GitStatusFileEntry[];
    try {
      const statusContent = readFileSync(params.gitStatusJsonFile, "utf8");
      const statusParsed = JSON.parse(statusContent);
      gitStatusFiles = (statusParsed.files ?? []) as GitStatusFileEntry[];
    } catch (error) {
      throw new TaskRunnerError(
        `Failed to read git status from ${params.gitStatusJsonFile}: ${(error as Error).message}`,
      );
    }

    const fileOptions = gitStatusFiles.map((file): { value: string; label: string } => ({
      value: file.file,
      label: file.originalFile
        ? `${file.xy} ${file.originalFile} -> ${file.file}`
        : `${file.xy} ${file.file}`,
    }));

    const form: UserInputFormDefinition = {
      formId: params.formId,
      title: params.title,
      ...(params.description ? { description: params.description } : {}),
      submitLabel: "Next",
      fields: [
        {
          id: "selected_files",
          type: "multi-select",
          label: "Select files to commit",
          help: "Choose the files you want to include in this commit",
          required: true,
          options: fileOptions,
          default: gitStatusFiles.map((f) => f.file),
        },
      ],
    };

    const requester = context.requestUserInput ?? (await import("../../user-input.js")).requestUserInputInTerminal;
    const result = await requester(form);

    const selectedFilesValue = result.values.selected_files;

    if (!Array.isArray(selectedFilesValue) || selectedFilesValue.length === 0) {
      throw new TaskRunnerError("At least one file must be selected for commit.");
    }

    validateUserInputValues(form, result.values);

    const outputDir = path.dirname(params.outputFile);
    mkdirSync(outputDir, { recursive: true });

    const outputContent = {
      form_id: result.formId,
      submitted_at: result.submittedAt,
      values: result.values,
    };
    writeFileSync(params.outputFile, `${JSON.stringify(outputContent, null, 2)}\n`, "utf8");

    return {
      value: {
        formId: result.formId,
        submittedAt: result.submittedAt,
        values: result.values,
        outputFile: params.outputFile,
      },
      outputs: [
        {
          kind: "artifact",
          path: params.outputFile,
          required: true,
        },
      ],
    };
  },
};