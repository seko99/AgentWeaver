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

const BUILT_IN_COMMAND_FLOW_FILES: Record<(typeof BUILT_IN_COMMAND_FLOW_IDS)[number], string> = {
  auto: "auto.json",
  "bug-analyze": "bugz/bug-analyze.json",
  "bug-fix": "bugz/bug-fix.json",
  "gitlab-diff-review": "gitlab/gitlab-diff-review.json",
  "gitlab-review": "gitlab/gitlab-review.json",
  "mr-description": "gitlab/mr-description.json",
  plan: "plan.json",
  "task-describe": "task-describe.json",
  implement: "implement.json",
  review: "review/review.json",
  "review-fix": "review/review-fix.json",
  "run-go-tests-loop": "go/run-go-tests-loop.json",
  "run-go-linter-loop": "go/run-go-linter-loop.json",
};

function builtInCommandIdForFile(fileName: string): (typeof BUILT_IN_COMMAND_FLOW_IDS)[number] | null {
  for (const [flowId, candidate] of Object.entries(BUILT_IN_COMMAND_FLOW_FILES)) {
    if (candidate === fileName) {
      return flowId as (typeof BUILT_IN_COMMAND_FLOW_IDS)[number];
    }
  }
  return null;
}

function loadBuiltInCatalogEntry(fileName: string): FlowCatalogEntry {
  const commandId = builtInCommandIdForFile(fileName);
  const relativePath = fileName.replace(/\.json$/i, "").split(/[\\/]+/).filter((segment) => segment.length > 0);
  const id = commandId ?? relativePath.join("/");
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
