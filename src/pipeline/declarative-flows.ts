import { createNodeRegistry } from "./node-registry.js";
import { compileFlowSpec } from "./spec-compiler.js";
import { loadFlowSpecSync } from "./spec-loader.js";
import type { ExpandedPhaseSpec } from "./spec-types.js";
import { validateExpandedPhases, validateFlowSpec } from "./spec-validator.js";

type LoadedDeclarativeFlow = {
  kind: string;
  version: number;
  constants: Record<string, unknown>;
  phases: ExpandedPhaseSpec[];
};

const cache = new Map<string, LoadedDeclarativeFlow>();

export function loadDeclarativeFlow(fileName: string): LoadedDeclarativeFlow {
  const cached = cache.get(fileName);
  if (cached) {
    return cached;
  }
  const spec = loadFlowSpecSync(fileName);
  const nodeRegistry = createNodeRegistry();
  validateFlowSpec(spec, nodeRegistry);
  const phases = compileFlowSpec(spec);
  validateExpandedPhases(phases);
  const loaded = {
    kind: spec.kind,
    version: spec.version,
    constants: spec.constants ?? {},
    phases,
  };
  cache.set(fileName, loaded);
  return loaded;
}
