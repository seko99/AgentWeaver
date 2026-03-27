import { readFileSync } from "node:fs";

import { TaskRunnerError } from "../../errors.js";
import type { PipelineNodeDefinition } from "../types.js";
import type { UserInputFieldDefinition, UserInputFormDefinition } from "../../user-input.js";

type ReviewFindingRecord = {
  severity?: unknown;
  title?: unknown;
  description?: unknown;
};

type ReviewFindingsArtifact = {
  findings?: ReviewFindingRecord[];
};

export type ReviewFindingsFormNodeParams = {
  reviewJsonFile: string;
  formId: string;
  title: string;
  description?: string;
};

export type ReviewFindingsFormNodeResult = UserInputFormDefinition & {
  findingCount: number;
};

export const reviewFindingsFormNode: PipelineNodeDefinition<ReviewFindingsFormNodeParams, ReviewFindingsFormNodeResult> = {
  kind: "review-findings-form",
  version: 1,
  async run(_context, params) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(params.reviewJsonFile, "utf8"));
    } catch (error) {
      throw new TaskRunnerError(
        `Failed to read review findings from ${params.reviewJsonFile}: ${(error as Error).message}`,
      );
    }

    const review = parsed as ReviewFindingsArtifact;
    const findings = Array.isArray(review.findings) ? review.findings : [];
    const selectableFindings = findings
      .map((finding) => ({
        severity: typeof finding.severity === "string" ? finding.severity.trim() : "",
        title: typeof finding.title === "string" ? finding.title.trim() : "",
        description: typeof finding.description === "string" ? finding.description.trim() : "",
      }))
      .filter((finding) => finding.title.length > 0);

    const fields: UserInputFieldDefinition[] = [
      {
        id: "apply_all",
        type: "boolean",
        label: "Исправить все findings в этой итерации",
        help: "Если включено, выбор списка ниже не ограничивает scope исправлений.",
        default: selectableFindings.length === 0,
      },
    ];

    if (selectableFindings.length > 0) {
      fields.push({
        id: "selected_findings",
        type: "multi-select",
        label: "Какие findings исправить сейчас",
        help: "Space переключает пункт. Если apply_all=false, выберите хотя бы один finding.",
        options: selectableFindings.map((finding) => ({
          value: finding.title,
          label: `[${finding.severity || "info"}] ${finding.title}`,
          ...(finding.description ? { description: finding.description } : {}),
        })),
        default: [],
      });
    }

    fields.push({
      id: "extra_notes",
      type: "text",
      label: "Дополнительные указания",
      help: "Короткий комментарий для этой итерации review-fix.",
      default: "",
      placeholder: "Например: исправить только блокеры",
    });

    return {
      value: {
        formId: params.formId,
        title: params.title,
        ...(params.description ? { description: params.description } : {}),
        submitLabel: "Запустить review-fix",
        fields,
        findingCount: selectableFindings.length,
      },
    };
  },
};
