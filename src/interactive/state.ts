import type { InteractiveSessionOptions } from "./session.js";
import type { FlowStatusState, FocusPane } from "./types.js";
import { buildFlowTree, computeVisibleFlowItems, makeFlowKey } from "./tree.js";

export type InteractiveSessionState = {
  flowTreeKeys: string[];
  selectedFlowId: string;
  selectedFlowItemKey: string;
  focusedPane: FocusPane;
  summaryVisible: boolean;
  busy: boolean;
  currentFlowId: string | null;
  currentNode: string | null;
  currentExecutor: string | null;
  failedFlowId: string | null;
  flowState: FlowStatusState;
};

export function createInitialInteractiveState(options: InteractiveSessionOptions): InteractiveSessionState {
  const flowTree = buildFlowTree(options.flows);
  const visibleFlowItems = computeVisibleFlowItems(flowTree, new Set<string>());
  const selectedFlowId = options.flows[0]?.id ?? "auto-golang";

  return {
    flowTreeKeys: flowTree.map((node) => node.key),
    selectedFlowId,
    selectedFlowItemKey: visibleFlowItems[0]?.key ?? makeFlowKey(selectedFlowId),
    focusedPane: "flows",
    summaryVisible: options.summaryText.trim().length > 0,
    busy: false,
    currentFlowId: null,
    currentNode: null,
    currentExecutor: null,
    failedFlowId: null,
    flowState: {
      flowId: null,
      executionState: null,
    },
  };
}
