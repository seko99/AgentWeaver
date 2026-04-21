import { loadDeclarativeFlow, type LoadedDeclarativeFlow } from "./declarative-flows.js";
import type { DeclarativeFlowLoadOptions } from "./declarative-flows.js";

type LoadedAutoGolangFlow = LoadedDeclarativeFlow;

const cachedAutoGolangFlows = new Map<string, LoadedAutoGolangFlow>();

export async function loadAutoGolangFlow(options: DeclarativeFlowLoadOptions = {}): Promise<LoadedAutoGolangFlow> {
  const cacheKey = options.registryContext?.cacheKey ?? `cwd:${options.cwd ?? process.cwd()}`;
  const cached = cachedAutoGolangFlows.get(cacheKey);
  if (cached) {
    return cached;
  }
  const flow = await loadDeclarativeFlow({ source: "built-in", fileName: "auto-golang.json" }, options);
  cachedAutoGolangFlows.set(cacheKey, flow);
  return flow;
}
