import { REGISTRY } from "../registry.js";
import { systemChecks } from "./system.js";
import { nodeVersionCheck } from "./node-version.js";
import { agentweaverHomeCheck } from "./agentweaver-home.js";
import { cwdContextCheck } from "./cwd-context.js";
import { codexExecutorCheck, opencodeExecutorCheck } from "./executors.js";

REGISTRY.register(nodeVersionCheck);

for (const check of systemChecks) {
  REGISTRY.register(check);
}

REGISTRY.register(agentweaverHomeCheck);
REGISTRY.register(cwdContextCheck);
REGISTRY.register(codexExecutorCheck);
REGISTRY.register(opencodeExecutorCheck);
