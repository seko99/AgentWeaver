import { existsSync } from "node:fs";

import {
  designFile,
  designJsonFile,
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
import { validateStructuredArtifacts } from "../structured-artifacts.js";
import { resolveLatestCompletedPlanningIteration } from "./planning-bundle.js";

const OPTIONAL_INPUT_NOT_PROVIDED = "not provided";

type OptionalPromptFile = {
  present: boolean;
  path: string | null;
  promptValue: string;
};

export type DesignReviewInputContract = {
  planningIteration: number;
  designFile: string;
  designJsonFile: string;
  planFile: string;
  planJsonFile: string;
  hasQaArtifacts: boolean;
  qaFilePath: string | null;
  qaJsonFilePath: string | null;
  qaFile: string;
  qaJsonFile: string;
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

function requiredPlanningArtifactPaths(taskKey: string, iteration: number): {
  designFile: string;
  designJsonFile: string;
  planFile: string;
  planJsonFile: string;
} {
  return {
    designFile: designFile(taskKey, iteration),
    designJsonFile: designJsonFile(taskKey, iteration),
    planFile: planFile(taskKey, iteration),
    planJsonFile: planJsonFile(taskKey, iteration),
  };
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

function resolveOptionalValidatedStructuredFile(
  filePath: string,
  schemaId: "user-input/v1",
  message: string,
): OptionalPromptFile {
  const resolved = resolveOptionalPromptFile(filePath);
  if (!resolved.present) {
    return resolved;
  }

  validateStructuredArtifacts(
    [{ path: filePath, schemaId }],
    message,
  );
  return resolved;
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
      "Design-review accepts QA artifacts only as a complete markdown/JSON pair for the selected planning iteration.",
    );
  }

  validateStructuredArtifacts(
    [{ path: jsonPath, schemaId: "qa-plan/v1" }],
    "Design-review QA structured artifact is invalid.",
  );

  return {
    hasQaArtifacts: true,
    qaFilePath: markdownPath,
    qaJsonFilePath: jsonPath,
    qaFile: markdownPath,
    qaJsonFile: jsonPath,
  };
}

/**
 * Resolves the full design-review input contract from artifacts already present in the task scope.
 * Required planning artifacts must come from one completed planning iteration. Optional contextual
 * inputs are exposed as stable prompt values and explicit presence flags so the flow can remain
 * deterministic when some context is absent.
 */
export function resolveDesignReviewInputContract(taskKey: string): DesignReviewInputContract {
  const planningIteration = resolveLatestCompletedPlanningIteration(taskKey, {
    requireQa: false,
    missingMessage: "Design-review requires design and plan markdown/JSON artifacts from the latest completed planning run.",
  });
  const requiredArtifacts = requiredPlanningArtifactPaths(taskKey, planningIteration);

  requireArtifacts(
    Object.values(requiredArtifacts),
    "Design-review requires design and plan markdown/JSON artifacts from the latest completed planning run.",
  );

  validateStructuredArtifacts(
    [
      { path: requiredArtifacts.designJsonFile, schemaId: "implementation-design/v1" },
      { path: requiredArtifacts.planJsonFile, schemaId: "implementation-plan/v1" },
    ],
    "Design-review required planning structured artifacts are invalid.",
  );

  const qaArtifacts = resolveOptionalQaPair(taskKey, planningIteration);
  const jiraTask = resolveOptionalPromptFile(jiraTaskFile(taskKey));
  const jiraAttachmentsManifest = resolveOptionalPromptFile(jiraAttachmentsManifestFile(taskKey));
  const jiraAttachmentsContext = resolveOptionalPromptFile(jiraAttachmentsContextFile(taskKey));
  const planningAnswers = resolveOptionalValidatedStructuredFile(
    planningAnswersJsonFile(taskKey),
    "user-input/v1",
    "Design-review planning answers structured artifact is invalid.",
  );

  return {
    planningIteration,
    ...requiredArtifacts,
    ...qaArtifacts,
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

export { OPTIONAL_INPUT_NOT_PROVIDED };
