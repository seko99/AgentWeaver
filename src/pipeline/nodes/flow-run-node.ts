import { printInfo } from "../../tui.js";
import { nextArtifactIteration } from "../../artifacts.js";
import { resolveDesignReviewInputContract } from "../../runtime/design-review-input-contract.js";
import { resolvePlanReviseInputContract } from "../../runtime/plan-revise-input-contract.js";
import { inspectReviewInputContract } from "../../runtime/review-input-contract.js";
import type { PublishedArtifactRecord } from "../../runtime/artifact-registry.js";
import { runExpandedPhase } from "../declarative-flow-runner.js";
import { loadNamedDeclarativeFlow } from "../declarative-flows.js";
import type { FlowExecutionState } from "../spec-types.js";
import { isFlowRunResumeEnvelope, type FlowRunResumeEnvelope } from "../flow-run-resume.js";
import { withCanonicalReviewLoopParams } from "../review-iteration.js";
import type { PipelineNodeDefinition } from "../types.js";
import { ARTIFACT_LINEAGE_REF_PATHS_PARAM } from "../value-resolver.js";

export type FlowRunNodeParams = {
  fileName: string;
  labelText?: string;
  [key: string]: unknown;
};

export type FlowRunNodeResult = FlowRunResumeEnvelope;

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

function parsePositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

export function resolveNestedFlowParams(
  flowKind: string,
  flowParams: Record<string, unknown>,
): Record<string, unknown> {
  let resolvedFlowParams = withCanonicalReviewLoopParams(flowKind, flowParams);

  if (flowKind === "design-review-flow") {
    const taskKey = String(flowParams["taskKey"] ?? "");
    if (!taskKey) {
      return resolvedFlowParams;
    }
    const contract = resolveDesignReviewInputContract(taskKey);
    const iteration = parsePositiveInteger(flowParams["iteration"]) ?? nextArtifactIteration(taskKey, "design-review");
    return withArtifactLineageRefPaths({
      ...flowParams,
      iteration,
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
      hasTaskContextJsonFile: contract.hasTaskContextJsonFile,
      taskContextJsonFilePath: contract.taskContextJsonFilePath,
      taskContextJsonFile: contract.taskContextJsonFile,
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
      ...(contract.taskContextJsonFilePath
        ? { "params.taskContextJsonFile": contract.taskContextJsonFilePath }
        : {}),
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

  if (flowKind === "plan-revise-flow") {
    const taskKey = String(flowParams["taskKey"] ?? "");
    if (!taskKey) {
      return resolvedFlowParams;
    }
    const contract = resolvePlanReviseInputContract(taskKey);
    return withArtifactLineageRefPaths({
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
      hasTaskContextJsonFile: contract.hasTaskContextJsonFile,
      taskContextJsonFilePath: contract.taskContextJsonFilePath,
      taskContextJsonFile: contract.taskContextJsonFile,
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
      ...(contract.taskContextJsonFilePath
        ? { "params.taskContextJsonFile": contract.taskContextJsonFilePath }
        : {}),
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

  if (flowKind === "review-flow") {
    const taskKey = String(flowParams["taskKey"] ?? "");
    if (!taskKey) {
      return resolvedFlowParams;
    }
    const inspection = inspectReviewInputContract(taskKey);
    if (inspection.status !== "ready") {
      return resolvedFlowParams;
    }
    const { contract } = inspection;
    return withArtifactLineageRefPaths({
      ...flowParams,
      planningIteration: contract.planningIteration,
      designFile: contract.designFile,
      designJsonFile: contract.designJsonFile,
      planFile: contract.planFile,
      planJsonFile: contract.planJsonFile,
      hasTaskContextJsonFile: contract.hasTaskContextJsonFile,
      taskContextJsonFilePath: contract.taskContextJsonFilePath,
      taskContextJsonFile: contract.taskContextJsonFile,
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
      ...(contract.taskContextJsonFilePath
        ? { "params.taskContextJsonFile": contract.taskContextJsonFilePath }
        : {}),
      ...(contract.jiraTaskFilePath ? { "params.jiraTaskFile": contract.jiraTaskFilePath } : {}),
      ...(contract.taskInputJsonFilePath
        ? { "params.taskInputJsonFile": contract.taskInputJsonFilePath }
        : {}),
    });
  }

  return resolvedFlowParams;
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
    const resolvedFlowParams = resolveNestedFlowParams(flow.kind, flowParams);

    const resumeValue = isFlowRunResumeEnvelope(context.resumeStepValue)
      && context.resumeStepValue.flowKind === flow.kind
      && context.resumeStepValue.flowVersion === flow.version
        ? context.resumeStepValue
        : null;
    const executionState: FlowExecutionState = resumeValue?.executionState ?? {
      flowKind: flow.kind,
      flowVersion: flow.version,
      terminated: false,
      terminationOutcome: "success",
      phases: [],
    };

    const buildResumeEnvelope = (nextExecutionState: FlowExecutionState): FlowRunResumeEnvelope => ({
      resumeKind: "flow-run",
      flowKind: flow.kind,
      flowVersion: flow.version,
      executionState: nextExecutionState,
      publishedArtifacts: collectPublishedArtifacts(nextExecutionState),
    });

    for (const phase of flow.phases) {
      await runExpandedPhase(phase, context, resolvedFlowParams, flow.constants, {
        executionState,
        flowKind: flow.kind,
        flowVersion: flow.version,
        onStateChange: async (nextExecutionState) => {
          await context.persistRunningStepValue?.(buildResumeEnvelope(nextExecutionState));
        },
      });
      if (executionState.terminated) {
        break;
      }
    }

    return {
      value: buildResumeEnvelope(executionState),
    };
  },
};

function collectPublishedArtifacts(executionState: FlowExecutionState): PublishedArtifactRecord[] {
  const merged: PublishedArtifactRecord[] = [];
  const seen = new Set<string>();
  for (const phase of executionState.phases) {
    for (const step of phase.steps) {
      for (const artifact of step.publishedArtifacts ?? []) {
        if (seen.has(artifact.artifact_id)) {
          continue;
        }
        seen.add(artifact.artifact_id);
        merged.push(artifact);
      }
    }
  }
  return merged;
}
