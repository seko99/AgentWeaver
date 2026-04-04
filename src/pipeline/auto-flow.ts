import { loadDeclarativeFlow, type LoadedDeclarativeFlow } from "./declarative-flows.js";

type LoadedAutoFlow = LoadedDeclarativeFlow;

let cachedAutoFlow: LoadedAutoFlow | null = null;

export function loadAutoFlow(): LoadedAutoFlow {
  if (cachedAutoFlow) {
    return cachedAutoFlow;
  }
  cachedAutoFlow = loadDeclarativeFlow({ source: "built-in", fileName: "auto.json" });
  return cachedAutoFlow;
}
