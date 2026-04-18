import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { buildLogicalKeyForPayload } from "../../artifact-manifest.js";
import { TaskRunnerError } from "../../errors.js";
import type { UserInputFieldDefinition, UserInputFormDefinition, UserInputFormValues } from "../../user-input.js";
import { validateUserInputValues } from "../../user-input.js";
import type { PipelineNodeDefinition } from "../types.js";

export type CommitMessageFormNodeParams = {
  commitMessageFile: string;
  formId: string;
  title: string;
  description?: string;
  outputFile: string;
};

export type CommitMessageFormNodeResult = {
  formId: string;
  submittedAt: string;
  values: UserInputFormValues;
  outputFile: string;
};

export type CommitMessage = {
  subject: string;
};

function parseCommitMessage(content: string): CommitMessage {
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed === "object" && parsed !== null) {
      return {
        subject: typeof parsed.subject === "string" ? parsed.subject : "",
      };
    }
  } catch {
    // Fallback to plain text
  }
  return { subject: content.trim() };
}

export const commitMessageFormNode: PipelineNodeDefinition<CommitMessageFormNodeParams, CommitMessageFormNodeResult> = {
  kind: "commit-message-form",
  version: 1,
  async run(context, params) {
    let commitMessage: CommitMessage;
    try {
      const messageContent = readFileSync(params.commitMessageFile, "utf8");
      commitMessage = parseCommitMessage(messageContent);
    } catch (error) {
      throw new TaskRunnerError(
        `Failed to read commit message from ${params.commitMessageFile}: ${(error as Error).message}`,
      );
    }

    const form: UserInputFormDefinition = {
      formId: params.formId,
      title: params.title,
      ...(params.description ? { description: params.description } : {}),
      submitLabel: "Commit",
      fields: [
        {
          id: "commit_message",
          type: "text",
          label: "Commit message",
          help: "Format: {taskKey}: {taskDescription}. Subject ≤72 chars.",
          required: true,
          multiline: false,
          default: commitMessage.subject,
        },
      ],
    };

    const requester = context.requestUserInput ?? (await import("../../user-input.js")).requestUserInputInTerminal;
    const result = await requester(form);

    const commitMessageValue = result.values.commit_message;

    if (typeof commitMessageValue !== "string" || commitMessageValue.trim().length === 0) {
      throw new TaskRunnerError("Commit message is required.");
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
          manifest: {
            publish: true,
            logicalKey: buildLogicalKeyForPayload(context.issueKey, params.outputFile),
            payloadFamily: "structured-json",
            schemaId: "user-input/v1",
            schemaVersion: 1,
          },
        },
      ],
    };
  },
};
