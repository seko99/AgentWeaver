import path from "node:path";

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
  const loaded = {
    kind: spec.kind,
    version: spec.version,
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
  const builtInExists = listBuiltInFlowSpecFiles().includes(fileName);
  if (projectMatches.length > 0 && builtInExists) {
    throw new Error(
      `Ambiguous nested flow '${fileName}': both built-in and project-local specs exist in ${projectFlowSpecsDir(cwd)}.`,
    );
  }
  if (projectMatches.length > 1) {
    throw new Error(`Ambiguous project-local flow '${fileName}' in ${projectFlowSpecsDir(cwd)}.`);
  }
  if (projectMatches[0]) {
    return { source: "project-local", filePath: projectMatches[0] };
  }
  if (builtInExists) {
    return { source: "built-in", fileName };
  }
  throw new Error(`Nested flow '${fileName}' was not found.`);
}

export function loadNamedDeclarativeFlow(fileName: string, cwd: string): LoadedDeclarativeFlow {
  return loadDeclarativeFlow(resolveNamedDeclarativeFlowRef(fileName, cwd));
}
