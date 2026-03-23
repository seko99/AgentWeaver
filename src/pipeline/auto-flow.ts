import { loadDeclarativeFlow } from "./declarative-flows.js";
import type { ExpandedPhaseSpec } from "./spec-types.js";

type LoadedAutoFlow = {
  kind: string;
  version: number;
  constants: Record<string, unknown>;
  phases: ExpandedPhaseSpec[];
};

let cachedAutoFlow: LoadedAutoFlow | null = null;

export function loadAutoFlow(): LoadedAutoFlow {
  if (cachedAutoFlow) {
    return cachedAutoFlow;
  }
  cachedAutoFlow = loadDeclarativeFlow("auto.json");
  return cachedAutoFlow;
}
