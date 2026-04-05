import path from "node:path";

import { TaskRunnerError } from "../errors.js";
import { loadAutoFlow } from "./auto-flow.js";
import { type DeclarativeFlowRef, loadDeclarativeFlow, type LoadedDeclarativeFlow } from "./declarative-flows.js";
import { listProjectFlowSpecFiles, projectFlowSpecsDir } from "./spec-loader.js";

export type FlowCatalogSource = "built-in" | "project-local";

export type FlowCatalogEntry = {
  id: string;
  source: FlowCatalogSource;
  fileName: string;
  absolutePath: string;
  treePath: string[];
  flow: LoadedDeclarativeFlow;
};

export const INTERACTIVE_BUILT_IN_FLOWS = [
  { id: "auto", fileName: "auto.json" },
  { id: "bug-analyze", fileName: "bug-analyze.json" },
  { id: "bug-fix", fileName: "bug-fix.json" },
  { id: "gitlab-diff-review", fileName: "gitlab-diff-review.json" },
  { id: "gitlab-review", fileName: "gitlab-review.json" },
  { id: "mr-description", fileName: "mr-description.json" },
  { id: "plan", fileName: "plan.json" },
  { id: "task-describe", fileName: "task-describe.json" },
  { id: "implement", fileName: "implement.json" },
  { id: "review", fileName: "review.json" },
  { id: "review-fix", fileName: "review-fix.json" },
  { id: "run-go-tests-loop", fileName: "run-go-tests-loop.json" },
  { id: "run-go-linter-loop", fileName: "run-go-linter-loop.json" },
] as const;

function loadBuiltInCatalogEntry(id: string, fileName: string): FlowCatalogEntry {
  const flow = id === "auto" ? loadAutoFlow() : loadDeclarativeFlow({ source: "built-in", fileName });
  const relativePath = fileName.replace(/\.json$/i, "").split(/[\\/]+/).filter((segment) => segment.length > 0);
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
  const entries: FlowCatalogEntry[] = INTERACTIVE_BUILT_IN_FLOWS.map((entry) => loadBuiltInCatalogEntry(entry.id, entry.fileName));
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
  return INTERACTIVE_BUILT_IN_FLOWS.some((entry) => entry.id === flowId);
}

export function toDeclarativeFlowRef(entry: FlowCatalogEntry): DeclarativeFlowRef {
  return entry.source === "built-in"
    ? { source: "built-in", fileName: entry.fileName }
    : { source: "project-local", filePath: entry.absolutePath };
}
