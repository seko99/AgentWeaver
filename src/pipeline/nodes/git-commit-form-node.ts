import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { TaskRunnerError } from "../../errors.js";
import type { UserInputFieldDefinition, UserInputFormDefinition, UserInputFormValues } from "../../user-input.js";
import { validateUserInputValues } from "../../user-input.js";
import type { PipelineNodeDefinition } from "../types.js";
import type { GitStatusFileEntry } from "./git-status-node.js";

export type GitCommitFormNodeParams = {
  gitStatusJsonFile: string;
  commitMessageFile: string;
  formId: string;
  title: string;
  description?: string;
  outputFile: string;
};

export type GitCommitFormNodeResult = {
  formId: string;
  submittedAt: string;
  values: UserInputFormValues;
  outputFile: string;
};

export type CommitMessage = {
  subject: string;
  body?: string;
};

function parseCommitMessage(content: string): CommitMessage {
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed === "object" && parsed !== null) {
      const result: CommitMessage = {
        subject: typeof parsed.subject === "string" ? parsed.subject : "",
      };
      if (typeof parsed.body === "string" && parsed.body.trim().length > 0) {
        result.body = parsed.body.trim();
      }
      return result;
    }
  } catch {
    // Fallback to plain text
  }
  return { subject: content.trim(), body: "" };
}

export const gitCommitFormNode: PipelineNodeDefinition<GitCommitFormNodeParams, GitCommitFormNodeResult> = {
  kind: "git-commit-form",
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

    let commitMessage: CommitMessage;
    try {
      const messageContent = readFileSync(params.commitMessageFile, "utf8");
      commitMessage = parseCommitMessage(messageContent);
    } catch (error) {
      throw new TaskRunnerError(
        `Failed to read commit message from ${params.commitMessageFile}: ${(error as Error).message}`,
      );
    }

    const fileOptions = gitStatusFiles.map((file): { value: string; label: string } => ({
      value: file.file,
      label: file.originalFile
        ? `${file.xy} ${file.originalFile} -> ${file.file}`
        : `${file.xy} ${file.file}`,
    }));

    const defaultCommitMessage = commitMessage.body
      ? `${commitMessage.subject}\n\n${commitMessage.body}`
      : commitMessage.subject;

    const form: UserInputFormDefinition = {
      formId: params.formId,
      title: params.title,
      ...(params.description ? { description: params.description } : {}),
      submitLabel: "Commit",
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
        {
          id: "commit_message",
          type: "text",
          label: "Commit message",
          help: "Edit the commit message if needed. Subject ≤72 chars, conventional commits format.",
          required: true,
          multiline: true,
          rows: 8,
          default: defaultCommitMessage,
        },
        {
          id: "confirm",
          type: "boolean",
          label: "Confirm commit",
          help: "Set to true to proceed with the commit",
          required: true,
          default: true,
        },
      ],
    };

    const requester = context.requestUserInput ?? (await import("../../user-input.js")).requestUserInputInTerminal;
    const result = await requester(form);

    const commitMessageValue = result.values.commit_message;
    const selectedFilesValue = result.values.selected_files;
    const confirmValue = result.values.confirm;

    if (!Array.isArray(selectedFilesValue) || selectedFilesValue.length === 0) {
      throw new TaskRunnerError("At least one file must be selected for commit.");
    }

    if (typeof commitMessageValue !== "string" || commitMessageValue.trim().length === 0) {
      throw new TaskRunnerError("Commit message is required.");
    }

    if (typeof confirmValue !== "boolean" || !confirmValue) {
      throw new TaskRunnerError("Commit must be confirmed.");
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
