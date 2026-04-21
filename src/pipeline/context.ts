import process from "node:process";

import type { RuntimeServices } from "../executors/types.js";
import { getOutputAdapter } from "../tui.js";
import type { UserInputRequester } from "../user-input.js";
import type { ResolvedExecutionRouting } from "./execution-routing-config.js";
import { createPipelineRegistryContext, type PipelineRegistryContext } from "./plugin-loader.js";
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
  registryContext?: PipelineRegistryContext;
};

export async function createPipelineContext(input: CreatePipelineContextInput): Promise<PipelineContext> {
  const registryContext = input.registryContext ?? await createPipelineRegistryContext(process.cwd());
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
    executors: registryContext.executors,
    nodes: registryContext.nodes,
    registryContext,
    ...(input.setSummary ? { setSummary: input.setSummary } : {}),
    ...(input.requestUserInput ? { requestUserInput: input.requestUserInput } : {}),
    ...(input.executionRouting ? { executionRouting: input.executionRouting } : {}),
  };
}
