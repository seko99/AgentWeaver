import process from "node:process";

import type { RuntimeServices } from "../executors/types.js";
import { getOutputAdapter } from "../tui.js";
import type { UserInputRequester } from "../user-input.js";
import type { ResolvedExecutionRouting } from "./execution-routing-config.js";
import { createNodeRegistry } from "./node-registry.js";
import { createExecutorRegistry } from "./registry.js";
import type { PipelineContext } from "./types.js";

export type CreatePipelineContextInput = {
  issueKey: string;
  jiraRef: string;
  dryRun: boolean;
  verbose: boolean;
  mdLang?: "en" | "ru" | null;
  runtime: RuntimeServices;
  setSummary?: (markdown: string) => void;
  requestUserInput?: UserInputRequester;
  executionRouting?: ResolvedExecutionRouting;
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
    mdLang: input.mdLang ?? null,
    runtime: input.runtime,
    executors: createExecutorRegistry(),
    nodes: createNodeRegistry(),
    ...(input.setSummary ? { setSummary: input.setSummary } : {}),
    ...(input.requestUserInput ? { requestUserInput: input.requestUserInput } : {}),
    ...(input.executionRouting ? { executionRouting: input.executionRouting } : {}),
  };
}
