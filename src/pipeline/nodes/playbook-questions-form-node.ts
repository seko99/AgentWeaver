import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { buildLogicalKeyForPayload } from "../../artifact-manifest.js";
import { TaskRunnerError } from "../../errors.js";
import { validateStructuredArtifactValue } from "../../structured-artifacts.js";
import { requestUserInputInTerminal, type UserInputFieldDefinition, type UserInputFormValues } from "../../user-input.js";
import type { PipelineNodeDefinition } from "../types.js";

type PlaybookQuestion = {
  id?: unknown;
  text?: unknown;
  rationale?: unknown;
  candidate_ids?: unknown;
  evidence_paths?: unknown;
  answer_kind?: unknown;
};

type PlaybookQuestionsArtifact = {
  summary?: unknown;
  questions?: unknown;
};

type PlaybookAnswersArtifact = {
  summary: string;
  answered_at: string;
  answers: Array<{ question_id: string; answer: string }>;
  final_write_accepted: boolean;
};

export type PlaybookQuestionsFormNodeParams = {
  questionsJsonFile: string;
  answersJsonFile: string;
  formId: string;
  title: string;
  mode?: "clarifications" | "acceptance";
  acceptDraft?: boolean;
};

export type PlaybookQuestionsFormNodeResult = {
  formId: string;
  questionCount: number;
  finalWriteAccepted: boolean;
  outputFile: string;
};

function nowIso8601(): string {
  return new Date().toISOString();
}

function readQuestions(filePath: string): PlaybookQuestion[] {
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as PlaybookQuestionsArtifact;
    return Array.isArray(parsed.questions) ? parsed.questions as PlaybookQuestion[] : [];
  } catch (error) {
    throw new TaskRunnerError(`Failed to read playbook questions from ${filePath}: ${(error as Error).message}`);
  }
}

function readExistingAnswers(filePath: string): PlaybookAnswersArtifact | null {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as PlaybookAnswersArtifact;
  } catch (error) {
    throw new TaskRunnerError(`Failed to read playbook answers from ${filePath}: ${(error as Error).message}`);
  }
}

function fieldForQuestion(question: PlaybookQuestion, index: number): UserInputFieldDefinition | null {
  const text = typeof question.text === "string" ? question.text.trim() : "";
  if (!text) {
    return null;
  }
  const id = typeof question.id === "string" && question.id.trim() ? question.id.trim() : `question_${index + 1}`;
  return {
    id,
    type: "text",
    label: text,
    required: false,
    multiline: true,
    default: "",
    ...(typeof question.rationale === "string" && question.rationale.trim() ? { help: question.rationale.trim() } : {}),
  };
}

function answersFromValues(fields: UserInputFieldDefinition[], values: UserInputFormValues): Array<{ question_id: string; answer: string }> {
  return fields.map((field) => {
    const value = values[field.id];
    return {
      question_id: field.id,
      answer: typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value),
    };
  });
}

function writeAnswers(filePath: string, artifact: PlaybookAnswersArtifact): void {
  validateStructuredArtifactValue(artifact, "playbook-answers/v1", filePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
}

export const playbookQuestionsFormNode: PipelineNodeDefinition<
  PlaybookQuestionsFormNodeParams,
  PlaybookQuestionsFormNodeResult
> = {
  kind: "playbook-questions-form",
  version: 1,
  async run(context, params) {
    const mode = params.mode ?? "clarifications";
    const existing = readExistingAnswers(params.answersJsonFile);
    if (mode === "acceptance") {
      let finalWriteAccepted = params.acceptDraft === true;
      const interactive = context.requestUserInput !== requestUserInputInTerminal || (process.stdin.isTTY && process.stdout.isTTY);
      if (params.acceptDraft !== true && interactive) {
        const result = await (context.requestUserInput ?? requestUserInputInTerminal)({
          formId: params.formId,
          title: params.title,
          submitLabel: "Confirm",
          fields: [
            {
              id: "final_write_accepted",
              type: "boolean",
              label: "Write final .agentweaver/playbook files if safety checks pass?",
              required: true,
              default: false,
            },
          ],
        });
        finalWriteAccepted = result.values.final_write_accepted === true;
      }
      const artifact = {
        summary: finalWriteAccepted ? "Final playbook write was accepted." : "Final playbook write was not accepted.",
        answered_at: nowIso8601(),
        answers: existing?.answers ?? [],
        final_write_accepted: finalWriteAccepted,
      };
      writeAnswers(params.answersJsonFile, artifact);
      return {
        value: {
          formId: params.formId,
          questionCount: existing?.answers.length ?? 0,
          finalWriteAccepted,
          outputFile: params.answersJsonFile,
        },
        outputs: [
          {
            kind: "artifact",
            path: params.answersJsonFile,
            required: true,
            manifest: {
              publish: true,
              logicalKey: buildLogicalKeyForPayload(context.issueKey, params.answersJsonFile),
              payloadFamily: "structured-json",
              schemaId: "playbook-answers/v1",
              schemaVersion: 1,
            },
          },
        ],
      };
    }

    const fields = readQuestions(params.questionsJsonFile)
      .map((question, index) => fieldForQuestion(question, index))
      .filter((field): field is UserInputFieldDefinition => field !== null);
    let answers: Array<{ question_id: string; answer: string }> = [];
    const interactive = fields.length === 0 || context.requestUserInput !== requestUserInputInTerminal || (process.stdin.isTTY && process.stdout.isTTY);
    if (fields.length > 0 && !interactive) {
      answers = fields.map((field) => ({ question_id: field.id, answer: "" }));
    } else if (fields.length > 0) {
      const result = await (context.requestUserInput ?? requestUserInputInTerminal)({
        formId: params.formId,
        title: params.title,
        submitLabel: "Continue",
        fields,
      });
      answers = answersFromValues(fields, result.values);
    }
    const artifact = {
      summary: fields.length === 0 ? "No clarification questions were required." : "Playbook clarification answers were recorded.",
      answered_at: nowIso8601(),
      answers,
      final_write_accepted: params.acceptDraft === true,
    };
    writeAnswers(params.answersJsonFile, artifact);
    return {
      value: {
        formId: params.formId,
        questionCount: fields.length,
        finalWriteAccepted: artifact.final_write_accepted,
        outputFile: params.answersJsonFile,
      },
      outputs: [
        {
          kind: "artifact",
          path: params.answersJsonFile,
          required: true,
          manifest: {
            publish: true,
            logicalKey: buildLogicalKeyForPayload(context.issueKey, params.answersJsonFile),
            payloadFamily: "structured-json",
            schemaId: "playbook-answers/v1",
            schemaVersion: 1,
          },
        },
      ],
    };
  },
};
