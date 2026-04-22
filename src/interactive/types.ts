import type { FlowExecutionState } from "../pipeline/spec-types.js";

export type InteractiveFlowDefinition = {
  id: string;
  label: string;
  description: string;
  source: "built-in" | "global" | "project-local";
  treePath: string[];
  sourcePath?: string;
  phases: Array<{
    id: string;
    repeatVars: Record<string, string | number | boolean | null>;
    steps: Array<{
      id: string;
    }>;
  }>;
};

export type FocusPane = "flows" | "progress" | "summary" | "log";

export type FlowStatus = "pending" | "running" | "done" | "skipped";

export type FlowStatusState = {
  flowId: string | null;
  executionState: FlowExecutionState | null;
};

export type FlowTreeFolderNode = {
  kind: "folder";
  key: string;
  name: string;
  pathSegments: string[];
  children: FlowTreeNode[];
};

export type FlowTreeFlowNode = {
  kind: "flow";
  key: string;
  name: string;
  pathSegments: string[];
  flow: InteractiveFlowDefinition;
};

export type FlowTreeNode = FlowTreeFolderNode | FlowTreeFlowNode;

export type VisibleFlowTreeItem =
  | {
      kind: "folder";
      key: string;
      name: string;
      depth: number;
      pathSegments: string[];
    }
  | {
      kind: "flow";
      key: string;
      name: string;
      depth: number;
      pathSegments: string[];
      flow: InteractiveFlowDefinition;
    };

export type GroupedPhaseItem =
  | {
      kind: "phase";
      phase: InteractiveFlowDefinition["phases"][number];
    }
  | {
      kind: "group";
      label: string;
      phases: InteractiveFlowDefinition["phases"];
      seriesKey: string;
    };

export type ProgressViewModelItem =
  | {
      kind: "group";
      label: string;
      depth: number;
      status: FlowStatus;
    }
  | {
      kind: "phase";
      label: string;
      depth: number;
      status: FlowStatus;
    }
  | {
      kind: "step";
      label: string;
      depth: number;
      status: FlowStatus;
    }
  | {
      kind: "termination";
      label: string;
      detail: string;
      depth: number;
      status: "done" | "running";
    };

export type ProgressViewModel = {
  flow: InteractiveFlowDefinition | null;
  items: ProgressViewModelItem[];
  anchorIndex: number | null;
};
