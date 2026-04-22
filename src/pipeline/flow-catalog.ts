import path from "node:path";

import { TaskRunnerError } from "../errors.js";
import { loadAutoGolangFlow } from "./auto-flow.js";
import { collectFlowRoutingGroups, type DeclarativeFlowLoadOptions, type DeclarativeFlowRef, loadDeclarativeFlow, type LoadedDeclarativeFlow } from "./declarative-flows.js";
import type { ExecutionRoutingGroup } from "./execution-routing-config.js";
import { globalFlowSpecsDir, listBuiltInFlowSpecFiles, listGlobalFlowSpecFiles, listProjectFlowSpecFiles, projectFlowSpecsDir } from "./spec-loader.js";

export type FlowCatalogSource = "built-in" | "global" | "project-local";

export type FlowCatalogEntry = {
  id: string;
  source: FlowCatalogSource;
  fileName: string;
  absolutePath: string;
  treePath: string[];
  flow: LoadedDeclarativeFlow;
};

export const BUILT_IN_COMMAND_FLOW_IDS = [
  "auto-golang",
  "auto-common",
  "auto-simple",
  "bug-analyze",
  "bug-fix",
  "design-review",
  "git-commit",
  "gitlab-diff-review",
  "gitlab-review",
  "instant-task",
  "mr-description",
  "plan",
  "plan-revise",
  "task-describe",
  "implement",
  "review",
  "review-fix",
  "review-loop",
  "run-go-tests-loop",
  "run-go-linter-loop",
] as const;

const BUILT_IN_COMMAND_FLOW_FILES: Record<(typeof BUILT_IN_COMMAND_FLOW_IDS)[number], string> = {
  "auto-golang": "auto-golang.json",
  "auto-common": "auto-common.json",
  "auto-simple": "auto-simple.json",
  "bug-analyze": "bugz/bug-analyze.json",
  "bug-fix": "bugz/bug-fix.json",
  "design-review": "design-review.json",
  "git-commit": "git-commit.json",
  "gitlab-diff-review": "gitlab/gitlab-diff-review.json",
  "gitlab-review": "gitlab/gitlab-review.json",
  "instant-task": "instant-task.json",
  "mr-description": "gitlab/mr-description.json",
  plan: "plan.json",
  "plan-revise": "plan-revise.json",
  "task-describe": "task-describe.json",
  implement: "implement.json",
  review: "review/review.json",
  "review-fix": "review/review-fix.json",
  "review-loop": "review/review-loop.json",
  "run-go-tests-loop": "go/run-go-tests-loop.json",
  "run-go-linter-loop": "go/run-go-linter-loop.json",
};

export function builtInCommandFlowFile(flowId: string): string | null {
  return BUILT_IN_COMMAND_FLOW_FILES[flowId as (typeof BUILT_IN_COMMAND_FLOW_IDS)[number]] ?? null;
}

function builtInCommandIdForFile(fileName: string): (typeof BUILT_IN_COMMAND_FLOW_IDS)[number] | null {
  for (const [flowId, candidate] of Object.entries(BUILT_IN_COMMAND_FLOW_FILES)) {
    if (candidate === fileName) {
      return flowId as (typeof BUILT_IN_COMMAND_FLOW_IDS)[number];
    }
  }
  return null;
}

async function loadBuiltInCatalogEntry(fileName: string, options: DeclarativeFlowLoadOptions): Promise<FlowCatalogEntry> {
  const commandId = builtInCommandIdForFile(fileName);
  const relativePath = fileName.replace(/\.json$/i, "").split(/[\\/]+/).filter((segment) => segment.length > 0);
  const id = commandId ?? relativePath.join("/");
  const flow = id === "auto-golang"
    ? await loadAutoGolangFlow(options)
    : await loadDeclarativeFlow({ source: "built-in", fileName }, options);
  return {
    id,
    source: "built-in",
    fileName,
    absolutePath: flow.absolutePath,
    treePath: ["default", ...relativePath],
    flow,
  };
}

async function loadProjectCatalogEntry(cwd: string, filePath: string, options: DeclarativeFlowLoadOptions): Promise<FlowCatalogEntry> {
  const flow = await loadDeclarativeFlow({ source: "project-local", filePath }, { ...options, cwd });
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

async function loadGlobalCatalogEntry(filePath: string, options: DeclarativeFlowLoadOptions): Promise<FlowCatalogEntry> {
  const flow = await loadDeclarativeFlow({ source: "global", filePath }, options);
  const relativeFilePath = path.relative(globalFlowSpecsDir(), path.resolve(filePath));
  const relativePathWithoutExt = relativeFilePath.replace(/\.json$/i, "");
  const relativeSegments = relativePathWithoutExt.split(path.sep).filter((segment) => segment.length > 0);
  return {
    id: relativeSegments.join("/"),
    source: "global",
    fileName: path.basename(filePath),
    absolutePath: path.resolve(filePath),
    treePath: ["global", ...relativeSegments],
    flow,
  };
}

export async function loadInteractiveFlowCatalog(cwd: string, options: DeclarativeFlowLoadOptions = {}): Promise<FlowCatalogEntry[]> {
  const entries: FlowCatalogEntry[] = [];
  for (const fileName of listBuiltInFlowSpecFiles()) {
    entries.push(await loadBuiltInCatalogEntry(fileName, { ...options, cwd }));
  }
  for (const filePath of listGlobalFlowSpecFiles()) {
    entries.push(await loadGlobalCatalogEntry(filePath, { ...options, cwd }));
  }
  for (const filePath of listProjectFlowSpecFiles(cwd)) {
    entries.push(await loadProjectCatalogEntry(cwd, filePath, { ...options, cwd }));
  }

  const visibleEntries = entries.filter((entry) => entry.flow.catalogVisibility !== "hidden");

  const byId = new Map<string, FlowCatalogEntry>();
  for (const entry of visibleEntries) {
    const duplicate = byId.get(entry.id);
    if (duplicate) {
      throw new TaskRunnerError(
        `Flow id '${entry.id}' conflicts between ${duplicate.absolutePath} and ${entry.absolutePath}. Rename one of the flow files.`,
      );
    }
    byId.set(entry.id, entry);
  }
  return visibleEntries;
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
    : { source: entry.source, filePath: entry.absolutePath };
}

export function flowRoutingKey(entry: FlowCatalogEntry): string {
  return entry.source === "built-in"
    ? `built-in:${entry.id}`
    : `${entry.source}:${entry.absolutePath}`;
}

export async function flowRoutingGroups(
  entry: FlowCatalogEntry,
  cwd: string,
  options: DeclarativeFlowLoadOptions = {},
): Promise<ExecutionRoutingGroup[]> {
  return collectFlowRoutingGroups(entry.flow, cwd, new Set<string>(), options);
}
