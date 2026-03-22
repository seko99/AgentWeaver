import { requireArtifacts } from "../artifacts.js";
import { TaskRunnerError } from "../errors.js";
import type { NodeCheckSpec } from "./types.js";

export function runNodeChecks(checks: NodeCheckSpec[]): void {
  for (const check of checks) {
    if (check.kind === "require-artifacts") {
      requireArtifacts(check.paths, check.message);
      continue;
    }
    if (check.kind === "require-file") {
      requireArtifacts([check.path], check.message);
      continue;
    }
    throw new TaskRunnerError(`Unsupported node check: ${(check as { kind?: string }).kind ?? "unknown"}`);
  }
}
