import path from "node:path";

import type { ExecutionRoutingGroup } from "./execution-routing-config.js";
import { createNodeRegistry } from "./node-registry.js";
import { createExecutorRegistry } from "./registry.js";
import { compileFlowSpec } from "./spec-compiler.js";
import { type FlowSpecSource, listBuiltInFlowSpecFiles, listProjectFlowSpecFiles, loadFlowSpecSync, projectFlowSpecsDir, resolveBuiltInFlowSpecPath } from "./spec-loader.js";
import type { ExpandedPhaseSpec } from "./spec-types.js";
import { validateExpandedPhases, validateFlowSpec } from "./spec-validator.js";

export type DeclarativeFlowRef =
  | { source: "built-in"; fileName: string }
  | { source: "project-local"; filePath: string };

export type LoadedDeclarativeFlow = {
  kind: string;
  version: number;
  description?: string;
  constants: Record<string, unknown>;
  phases: ExpandedPhaseSpec[];
  source: FlowSpecSource["source"];
  fileName: string;
  absolutePath: string;
};

const cache = new Map<string, LoadedDeclarativeFlow>();

function toFlowSpecSource(ref: DeclarativeFlowRef): FlowSpecSource {
  return ref.source === "built-in" ? { source: "built-in", fileName: ref.fileName } : { source: "project-local", filePath: ref.filePath };
}

function cacheKey(ref: DeclarativeFlowRef): string {
  return ref.source === "built-in" ? `built-in:${ref.fileName}` : `project-local:${path.resolve(ref.filePath)}`;
}

export function loadDeclarativeFlow(flow: DeclarativeFlowRef | string): LoadedDeclarativeFlow {
  const ref = typeof flow === "string" ? ({ source: "built-in", fileName: flow } satisfies DeclarativeFlowRef) : flow;
  const cached = cache.get(cacheKey(ref));
  if (cached) {
    return cached;
  }
  const spec = loadFlowSpecSync(toFlowSpecSource(ref));
  const nodeRegistry = createNodeRegistry();
  const executorRegistry = createExecutorRegistry();
  validateFlowSpec(spec, nodeRegistry, executorRegistry, {
    resolveFlowByName: (fileName) => resolveNamedDeclarativeFlowRef(fileName, process.cwd()),
  });
  const phases = compileFlowSpec(spec);
  validateExpandedPhases(phases);
  const loaded: LoadedDeclarativeFlow = {
    kind: spec.kind,
    version: spec.version,
    ...(spec.description !== undefined ? { description: spec.description } : {}),
    constants: spec.constants ?? {},
    phases,
    source: ref.source,
    fileName: ref.source === "built-in" ? ref.fileName : path.basename(ref.filePath),
    absolutePath: ref.source === "built-in" ? resolveBuiltInFlowSpecPath(ref.fileName) : path.resolve(ref.filePath),
  };
  cache.set(cacheKey(ref), loaded);
  return loaded;
}

export function resolveNamedDeclarativeFlowRef(fileName: string, cwd: string): DeclarativeFlowRef {
  const projectMatches = listProjectFlowSpecFiles(cwd).filter((candidate) => path.basename(candidate) === fileName);
  const builtInMatches = listBuiltInFlowSpecFiles().filter((candidate) => path.basename(candidate) === fileName);
  if (projectMatches.length > 0 && builtInMatches.length > 0) {
    throw new Error(
      `Ambiguous nested flow '${fileName}': both built-in and project-local specs exist in ${projectFlowSpecsDir(cwd)}.`,
    );
  }
  if (projectMatches.length > 1) {
    throw new Error(`Ambiguous project-local flow '${fileName}' in ${projectFlowSpecsDir(cwd)}.`);
  }
  if (builtInMatches.length > 1) {
    throw new Error(`Ambiguous built-in flow '${fileName}'. Use unique nested flow file names.`);
  }
  if (projectMatches[0]) {
    return { source: "project-local", filePath: projectMatches[0] };
  }
  if (builtInMatches[0]) {
    return { source: "built-in", fileName: builtInMatches[0] };
  }
  throw new Error(`Nested flow '${fileName}' was not found.`);
}

export function loadNamedDeclarativeFlow(fileName: string, cwd: string): LoadedDeclarativeFlow {
  return loadDeclarativeFlow(resolveNamedDeclarativeFlowRef(fileName, cwd));
}

export function collectFlowRoutingGroups(
  flow: LoadedDeclarativeFlow,
  cwd: string,
  visited = new Set<string>(),
): ExecutionRoutingGroup[] {
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
      const nestedFlow = loadNamedDeclarativeFlow(nestedFlowName.const, cwd);
      for (const nestedGroup of collectFlowRoutingGroups(nestedFlow, cwd, visited)) {
        groups.add(nestedGroup);
      }
    }
  }
  return [...groups];
}
