import type { FlowTreeFolderNode, FlowTreeNode, InteractiveFlowDefinition, VisibleFlowTreeItem } from "./types.js";

function compareTreeNames(left: string, right: string): number {
  return left.localeCompare(right, "ru");
}

export function makeFolderKey(pathSegments: string[]): string {
  return `folder:${pathSegments.join("/")}`;
}

export function makeFlowKey(flowId: string): string {
  return `flow:${flowId}`;
}

export function buildFlowTree(flows: InteractiveFlowDefinition[]): FlowTreeNode[] {
  const roots = new Map<string, FlowTreeFolderNode>();

  const ensureFolder = (pathSegments: string[]): FlowTreeFolderNode => {
    const firstSegment = pathSegments[0];
    if (!firstSegment) {
      throw new Error("Flow tree folder path cannot be empty.");
    }

    const rootFolder = roots.get(firstSegment);
    let currentFolder: FlowTreeFolderNode;
    if (rootFolder) {
      currentFolder = rootFolder;
    } else {
      currentFolder = {
        kind: "folder",
        key: makeFolderKey([firstSegment]),
        name: firstSegment,
        pathSegments: [firstSegment],
        children: [],
      };
      roots.set(firstSegment, currentFolder);
    }

    for (let index = 1; index < pathSegments.length; index += 1) {
      const segment = pathSegments[index] ?? "";
      const folderPath = pathSegments.slice(0, index + 1);
      let nextFolder = currentFolder.children.find(
        (child): child is FlowTreeFolderNode => child.kind === "folder" && child.name === segment,
      );
      if (!nextFolder) {
        nextFolder = {
          kind: "folder",
          key: makeFolderKey(folderPath),
          name: segment,
          pathSegments: folderPath,
          children: [],
        };
        currentFolder.children.push(nextFolder);
      }
      currentFolder = nextFolder;
    }

    return currentFolder;
  };

  for (const flow of flows) {
    if (flow.treePath.length === 0) {
      continue;
    }
    const folderPath = flow.treePath.slice(0, -1);
    const leafName = flow.treePath[flow.treePath.length - 1] ?? flow.id;
    const parent = ensureFolder(folderPath);
    parent.children.push({
      kind: "flow",
      key: makeFlowKey(flow.id),
      name: leafName,
      pathSegments: [...flow.treePath],
      flow,
    });
  }

  const sortNodes = (nodes: FlowTreeNode[]): FlowTreeNode[] =>
    [...nodes]
      .sort((left, right) => {
        if (left.kind !== right.kind) {
          return left.kind === "folder" ? -1 : 1;
        }
        return compareTreeNames(left.name, right.name);
      })
      .map((node) =>
        node.kind === "folder"
          ? {
              ...node,
              children: sortNodes(node.children),
            }
          : node,
      );

  const orderedRootNames = ["custom", "default"];
  const sortedRoots = [...roots.values()].sort((left, right) => {
    const leftIndex = orderedRootNames.indexOf(left.name);
    const rightIndex = orderedRootNames.indexOf(right.name);
    if (leftIndex !== -1 || rightIndex !== -1) {
      if (leftIndex === -1) {
        return 1;
      }
      if (rightIndex === -1) {
        return -1;
      }
      return leftIndex - rightIndex;
    }
    return compareTreeNames(left.name, right.name);
  });

  return sortNodes(sortedRoots);
}

export function computeVisibleFlowItems(
  flowTree: FlowTreeNode[],
  expandedFlowFolders: ReadonlySet<string>,
): VisibleFlowTreeItem[] {
  const items: VisibleFlowTreeItem[] = [];

  const walk = (nodes: FlowTreeNode[], depth: number): void => {
    for (const node of nodes) {
      if (node.kind === "folder") {
        items.push({
          kind: "folder",
          key: node.key,
          name: node.name,
          depth,
          pathSegments: [...node.pathSegments],
        });
        if (expandedFlowFolders.has(node.key)) {
          walk(node.children, depth + 1);
        }
        continue;
      }

      items.push({
        kind: "flow",
        key: node.key,
        name: node.name,
        depth,
        pathSegments: [...node.pathSegments],
        flow: node.flow,
      });
    }
  };

  walk(flowTree, 0);
  return items;
}
