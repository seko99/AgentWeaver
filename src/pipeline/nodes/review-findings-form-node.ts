import { readFileSync } from "node:fs";

import { TaskRunnerError } from "../../errors.js";
import type { PipelineNodeDefinition } from "../types.js";
import type { UserInputFieldDefinition, UserInputFormDefinition } from "../../user-input.js";

type ReviewFinding = {
  severity?: unknown;
  title?: unknown;
  description?: unknown;
  disposition?: unknown;
};

type ReviewFindingsArtifact = {
  findings?: ReviewFinding[];
};

type ReviewAssessmentRecord = {
  finding_title?: unknown;
  severity?: unknown;
  verdict?: unknown;
  rationale?: unknown;
  proposed_fix?: unknown;
  fix_required?: unknown;
};

type ReviewAssessmentArtifact = {
  assessments?: ReviewAssessmentRecord[];
};

export type ReviewFindingsFormNodeParams = {
  reviewFindingsJsonFile: string;
  reviewAssessmentJsonFile?: string;
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
      parsed = JSON.parse(readFileSync(params.reviewFindingsJsonFile, "utf8"));
    } catch (error) {
      throw new TaskRunnerError(
        `Failed to read review findings from ${params.reviewFindingsJsonFile}: ${(error as Error).message}`,
      );
    }

    const reviewFindings = parsed as ReviewFindingsArtifact;
    let reviewAssessment: ReviewAssessmentArtifact | null = null;
    if (typeof params.reviewAssessmentJsonFile === "string" && params.reviewAssessmentJsonFile.trim().length > 0) {
      try {
        reviewAssessment = JSON.parse(readFileSync(params.reviewAssessmentJsonFile, "utf8")) as ReviewAssessmentArtifact;
      } catch (error) {
        throw new TaskRunnerError(
          `Failed to read review assessment from ${params.reviewAssessmentJsonFile}: ${(error as Error).message}`,
        );
      }
    }

    const assessmentByTitle = new Map<string, { verdict: string; rationale: string; proposedFix: string; fixRequired: boolean | null }>();
    for (const record of reviewAssessment?.assessments ?? []) {
      const findingTitle = typeof record.finding_title === "string" ? record.finding_title.trim() : "";
      const verdict = typeof record.verdict === "string" ? record.verdict.trim() : "";
      const rationale = typeof record.rationale === "string" ? record.rationale.trim() : "";
      const proposedFix = typeof record.proposed_fix === "string" ? record.proposed_fix.trim() : "";
      const fixRequired = typeof record.fix_required === "boolean" ? record.fix_required : null;
      if (findingTitle.length === 0 || assessmentByTitle.has(findingTitle)) {
        continue;
      }
      assessmentByTitle.set(findingTitle, { verdict, rationale, proposedFix, fixRequired });
    }

    const findings = Array.isArray(reviewFindings.findings) ? reviewFindings.findings : [];
    const selectableFindings = findings
      .map((finding) => ({
        severity: typeof finding.severity === "string" ? finding.severity.trim().toLowerCase() : "",
        title: typeof finding.title === "string" ? finding.title.trim() : "",
        description: typeof finding.description === "string" ? finding.description.trim() : "",
        disposition: typeof finding.disposition === "string" ? finding.disposition.trim().toLowerCase() : null,
        assessment: assessmentByTitle.get(typeof finding.title === "string" ? finding.title.trim() : "") ?? null,
      }))
      .filter(
        (finding) =>
          finding.title.length > 0 &&
          finding.disposition !== "resolved",
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
        options: selectableFindings.map((finding) => ({
          value: finding.title,
          label: `${finding.title} | ${finding.severity || "-"}`,
          description: [
            finding.description,
            finding.assessment?.verdict ? `Verdict: ${finding.assessment.verdict}` : "",
            finding.assessment?.rationale ? `Rationale: ${finding.assessment.rationale}` : "",
            finding.assessment?.proposedFix ? `Proposed fix: ${finding.assessment.proposedFix}` : "",
            typeof finding.assessment?.fixRequired === "boolean"
              ? `Fix required: ${finding.assessment.fixRequired ? "yes" : "no"}`
              : "",
          ]
            .filter((item) => item.trim().length > 0)
            .join("\n\n"),
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
