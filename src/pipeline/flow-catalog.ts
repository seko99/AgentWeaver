import path from "node:path";

import { TaskRunnerError } from "../errors.js";
import { loadAutoFlow } from "./auto-flow.js";
import { type DeclarativeFlowRef, loadDeclarativeFlow, type LoadedDeclarativeFlow } from "./declarative-flows.js";
import { listBuiltInFlowSpecFiles, listProjectFlowSpecFiles, projectFlowSpecsDir } from "./spec-loader.js";

export type FlowCatalogSource = "built-in" | "project-local";

export type FlowCatalogEntry = {
  id: string;
  source: FlowCatalogSource;
  fileName: string;
  absolutePath: string;
  treePath: string[];
  flow: LoadedDeclarativeFlow;
};

export const BUILT_IN_COMMAND_FLOW_IDS = [
  "auto",
  "bug-analyze",
  "bug-fix",
  "gitlab-diff-review",
  "gitlab-review",
  "mr-description",
  "plan",
  "task-describe",
  "implement",
  "review",
  "review-fix",
  "run-go-tests-loop",
  "run-go-linter-loop",
] as const;

function loadBuiltInCatalogEntry(fileName: string): FlowCatalogEntry {
  const relativePath = fileName.replace(/\.json$/i, "").split(/[\\/]+/).filter((segment) => segment.length > 0);
  const id = relativePath.join("/");
  const flow = id === "auto" ? loadAutoFlow() : loadDeclarativeFlow({ source: "built-in", fileName });
  return {
    id,
    source: "built-in",
    fileName,
    absolutePath: flow.absolutePath,
    treePath: ["default", ...relativePath],
    flow,
  };
}

function loadProjectCatalogEntry(cwd: string, filePath: string): FlowCatalogEntry {
  const flow = loadDeclarativeFlow({ source: "project-local", filePath });
  const relativeFilePath = path.relative(projectFlowSpecsDir(cwd), path.resolve(filePath));
  const relativePathWithoutExt = relativeFilePath.replace(/\.json$/i, "");
  const relativeSegments = relativePathWithoutExt.split(path.sep).filter((segment) => segment.length > 0);
  return {
    id: relativeSegments.join("/"),
    source: "project-local",
    fileName: path.basename(filePath),
    absolutePath: path.resolve(filePath),
    treePath: ["custom", ...relativeSegments],
    flow,
  };
}

export function loadInteractiveFlowCatalog(cwd: string): FlowCatalogEntry[] {
  const entries: FlowCatalogEntry[] = listBuiltInFlowSpecFiles().map((fileName) => loadBuiltInCatalogEntry(fileName));
  for (const filePath of listProjectFlowSpecFiles(cwd)) {
    entries.push(loadProjectCatalogEntry(cwd, filePath));
  }

  const byId = new Map<string, FlowCatalogEntry>();
  for (const entry of entries) {
    const duplicate = byId.get(entry.id);
    if (duplicate) {
      throw new TaskRunnerError(
        `Flow id '${entry.id}' conflicts between ${duplicate.absolutePath} and ${entry.absolutePath}. Rename one of the flow files.`,
      );
    }
    byId.set(entry.id, entry);
  }
  return entries;
}

export function findCatalogEntry(flowId: string, entries: FlowCatalogEntry[]): FlowCatalogEntry | undefined {
  return entries.find((entry) => entry.id === flowId);
}

export function isBuiltInCommandFlowId(flowId: string): boolean {
  return BUILT_IN_COMMAND_FLOW_IDS.includes(flowId as (typeof BUILT_IN_COMMAND_FLOW_IDS)[number]);
}

export function toDeclarativeFlowRef(entry: FlowCatalogEntry): DeclarativeFlowRef {
  return entry.source === "built-in"
    ? { source: "built-in", fileName: entry.fileName }
    : { source: "project-local", filePath: entry.absolutePath };
}
