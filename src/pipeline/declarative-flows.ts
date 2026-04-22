import path from "node:path";

import type { ExecutionRoutingGroup } from "./execution-routing-config.js";
import { createPipelineRegistryContext, type PipelineRegistryContext } from "./plugin-loader.js";
import { compileFlowSpec } from "./spec-compiler.js";
import {
  type FlowSpecSource,
  globalFlowSpecsDir,
  listBuiltInFlowSpecFiles,
  listGlobalFlowSpecFiles,
  listProjectFlowSpecFiles,
  loadFlowSpecSync,
  projectFlowSpecsDir,
  resolveBuiltInFlowSpecPath,
} from "./spec-loader.js";
import type { ExpandedPhaseSpec } from "./spec-types.js";
import { validateExpandedPhases, validateFlowSpec } from "./spec-validator.js";

export type DeclarativeFlowRef =
  | { source: "built-in"; fileName: string }
  | { source: "global"; filePath: string }
  | { source: "project-local"; filePath: string };

export type LoadedDeclarativeFlow = {
  kind: string;
  version: number;
  description?: string;
  catalogVisibility?: "visible" | "hidden";
  constants: Record<string, unknown>;
  phases: ExpandedPhaseSpec[];
  source: FlowSpecSource["source"];
  fileName: string;
  absolutePath: string;
};

const cache = new Map<string, LoadedDeclarativeFlow>();

export type DeclarativeFlowLoadOptions = {
  cwd?: string;
  registryContext?: PipelineRegistryContext;
};

function toFlowSpecSource(ref: DeclarativeFlowRef): FlowSpecSource {
  if (ref.source === "built-in") {
    return { source: "built-in", fileName: ref.fileName };
  }
  return { source: ref.source, filePath: ref.filePath };
}

function cacheKey(ref: DeclarativeFlowRef, registryContext: PipelineRegistryContext): string {
  const flowKey = ref.source === "built-in"
    ? `built-in:${ref.fileName}`
    : `${ref.source}:${path.resolve(ref.filePath)}`;
  return `${registryContext.cacheKey}:${flowKey}`;
}

export async function loadDeclarativeFlow(
  flow: DeclarativeFlowRef | string,
  options: DeclarativeFlowLoadOptions = {},
): Promise<LoadedDeclarativeFlow> {
  const ref = typeof flow === "string" ? ({ source: "built-in", fileName: flow } satisfies DeclarativeFlowRef) : flow;
  const cwd = path.resolve(options.cwd ?? options.registryContext?.cwd ?? process.cwd());
  const registryContext = options.registryContext ?? await createPipelineRegistryContext(cwd);
  const cached = cache.get(cacheKey(ref, registryContext));
  if (cached) {
    return cached;
  }
  const spec = loadFlowSpecSync(toFlowSpecSource(ref));
  validateFlowSpec(spec, registryContext.nodes, registryContext.executors, {
    resolveFlowByName: (fileName) => resolveNamedDeclarativeFlowRef(fileName, cwd),
  });
  const phases = compileFlowSpec(spec);
  validateExpandedPhases(phases);
  const loaded: LoadedDeclarativeFlow = {
    kind: spec.kind,
    version: spec.version,
    ...(spec.description !== undefined ? { description: spec.description } : {}),
    ...(spec.catalogVisibility !== undefined ? { catalogVisibility: spec.catalogVisibility } : {}),
    constants: spec.constants ?? {},
    phases,
    source: ref.source,
    fileName: ref.source === "built-in" ? ref.fileName : path.basename(ref.filePath),
    absolutePath: ref.source === "built-in" ? resolveBuiltInFlowSpecPath(ref.fileName) : path.resolve(ref.filePath),
  };
  cache.set(cacheKey(ref, registryContext), loaded);
  return loaded;
}

export function resolveNamedDeclarativeFlowRef(fileName: string, cwd: string): DeclarativeFlowRef {
  const projectMatches = listProjectFlowSpecFiles(cwd).filter((candidate) => path.basename(candidate) === fileName);
  const globalMatches = listGlobalFlowSpecFiles().filter((candidate) => path.basename(candidate) === fileName);
  const builtInMatches = listBuiltInFlowSpecFiles().filter((candidate) => path.basename(candidate) === fileName);
  const sourcesWithMatches = [
    projectMatches.length > 0 ? `project-local specs in ${projectFlowSpecsDir(cwd)}` : null,
    globalMatches.length > 0 ? `global specs in ${globalFlowSpecsDir()}` : null,
    builtInMatches.length > 0 ? "built-in specs" : null,
  ].filter((value): value is string => value !== null);
  if (sourcesWithMatches.length > 1) {
    throw new Error(`Ambiguous nested flow '${fileName}': found in ${sourcesWithMatches.join(", ")}.`);
  }
  if (projectMatches.length > 1) {
    throw new Error(`Ambiguous project-local flow '${fileName}' in ${projectFlowSpecsDir(cwd)}.`);
  }
  if (globalMatches.length > 1) {
    throw new Error(`Ambiguous global flow '${fileName}' in ${globalFlowSpecsDir()}.`);
  }
  if (builtInMatches.length > 1) {
    throw new Error(`Ambiguous built-in flow '${fileName}'. Use unique nested flow file names.`);
  }
  if (projectMatches[0]) {
    return { source: "project-local", filePath: projectMatches[0] };
  }
  if (globalMatches[0]) {
    return { source: "global", filePath: globalMatches[0] };
  }
  if (builtInMatches[0]) {
    return { source: "built-in", fileName: builtInMatches[0] };
  }
  throw new Error(`Nested flow '${fileName}' was not found.`);
}

export async function loadNamedDeclarativeFlow(
  fileName: string,
  cwd: string,
  options: DeclarativeFlowLoadOptions = {},
): Promise<LoadedDeclarativeFlow> {
  return loadDeclarativeFlow(resolveNamedDeclarativeFlowRef(fileName, cwd), {
    cwd,
    ...(options.registryContext ? { registryContext: options.registryContext } : {}),
  });
}

export async function collectFlowRoutingGroups(
  flow: LoadedDeclarativeFlow,
  cwd: string,
  visited = new Set<string>(),
  options: DeclarativeFlowLoadOptions = {},
): Promise<ExecutionRoutingGroup[]> {
  if (visited.has(flow.absolutePath)) {
    return [];
  }
  visited.add(flow.absolutePath);
  const groups = new Set<ExecutionRoutingGroup>();
  for (const phase of flow.phases) {
    for (const step of phase.steps) {
      if (step.routingGroup) {
        groups.add(step.routingGroup);
      }
      if (step.node !== "flow-run") {
        continue;
      }
      const nestedFlowName = step.params?.fileName;
      if (!nestedFlowName || !("const" in nestedFlowName) || typeof nestedFlowName.const !== "string") {
        continue;
      }
      const nestedFlow = await loadNamedDeclarativeFlow(nestedFlowName.const, cwd, options);
      for (const nestedGroup of await collectFlowRoutingGroups(nestedFlow, cwd, visited, options)) {
        groups.add(nestedGroup);
      }
    }
  }
  return [...groups];
}
