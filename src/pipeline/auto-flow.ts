import { loadDeclarativeFlow, type LoadedDeclarativeFlow } from "./declarative-flows.js";

type LoadedAutoGolangFlow = LoadedDeclarativeFlow;

let cachedAutoGolangFlow: LoadedAutoGolangFlow | null = null;

export function loadAutoGolangFlow(): LoadedAutoGolangFlow {
  if (cachedAutoGolangFlow) {
    return cachedAutoGolangFlow;
  }
  cachedAutoGolangFlow = loadDeclarativeFlow({ source: "built-in", fileName: "auto-golang.json" });
  return cachedAutoGolangFlow;
}
