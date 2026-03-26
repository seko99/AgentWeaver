import { printInfo } from "../../tui.js";
import { runExpandedPhase } from "../declarative-flow-runner.js";
import { loadDeclarativeFlow } from "../declarative-flows.js";
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

    const flow = loadDeclarativeFlow(fileName);
    const executionState: FlowExecutionState = {
      flowKind: flow.kind,
      flowVersion: flow.version,
      terminated: false,
      phases: [],
    };

    for (const phase of flow.phases) {
      await runExpandedPhase(phase, context, flowParams, flow.constants, {
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
