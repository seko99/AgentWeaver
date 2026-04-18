import { writeFileSync } from "node:fs";

import { TaskRunnerError } from "../../errors.js";
import { buildLogicalKeyForPayload } from "../../artifact-manifest.js";
import { printSummary } from "../../tui.js";
import {
  requestUserInputInTerminal,
  validateUserInputValues,
  type UserInputFieldDefinition,
  type UserInputFormDefinition,
  type UserInputFormValues,
} from "../../user-input.js";
import type { PipelineNodeDefinition } from "../types.js";

export type UserInputNodeParams = {
  formId: string;
  title: string;
  description?: string;
  submitLabel?: string;
  fields: UserInputFieldDefinition[];
  outputFile: string;
};

export type UserInputNodeResult = {
  formId: string;
  submittedAt: string;
  values: UserInputFormValues;
  outputFile: string;
  promptSuffix: string;
  summaryText: string;
};

function labelForSingleValue(field: UserInputFieldDefinition, value: string): string {
  if (field.type !== "single-select" && field.type !== "multi-select") {
    return value;
  }
  return field.options.find((option) => option.value === value)?.label ?? value;
}

function buildReviewFixPromptSuffix(
  params: UserInputNodeParams,
  values: UserInputFormValues,
): { promptSuffix: string; summaryText: string } {
  const applyAll = values.apply_all === true;
  const selectedFindings = Array.isArray(values.selected_findings)
    ? values.selected_findings.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const extraNotes = typeof values.extra_notes === "string" ? values.extra_notes.trim() : "";

  if (!applyAll && selectedFindings.length === 0) {
    throw new TaskRunnerError("Review-fix requires selecting at least one finding or enabling 'apply all'.");
  }

  const selectionSummary = applyAll
    ? "All findings selected."
    : `Selected findings:\n- ${selectedFindings.join("\n- ")}`;
  const promptSuffix = [
    "Use the user selection below as source of truth for the current review-fix scope.",
    `Selection file: ${params.outputFile}`,
    `apply_all: ${applyAll ? "true" : "false"}`,
    applyAll ? "Fix all findings in the current iteration." : `Fix only selected findings:\n- ${selectedFindings.join("\n- ")}`,
    extraNotes ? `User additional instructions:\n${extraNotes}` : "",
  ]
    .filter((item) => item.trim().length > 0)
    .join("\n\n");
  const summaryText = extraNotes ? `${selectionSummary}\n\nNote:\n${extraNotes}` : selectionSummary;
  return { promptSuffix, summaryText };
}

function buildTaskDescribePromptSuffix(
  params: UserInputNodeParams,
  values: UserInputFormValues,
): { promptSuffix: string; summaryText: string } {
  const jiraRef = typeof values.jira_ref === "string" ? values.jira_ref.trim() : "";
  const taskDescription = typeof values.task_description === "string" ? values.task_description.trim() : "";
  const additionalInstructions =
    typeof values.additional_instructions === "string" ? values.additional_instructions.trim() : "";

  if (jiraRef) {
    return {
      promptSuffix: additionalInstructions
        ? [
            "Use the user-provided additional instructions together with the Jira task.",
            `User input file: ${params.outputFile}`,
            `Additional instructions:\n${additionalInstructions}`,
          ].join("\n\n")
        : "",
      summaryText: additionalInstructions
        ? `Task source: Jira\nJira: ${jiraRef}\n\nAdditional instructions:\n${additionalInstructions}`
        : `Task source: Jira\nJira: ${jiraRef}`,
    };
  }

  return {
    promptSuffix: [
      "Use the user task description as source of truth.",
      `User input file: ${params.outputFile}`,
      `Task description:\n${taskDescription}`,
      additionalInstructions ? `Additional instructions:\n${additionalInstructions}` : "",
    ]
      .filter((item) => item.trim().length > 0)
      .join("\n\n"),
    summaryText: additionalInstructions
      ? `Task source: user-input\n\n${taskDescription}\n\nAdditional instructions:\n${additionalInstructions}`
      : `Task source: user-input\n\n${taskDescription}`,
  };
}

function buildPromptSuffix(params: UserInputNodeParams, values: UserInputFormValues): { promptSuffix: string; summaryText: string } {
  if (params.formId === "review-fix-selection") {
    return buildReviewFixPromptSuffix(params, values);
  }

  if (params.formId === "task-describe-source-input") {
    return buildTaskDescribePromptSuffix(params, values);
  }

  if (params.fields.length === 0) {
    return {
      promptSuffix: "",
      summaryText: "",
    };
  }

  const lines = params.fields.map((field) => {
    const raw = values[field.id];
    if (typeof raw === "boolean") {
      return `${field.label}: ${raw ? "yes" : "no"}`;
    }
    if (typeof raw === "string") {
      return `${field.label}: ${raw || "-"}`;
    }
    if (Array.isArray(raw)) {
      const labels = raw.map((item) => labelForSingleValue(field, item));
      return `${field.label}: ${labels.length > 0 ? labels.join(", ") : "-"}`;
    }
    return `${field.label}: -`;
  });
  const summaryText = lines.join("\n");
  return {
    promptSuffix: `Use user input from file ${params.outputFile}.\n\n${summaryText}`,
    summaryText,
  };
}

export const userInputNode: PipelineNodeDefinition<UserInputNodeParams, UserInputNodeResult> = {
  kind: "user-input",
  version: 1,
  async run(context, params) {
    const form: UserInputFormDefinition = {
      formId: params.formId,
      title: params.title,
      ...(params.description ? { description: params.description } : {}),
      ...(params.submitLabel ? { submitLabel: params.submitLabel } : {}),
      fields: params.fields,
    };

    const requester = context.requestUserInput ?? requestUserInputInTerminal;
    const result = await requester(form);
    validateUserInputValues(form, result.values);
    const rendered = buildPromptSuffix(params, result.values);
    const artifact = {
      form_id: result.formId,
      submitted_at: result.submittedAt,
      values: result.values,
    };
    writeFileSync(params.outputFile, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    if (rendered.summaryText.trim().length > 0) {
      printSummary(params.title, rendered.summaryText);
    }
    return {
      value: {
        formId: result.formId,
        submittedAt: result.submittedAt,
        values: result.values,
        outputFile: params.outputFile,
        promptSuffix: rendered.promptSuffix,
        summaryText: rendered.summaryText,
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
