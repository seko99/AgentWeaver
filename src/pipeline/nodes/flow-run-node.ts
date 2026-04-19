import { printInfo } from "../../tui.js";
import { resolveDesignReviewInputContract } from "../../runtime/design-review-input-contract.js";
import { resolvePlanReviseInputContract } from "../../runtime/plan-revise-input-contract.js";
import { inspectReviewInputContract } from "../../runtime/review-input-contract.js";
import type { PublishedArtifactRecord } from "../../runtime/artifact-registry.js";
import { runExpandedPhase } from "../declarative-flow-runner.js";
import { loadNamedDeclarativeFlow } from "../declarative-flows.js";
import type { FlowExecutionState } from "../spec-types.js";
import type { PipelineNodeDefinition } from "../types.js";
import { ARTIFACT_LINEAGE_REF_PATHS_PARAM } from "../value-resolver.js";

export type FlowRunNodeParams = {
  fileName: string;
  labelText?: string;
  [key: string]: unknown;
};

export type FlowRunNodeResult = {
  flowKind: string;
  flowVersion: number;
  executionState: FlowExecutionState;
  publishedArtifacts: PublishedArtifactRecord[];
};

type ArtifactLineageRefMap = Record<string, string>;

function withArtifactLineageRefPaths(
  params: Record<string, unknown>,
  lineageRefs: ArtifactLineageRefMap,
): Record<string, unknown> {
  if (Object.keys(lineageRefs).length === 0) {
    return params;
  }

  const existing = params[ARTIFACT_LINEAGE_REF_PATHS_PARAM];
  const merged =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>), ...lineageRefs }
      : lineageRefs;

  return {
    ...params,
    [ARTIFACT_LINEAGE_REF_PATHS_PARAM]: merged,
  };
}

export const flowRunNode: PipelineNodeDefinition<FlowRunNodeParams, FlowRunNodeResult> = {
  kind: "flow-run",
  version: 1,
  async run(context, params) {
    const { fileName, labelText, ...flowParams } = params;
    if (typeof fileName !== "string" || fileName.trim().length === 0) {
      throw new Error("flow-run node requires non-empty 'fileName' param");
    }
    if (labelText) {
      printInfo(String(labelText));
    }

    const flow = loadNamedDeclarativeFlow(fileName, context.cwd);

    let resolvedFlowParams = flowParams;
    if (flow.kind === "design-review-flow") {
      const taskKey = String(flowParams["taskKey"] ?? "");
      if (taskKey) {
        const contract = resolveDesignReviewInputContract(taskKey);
        resolvedFlowParams = withArtifactLineageRefPaths({
          ...flowParams,
          iteration: contract.planningIteration,
          planningIteration: contract.planningIteration,
          designFile: contract.designFile,
          designJsonFile: contract.designJsonFile,
          planFile: contract.planFile,
          planJsonFile: contract.planJsonFile,
          hasQaArtifacts: contract.hasQaArtifacts,
          qaFilePath: contract.qaFilePath,
          qaJsonFilePath: contract.qaJsonFilePath,
          qaFile: contract.qaFile,
          qaJsonFile: contract.qaJsonFile,
          hasJiraTaskFile: contract.hasJiraTaskFile,
          jiraTaskFilePath: contract.jiraTaskFilePath,
          jiraTaskFile: contract.jiraTaskFile,
          hasJiraAttachmentsManifestFile: contract.hasJiraAttachmentsManifestFile,
          jiraAttachmentsManifestFilePath: contract.jiraAttachmentsManifestFilePath,
          jiraAttachmentsManifestFile: contract.jiraAttachmentsManifestFile,
          hasJiraAttachmentsContextFile: contract.hasJiraAttachmentsContextFile,
          jiraAttachmentsContextFilePath: contract.jiraAttachmentsContextFilePath,
          jiraAttachmentsContextFile: contract.jiraAttachmentsContextFile,
          hasPlanningAnswersJsonFile: contract.hasPlanningAnswersJsonFile,
          planningAnswersJsonFilePath: contract.planningAnswersJsonFilePath,
          planningAnswersJsonFile: contract.planningAnswersJsonFile,
          hasTaskInputJsonFile: contract.hasTaskInputJsonFile,
          taskInputJsonFilePath: contract.taskInputJsonFilePath,
          taskInputJsonFile: contract.taskInputJsonFile,
        }, {
          "params.designFile": contract.designFile,
          "params.designJsonFile": contract.designJsonFile,
          "params.planFile": contract.planFile,
          "params.planJsonFile": contract.planJsonFile,
          ...(contract.qaFilePath ? { "params.qaFile": contract.qaFilePath } : {}),
          ...(contract.qaJsonFilePath ? { "params.qaJsonFile": contract.qaJsonFilePath } : {}),
          ...(contract.jiraTaskFilePath ? { "params.jiraTaskFile": contract.jiraTaskFilePath } : {}),
          ...(contract.jiraAttachmentsManifestFilePath
            ? { "params.jiraAttachmentsManifestFile": contract.jiraAttachmentsManifestFilePath }
            : {}),
          ...(contract.jiraAttachmentsContextFilePath
            ? { "params.jiraAttachmentsContextFile": contract.jiraAttachmentsContextFilePath }
            : {}),
          ...(contract.planningAnswersJsonFilePath
            ? { "params.planningAnswersJsonFile": contract.planningAnswersJsonFilePath }
            : {}),
          ...(contract.taskInputJsonFilePath
            ? { "params.taskInputJsonFile": contract.taskInputJsonFilePath }
            : {}),
        });
      }
    } else if (flow.kind === "plan-revise-flow") {
      const taskKey = String(flowParams["taskKey"] ?? "");
      if (taskKey) {
        const contract = resolvePlanReviseInputContract(taskKey);
        resolvedFlowParams = withArtifactLineageRefPaths({
          ...flowParams,
          reviewIteration: contract.reviewIteration,
          reviewFile: contract.reviewFile,
          reviewJsonFile: contract.reviewJsonFile,
          sourcePlanningIteration: contract.sourcePlanningIteration,
          outputIteration: contract.outputIteration,
          designFile: contract.designFile,
          designJsonFile: contract.designJsonFile,
          planFile: contract.planFile,
          planJsonFile: contract.planJsonFile,
          hasQaArtifacts: contract.hasQaArtifacts,
          qaFilePath: contract.qaFilePath,
          qaJsonFilePath: contract.qaJsonFilePath,
          qaFile: contract.qaFile,
          qaJsonFile: contract.qaJsonFile,
          revisedDesignFile: contract.revisedDesignFile,
          revisedDesignJsonFile: contract.revisedDesignJsonFile,
          revisedPlanFile: contract.revisedPlanFile,
          revisedPlanJsonFile: contract.revisedPlanJsonFile,
          revisedQaFile: contract.revisedQaFile,
          revisedQaJsonFile: contract.revisedQaJsonFile,
          hasJiraTaskFile: contract.hasJiraTaskFile,
          jiraTaskFilePath: contract.jiraTaskFilePath,
          jiraTaskFile: contract.jiraTaskFile,
          hasJiraAttachmentsManifestFile: contract.hasJiraAttachmentsManifestFile,
          jiraAttachmentsManifestFilePath: contract.jiraAttachmentsManifestFilePath,
          jiraAttachmentsManifestFile: contract.jiraAttachmentsManifestFile,
          hasJiraAttachmentsContextFile: contract.hasJiraAttachmentsContextFile,
          jiraAttachmentsContextFilePath: contract.jiraAttachmentsContextFilePath,
          jiraAttachmentsContextFile: contract.jiraAttachmentsContextFile,
          hasPlanningAnswersJsonFile: contract.hasPlanningAnswersJsonFile,
          planningAnswersJsonFilePath: contract.planningAnswersJsonFilePath,
          planningAnswersJsonFile: contract.planningAnswersJsonFile,
          hasTaskInputJsonFile: contract.hasTaskInputJsonFile,
          taskInputJsonFilePath: contract.taskInputJsonFilePath,
          taskInputJsonFile: contract.taskInputJsonFile,
        }, {
          "params.reviewFile": contract.reviewFile,
          "params.reviewJsonFile": contract.reviewJsonFile,
          "params.designFile": contract.designFile,
          "params.designJsonFile": contract.designJsonFile,
          "params.planFile": contract.planFile,
          "params.planJsonFile": contract.planJsonFile,
          ...(contract.qaFilePath ? { "params.qaFile": contract.qaFilePath } : {}),
          ...(contract.qaJsonFilePath ? { "params.qaJsonFile": contract.qaJsonFilePath } : {}),
          ...(contract.jiraTaskFilePath ? { "params.jiraTaskFile": contract.jiraTaskFilePath } : {}),
          ...(contract.jiraAttachmentsManifestFilePath
            ? { "params.jiraAttachmentsManifestFile": contract.jiraAttachmentsManifestFilePath }
            : {}),
          ...(contract.jiraAttachmentsContextFilePath
            ? { "params.jiraAttachmentsContextFile": contract.jiraAttachmentsContextFilePath }
            : {}),
          ...(contract.planningAnswersJsonFilePath
            ? { "params.planningAnswersJsonFile": contract.planningAnswersJsonFilePath }
            : {}),
          ...(contract.taskInputJsonFilePath
            ? { "params.taskInputJsonFile": contract.taskInputJsonFilePath }
            : {}),
        });
      }
    } else if (flow.kind === "review-flow") {
      const taskKey = String(flowParams["taskKey"] ?? "");
      if (taskKey) {
        const inspection = inspectReviewInputContract(taskKey);
        if (inspection.status === "ready") {
          const { contract } = inspection;
          resolvedFlowParams = withArtifactLineageRefPaths({
            ...flowParams,
            planningIteration: contract.planningIteration,
            designFile: contract.designFile,
            designJsonFile: contract.designJsonFile,
            planFile: contract.planFile,
            planJsonFile: contract.planJsonFile,
            hasJiraTaskFile: contract.hasJiraTaskFile,
            jiraTaskFilePath: contract.jiraTaskFilePath,
            jiraTaskFile: contract.jiraTaskFile,
            hasTaskInputJsonFile: contract.hasTaskInputJsonFile,
            taskInputJsonFilePath: contract.taskInputJsonFilePath,
            taskInputJsonFile: contract.taskInputJsonFile,
          }, {
            "params.designFile": contract.designFile,
            "params.designJsonFile": contract.designJsonFile,
            "params.planFile": contract.planFile,
            "params.planJsonFile": contract.planJsonFile,
            ...(contract.jiraTaskFilePath ? { "params.jiraTaskFile": contract.jiraTaskFilePath } : {}),
            ...(contract.taskInputJsonFilePath
              ? { "params.taskInputJsonFile": contract.taskInputJsonFilePath }
              : {}),
          });
        }
      }
    }

    const executionState: FlowExecutionState = {
      flowKind: flow.kind,
      flowVersion: flow.version,
      terminated: false,
      terminationOutcome: "success",
      phases: [],
    };
    const publishedArtifacts: PublishedArtifactRecord[] = [];

    for (const phase of flow.phases) {
      const phaseResult = await runExpandedPhase(phase, context, resolvedFlowParams, flow.constants, {
        executionState,
        flowKind: flow.kind,
        flowVersion: flow.version,
      });
      publishedArtifacts.push(...phaseResult.steps.flatMap((step) => step.publishedArtifacts ?? []));
      if (executionState.terminated) {
        break;
      }
    }

    return {
      value: {
        flowKind: flow.kind,
        flowVersion: flow.version,
        executionState,
        publishedArtifacts,
      },
    };
  },
};
