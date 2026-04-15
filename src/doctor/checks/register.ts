import { REGISTRY } from "../registry.js";
import { systemChecks } from "./system.js";
import { nodeVersionCheck } from "./node-version.js";
import { agentweaverHomeCheck } from "./agentweaver-home.js";
import { cwdContextCheck } from "./cwd-context.js";
import { codexExecutorCheck, opencodeExecutorCheck } from "./executors.js";
import { envDiagnosticsCheck } from "./env-diagnostics.js";
import { flowReadinessCheck } from "./flow-readiness.js";

REGISTRY.register(nodeVersionCheck);

for (const check of systemChecks) {
  REGISTRY.register(check);
}

REGISTRY.register(agentweaverHomeCheck);
REGISTRY.register(cwdContextCheck);
REGISTRY.register(codexExecutorCheck);
REGISTRY.register(opencodeExecutorCheck);
REGISTRY.register(envDiagnosticsCheck);
REGISTRY.register(flowReadinessCheck);
