import { readFileSync } from "node:fs";

import { TaskRunnerError } from "../../errors.js";
import type { PipelineNodeDefinition } from "../types.js";
import type { UserInputFieldDefinition, UserInputFormDefinition } from "../../user-input.js";

type ReviewReplyRecord = {
  finding_title?: unknown;
  disposition?: unknown;
  action?: unknown;
};

type ReviewReplyArtifact = {
  responses?: ReviewReplyRecord[];
};

export type ReviewFindingsFormNodeParams = {
  reviewReplyJsonFile: string;
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
      parsed = JSON.parse(readFileSync(params.reviewReplyJsonFile, "utf8"));
    } catch (error) {
      throw new TaskRunnerError(
        `Failed to read review reply from ${params.reviewReplyJsonFile}: ${(error as Error).message}`,
      );
    }

    const reviewReply = parsed as ReviewReplyArtifact;
    const responses = Array.isArray(reviewReply.responses) ? reviewReply.responses : [];
    const selectableFindings = responses
      .map((response) => ({
        findingTitle: typeof response.finding_title === "string" ? response.finding_title.trim() : "",
        disposition: typeof response.disposition === "string" ? response.disposition.trim() : "",
        action: typeof response.action === "string" ? response.action.trim() : "",
      }))
      .filter(
        (response) => response.findingTitle.length > 0 && response.disposition.toLowerCase() !== "resolved",
      );

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
        options: selectableFindings.map((response) => ({
          value: response.findingTitle,
          label: `${response.findingTitle} | ${response.disposition || "-"}`,
          ...(response.action ? { description: response.action } : {}),
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
