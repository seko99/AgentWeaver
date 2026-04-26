import type { InteractiveSessionOptions } from "./session.js";
import type { FlowStatusState, FocusPane } from "./types.js";
import { buildFlowTree, collectInitiallyExpandedFolderKeys, computeVisibleFlowItems, makeFlowKey } from "./tree.js";

export type InteractiveSessionState = {
  scopeKey: string;
  jiraIssueKey: string | null;
  gitBranchName: string | null;
  summaryText: string;
  version: string;
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
  runningStartedAt: number | null;
  spinnerFrame: number;
  progressScrollOffset: number;
  summaryScrollOffset: number;
  logScrollOffset: number;
  helpScrollOffset: number;
};

export function createInitialInteractiveState(options: InteractiveSessionOptions): InteractiveSessionState {
  const flowTree = buildFlowTree(options.flows);
  const expandedFlowFolders = new Set<string>(collectInitiallyExpandedFolderKeys(flowTree));
  const visibleFlowItems = computeVisibleFlowItems(flowTree, expandedFlowFolders);
  const initiallySelectedItem = visibleFlowItems.find((item) => item.kind === "flow") ?? visibleFlowItems[0];
  const selectedFlowId = initiallySelectedItem?.kind === "flow" ? initiallySelectedItem.flow.id : options.flows[0]?.id ?? "auto-golang";

  return {
    scopeKey: options.scopeKey,
    jiraIssueKey: options.jiraIssueKey ?? null,
    gitBranchName: options.gitBranchName,
    summaryText: options.summaryText.trim(),
    version: options.version ?? "",
    flowTreeKeys: flowTree.map((node) => node.key),
    selectedFlowId,
    selectedFlowItemKey: initiallySelectedItem?.key ?? makeFlowKey(selectedFlowId),
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
    runningStartedAt: null,
    spinnerFrame: 0,
    progressScrollOffset: 0,
    summaryScrollOffset: 0,
    logScrollOffset: 0,
    helpScrollOffset: 0,
  };
}
