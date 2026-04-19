import type { FlowExecutionState } from "../pipeline/spec-types.js";
import type {
  InteractiveFlowDefinition,
  ProgressViewModel,
  VisibleFlowTreeItem,
} from "./types.js";
import { buildProgressViewModel } from "./progress.js";
import { computeVisibleFlowItems } from "./tree.js";

export function selectVisibleFlowItems(
  flowTree: ReturnType<typeof import("./tree.js").buildFlowTree>,
  expandedFlowFolders: ReadonlySet<string>,
): VisibleFlowTreeItem[] {
  return computeVisibleFlowItems(flowTree, expandedFlowFolders);
}

export function selectHeaderLabel(
  selectedItem: VisibleFlowTreeItem | undefined,
  fallbackFlowId: string,
): string {
  if (!selectedItem) {
    return fallbackFlowId;
  }
  return selectedItem.kind === "folder" ? selectedItem.pathSegments.join("/") : selectedItem.flow.label;
}

export function selectProgressViewModel(
  flow: InteractiveFlowDefinition | null,
  flowState: FlowExecutionState | null,
): ProgressViewModel {
  return buildProgressViewModel(flow, flowState);
}
