import { existsSync, readFileSync } from "node:fs";

import { TaskRunnerError } from "../../errors.js";
import type { UserInputFieldDefinition, UserInputFormDefinition } from "../../user-input.js";
import type { PipelineNodeDefinition } from "../types.js";

type PlanningQuestionRecord = {
  id?: unknown;
  question?: unknown;
  details?: unknown;
  required?: unknown;
  multiline?: unknown;
  placeholder?: unknown;
};

type PlanningQuestionsArtifact = {
  summary?: unknown;
  questions?: unknown;
};

export type PlanningQuestionsFormNodeParams = {
  planningQuestionsJsonFile: string;
  formId: string;
  title: string;
  description?: string;
};

export type PlanningQuestionsFormNodeResult = UserInputFormDefinition & {
  summary: string;
  questionCount: number;
};

function normalizeQuestionId(value: unknown, index: number): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return `question_${index + 1}`;
}

function toQuestionField(question: PlanningQuestionRecord, index: number): UserInputFieldDefinition | null {
  if (typeof question.question !== "string" || question.question.trim().length === 0) {
    return null;
  }

  return {
    id: normalizeQuestionId(question.id, index),
    type: "text",
    label: question.question.trim(),
    ...(typeof question.details === "string" && question.details.trim().length > 0
      ? { help: question.details.trim() }
      : {}),
    required: question.required !== false,
    multiline: question.multiline === true,
    default: "",
    ...(typeof question.placeholder === "string" && question.placeholder.trim().length > 0
      ? { placeholder: question.placeholder.trim() }
      : {}),
  };
}

export const planningQuestionsFormNode: PipelineNodeDefinition<
  PlanningQuestionsFormNodeParams,
  PlanningQuestionsFormNodeResult
> = {
  kind: "planning-questions-form",
  version: 1,
  async run(_context, params) {
    if (!existsSync(params.planningQuestionsJsonFile)) {
      return {
        value: {
          formId: params.formId,
          title: params.title,
          ...(params.description ? { description: params.description } : {}),
          submitLabel: "Continue planning",
          fields: [],
          summary: "",
          questionCount: 0,
        },
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(params.planningQuestionsJsonFile, "utf8"));
    } catch (error) {
      throw new TaskRunnerError(
        `Failed to read planning questions from ${params.planningQuestionsJsonFile}: ${(error as Error).message}`,
      );
    }

    const artifact = parsed as PlanningQuestionsArtifact;
    const rawQuestions = Array.isArray(artifact.questions) ? artifact.questions : [];
    const fields = rawQuestions
      .map((question, index) => toQuestionField(question as PlanningQuestionRecord, index))
      .filter((field): field is UserInputFieldDefinition => field !== null);

    return {
      value: {
        formId: params.formId,
        title: params.title,
        ...(params.description ? { description: params.description } : {}),
        submitLabel: "Continue planning",
        fields,
        summary: typeof artifact.summary === "string" ? artifact.summary.trim() : "",
        questionCount: fields.length,
      },
    };
  },
};
