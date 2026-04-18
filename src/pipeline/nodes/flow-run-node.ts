import { printInfo } from "../../tui.js";
import { resolveDesignReviewInputContract } from "../../runtime/design-review-input-contract.js";
import { resolvePlanReviseInputContract } from "../../runtime/plan-revise-input-contract.js";
import { runExpandedPhase } from "../declarative-flow-runner.js";
import { loadNamedDeclarativeFlow } from "../declarative-flows.js";
import type { FlowExecutionState } from "../spec-types.js";
import type { PipelineNodeDefinition } from "../types.js";

export type FlowRunNodeParams = {
  fileName: string;
  labelText?: string;
  [key: string]: unknown;
};

export type FlowRunNodeResult = {
  flowKind: string;
  flowVersion: number;
  executionState: FlowExecutionState;
};

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
        resolvedFlowParams = {
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
        };
      }
    } else if (flow.kind === "plan-revise-flow") {
      const taskKey = String(flowParams["taskKey"] ?? "");
      if (taskKey) {
        const contract = resolvePlanReviseInputContract(taskKey);
        resolvedFlowParams = {
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
        };
      }
    }

    const executionState: FlowExecutionState = {
      flowKind: flow.kind,
      flowVersion: flow.version,
      terminated: false,
      phases: [],
    };

    for (const phase of flow.phases) {
      await runExpandedPhase(phase, context, resolvedFlowParams, flow.constants, {
        executionState,
        flowKind: flow.kind,
        flowVersion: flow.version,
      });
      if (executionState.terminated) {
        break;
      }
    }

    return {
      value: {
        flowKind: flow.kind,
        flowVersion: flow.version,
        executionState,
      },
    };
  },
};
