import process from "node:process";

import type { RuntimeServices } from "../executors/types.js";
import { getOutputAdapter } from "../tui.js";
import { createNodeRegistry } from "./node-registry.js";
import { createExecutorRegistry } from "./registry.js";
import type { PipelineContext } from "./types.js";

export type CreatePipelineContextInput = {
  issueKey: string;
  jiraRef: string;
  dryRun: boolean;
  verbose: boolean;
  runtime: RuntimeServices;
  setSummary?: (markdown: string) => void;
};

export function createPipelineContext(input: CreatePipelineContextInput): PipelineContext {
  return {
    issueKey: input.issueKey,
    jiraRef: input.jiraRef,
    cwd: process.cwd(),
    env: { ...process.env },
    ui: getOutputAdapter(),
    dryRun: input.dryRun,
    verbose: input.verbose,
    runtime: input.runtime,
    executors: createExecutorRegistry(),
    nodes: createNodeRegistry(),
    ...(input.setSummary ? { setSummary: input.setSummary } : {}),
  };
}
