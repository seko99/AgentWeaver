import { existsSync } from "node:fs";

import {
  designFile,
  designJsonFile,
  designReviewFile,
  designReviewJsonFile,
  jiraAttachmentsContextFile,
  jiraAttachmentsManifestFile,
  jiraTaskFile,
  latestArtifactIteration,
  planFile,
  planJsonFile,
  planningAnswersJsonFile,
  qaFile,
  qaJsonFile,
  requireArtifacts,
} from "../artifacts.js";
import { TaskRunnerError } from "../errors.js";
import { validateStructuredArtifacts } from "../structured-artifacts.js";

const OPTIONAL_INPUT_NOT_PROVIDED = "not provided";

type OptionalPromptFile = {
  present: boolean;
  path: string | null;
  promptValue: string;
};

export type PlanReviseInputContract = {
  reviewIteration: number;
  reviewFile: string;
  reviewJsonFile: string;
  sourcePlanningIteration: number;
  outputIteration: number;
  designFile: string;
  designJsonFile: string;
  planFile: string;
  planJsonFile: string;
  hasQaArtifacts: boolean;
  qaFilePath: string | null;
  qaJsonFilePath: string | null;
  qaFile: string;
  qaJsonFile: string;
  revisedDesignFile: string;
  revisedDesignJsonFile: string;
  revisedPlanFile: string;
  revisedPlanJsonFile: string;
  revisedQaFile: string;
  revisedQaJsonFile: string;
  hasJiraTaskFile: boolean;
  jiraTaskFilePath: string | null;
  jiraTaskFile: string;
  hasJiraAttachmentsManifestFile: boolean;
  jiraAttachmentsManifestFilePath: string | null;
  jiraAttachmentsManifestFile: string;
  hasJiraAttachmentsContextFile: boolean;
  jiraAttachmentsContextFilePath: string | null;
  jiraAttachmentsContextFile: string;
  hasPlanningAnswersJsonFile: boolean;
  planningAnswersJsonFilePath: string | null;
  planningAnswersJsonFile: string;
};

function resolveLatestDesignReviewIteration(taskKey: string): number {
  const latestMd = latestArtifactIteration(taskKey, "design-review", "md");
  const latestJson = latestArtifactIteration(taskKey, "design-review", "json");
  const maxIteration = Math.max(latestMd ?? 0, latestJson ?? 0);
  if (maxIteration === 0) {
    throw new TaskRunnerError(
      "Plan-revise requires at least one completed design-review iteration, but no design-review artifacts were found.",
    );
  }

  for (let iteration = maxIteration; iteration >= 1; iteration -= 1) {
    const mdPath = designReviewFile(taskKey, iteration);
    const jsonPath = designReviewJsonFile(taskKey, iteration);
    if (existsSync(mdPath) && existsSync(jsonPath)) {
      return iteration;
    }
  }

  const fallbackMd = designReviewFile(taskKey, maxIteration);
  const fallbackJson = designReviewJsonFile(taskKey, maxIteration);
  requireArtifacts(
    [fallbackMd, fallbackJson],
    "Plan-revise requires design-review markdown and JSON artifacts from the latest completed design-review run.",
  );
  throw new TaskRunnerError("Unreachable plan-revise design-review artifact resolution state.");
}

function resolveLatestCompletedPlanningIteration(taskKey: string): number {
  const latestDesignMd = latestArtifactIteration(taskKey, "design", "md") ?? 0;
  const latestDesignJson = latestArtifactIteration(taskKey, "design", "json") ?? 0;
  const latestPlanMd = latestArtifactIteration(taskKey, "plan", "md") ?? 0;
  const latestPlanJson = latestArtifactIteration(taskKey, "plan", "json") ?? 0;
  const maxIteration = Math.max(latestDesignMd, latestDesignJson, latestPlanMd, latestPlanJson);

  for (let iteration = maxIteration; iteration >= 1; iteration -= 1) {
    const paths = [
      designFile(taskKey, iteration),
      designJsonFile(taskKey, iteration),
      planFile(taskKey, iteration),
      planJsonFile(taskKey, iteration),
    ];
    if (paths.every((candidate) => existsSync(candidate))) {
      return iteration;
    }
  }

  const fallbackIteration = maxIteration || 1;
  const fallbackPaths = [
    designFile(taskKey, fallbackIteration),
    designJsonFile(taskKey, fallbackIteration),
    planFile(taskKey, fallbackIteration),
    planJsonFile(taskKey, fallbackIteration),
  ];
  requireArtifacts(
    fallbackPaths,
    "Plan-revise requires design and plan markdown/JSON artifacts from the latest completed planning run.",
  );
  throw new TaskRunnerError("Unreachable plan-revise planning artifact resolution state.");
}

function resolveOptionalPromptFile(filePath: string): OptionalPromptFile {
  if (!existsSync(filePath)) {
    return {
      present: false,
      path: null,
      promptValue: OPTIONAL_INPUT_NOT_PROVIDED,
    };
  }

  return {
    present: true,
    path: filePath,
    promptValue: filePath,
  };
}

function resolveOptionalQaPair(taskKey: string, iteration: number): {
  hasQaArtifacts: boolean;
  qaFilePath: string | null;
  qaJsonFilePath: string | null;
  qaFile: string;
  qaJsonFile: string;
} {
  const markdownPath = qaFile(taskKey, iteration);
  const jsonPath = qaJsonFile(taskKey, iteration);
  const markdownExists = existsSync(markdownPath);
  const jsonExists = existsSync(jsonPath);

  if (!markdownExists && !jsonExists) {
    return {
      hasQaArtifacts: false,
      qaFilePath: null,
      qaJsonFilePath: null,
      qaFile: OPTIONAL_INPUT_NOT_PROVIDED,
      qaJsonFile: OPTIONAL_INPUT_NOT_PROVIDED,
    };
  }

  if (!markdownExists || !jsonExists) {
    requireArtifacts(
      [markdownPath, jsonPath],
      "Plan-revise accepts QA artifacts only as a complete markdown/JSON pair for the source planning iteration.",
    );
  }

  validateStructuredArtifacts(
    [{ path: jsonPath, schemaId: "qa-plan/v1" }],
    "Plan-revise QA structured artifact is invalid.",
  );

  return {
    hasQaArtifacts: true,
    qaFilePath: markdownPath,
    qaJsonFilePath: jsonPath,
    qaFile: markdownPath,
    qaJsonFile: jsonPath,
  };
}

export function resolvePlanReviseInputContract(taskKey: string): PlanReviseInputContract {
  const reviewIteration = resolveLatestDesignReviewIteration(taskKey);
  const reviewMd = designReviewFile(taskKey, reviewIteration);
  const reviewJson = designReviewJsonFile(taskKey, reviewIteration);

  requireArtifacts(
    [reviewMd, reviewJson],
    "Plan-revise requires design-review markdown and JSON artifacts.",
  );

  validateStructuredArtifacts(
    [{ path: reviewJson, schemaId: "design-review/v1" }],
    "Plan-revise design-review structured artifact is invalid.",
  );

  const sourcePlanningIteration = resolveLatestCompletedPlanningIteration(taskKey);

  const srcDesignMd = designFile(taskKey, sourcePlanningIteration);
  const srcDesignJson = designJsonFile(taskKey, sourcePlanningIteration);
  const srcPlanMd = planFile(taskKey, sourcePlanningIteration);
  const srcPlanJson = planJsonFile(taskKey, sourcePlanningIteration);

  requireArtifacts(
    [srcDesignMd, srcDesignJson, srcPlanMd, srcPlanJson],
    "Plan-revise requires design and plan markdown/JSON artifacts from the source planning iteration.",
  );

  validateStructuredArtifacts(
    [
      { path: srcDesignJson, schemaId: "implementation-design/v1" },
      { path: srcPlanJson, schemaId: "implementation-plan/v1" },
    ],
    "Plan-revise source planning structured artifacts are invalid.",
  );

  const outputIteration = sourcePlanningIteration + 1;

  const qaArtifacts = resolveOptionalQaPair(taskKey, sourcePlanningIteration);
  const jiraTask = resolveOptionalPromptFile(jiraTaskFile(taskKey));
  const jiraAttachmentsManifest = resolveOptionalPromptFile(jiraAttachmentsManifestFile(taskKey));
  const jiraAttachmentsContext = resolveOptionalPromptFile(jiraAttachmentsContextFile(taskKey));
  const planningAnswers = resolveOptionalPromptFile(planningAnswersJsonFile(taskKey));

  return {
    reviewIteration,
    reviewFile: reviewMd,
    reviewJsonFile: reviewJson,
    sourcePlanningIteration,
    outputIteration,
    designFile: srcDesignMd,
    designJsonFile: srcDesignJson,
    planFile: srcPlanMd,
    planJsonFile: srcPlanJson,
    ...qaArtifacts,
    revisedDesignFile: designFile(taskKey, outputIteration),
    revisedDesignJsonFile: designJsonFile(taskKey, outputIteration),
    revisedPlanFile: planFile(taskKey, outputIteration),
    revisedPlanJsonFile: planJsonFile(taskKey, outputIteration),
    revisedQaFile: qaFile(taskKey, outputIteration),
    revisedQaJsonFile: qaJsonFile(taskKey, outputIteration),
    hasJiraTaskFile: jiraTask.present,
    jiraTaskFilePath: jiraTask.path,
    jiraTaskFile: jiraTask.promptValue,
    hasJiraAttachmentsManifestFile: jiraAttachmentsManifest.present,
    jiraAttachmentsManifestFilePath: jiraAttachmentsManifest.path,
    jiraAttachmentsManifestFile: jiraAttachmentsManifest.promptValue,
    hasJiraAttachmentsContextFile: jiraAttachmentsContext.present,
    jiraAttachmentsContextFilePath: jiraAttachmentsContext.path,
    jiraAttachmentsContextFile: jiraAttachmentsContext.promptValue,
    hasPlanningAnswersJsonFile: planningAnswers.present,
    planningAnswersJsonFilePath: planningAnswers.path,
    planningAnswersJsonFile: planningAnswers.promptValue,
  };
}
