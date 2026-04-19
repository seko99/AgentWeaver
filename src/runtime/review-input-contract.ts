import { existsSync } from "node:fs";

import {
  designFile,
  designJsonFile,
  instantTaskInputJsonFile,
  jiraTaskFile,
  planFile,
  planJsonFile,
  requireArtifacts,
} from "../artifacts.js";
import { TaskRunnerError } from "../errors.js";
import { validateStructuredArtifacts } from "../structured-artifacts.js";
import { resolveLatestCompletedPlanningIteration } from "./planning-bundle.js";

const OPTIONAL_INPUT_NOT_PROVIDED = "not provided";

type OptionalPromptFile = {
  present: boolean;
  path: string | null;
  promptValue: string;
};

export type ReviewInputContract = {
  planningIteration: number;
  designFile: string;
  designJsonFile: string;
  planFile: string;
  planJsonFile: string;
  hasJiraTaskFile: boolean;
  jiraTaskFilePath: string | null;
  jiraTaskFile: string;
  hasTaskInputJsonFile: boolean;
  taskInputJsonFilePath: string | null;
  taskInputJsonFile: string;
};

export type ReviewInputContractInspection =
  | { status: "ready"; contract: ReviewInputContract }
  | { status: "missing-planning" }
  | { status: "missing-task-context"; planningIteration: number };

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

export function inspectReviewInputContract(taskKey: string): ReviewInputContractInspection {
  let planningIteration: number;
  try {
    planningIteration = resolveLatestCompletedPlanningIteration(taskKey, {
      requireQa: false,
      missingMessage: "Structured review requires design and plan markdown/JSON artifacts from the latest completed planning run.",
    });
  } catch (error) {
    if (error instanceof TaskRunnerError) {
      return { status: "missing-planning" };
    }
    throw error;
  }

  const contract: ReviewInputContract = {
    planningIteration,
    designFile: designFile(taskKey, planningIteration),
    designJsonFile: designJsonFile(taskKey, planningIteration),
    planFile: planFile(taskKey, planningIteration),
    planJsonFile: planJsonFile(taskKey, planningIteration),
    hasJiraTaskFile: false,
    jiraTaskFilePath: null,
    jiraTaskFile: OPTIONAL_INPUT_NOT_PROVIDED,
    hasTaskInputJsonFile: false,
    taskInputJsonFilePath: null,
    taskInputJsonFile: OPTIONAL_INPUT_NOT_PROVIDED,
  };

  requireArtifacts(
    [contract.designFile, contract.designJsonFile, contract.planFile, contract.planJsonFile],
    "Structured review requires design and plan markdown/JSON artifacts from the latest completed planning run.",
  );

  validateStructuredArtifacts(
    [
      { path: contract.designJsonFile, schemaId: "implementation-design/v1" },
      { path: contract.planJsonFile, schemaId: "implementation-plan/v1" },
    ],
    "Structured review requires valid design and plan structured artifacts.",
  );

  const jiraTask = resolveOptionalPromptFile(jiraTaskFile(taskKey));
  const taskInput = resolveOptionalValidatedStructuredFile(
    instantTaskInputJsonFile(taskKey),
    "user-input/v1",
    "Structured review instant-task input structured artifact is invalid.",
  );

  if (!jiraTask.present && !taskInput.present) {
    return {
      status: "missing-task-context",
      planningIteration,
    };
  }

  contract.hasJiraTaskFile = jiraTask.present;
  contract.jiraTaskFilePath = jiraTask.path;
  contract.jiraTaskFile = jiraTask.promptValue;
  contract.hasTaskInputJsonFile = taskInput.present;
  contract.taskInputJsonFilePath = taskInput.path;
  contract.taskInputJsonFile = taskInput.promptValue;

  return {
    status: "ready",
    contract,
  };
}

export function resolveReviewInputContract(taskKey: string): ReviewInputContract {
  const inspection = inspectReviewInputContract(taskKey);
  if (inspection.status === "ready") {
    return inspection.contract;
  }
  if (inspection.status === "missing-planning") {
    throw new TaskRunnerError(
      "Structured review requires design and plan markdown/JSON artifacts from the latest completed planning run.",
    );
  }
  throw new TaskRunnerError(
    `Structured review requires either Jira task context or an instant-task input artifact in scope '${taskKey}'.`,
  );
}

export { OPTIONAL_INPUT_NOT_PROVIDED };
