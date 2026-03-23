import type { ExecutorContext, RuntimeServices } from "../executors/types.js";
import type { OutputAdapter } from "../tui.js";
import type { NodeRegistry } from "./node-registry.js";
import type { ExecutorRegistry } from "./registry.js";

export type NodeOutputSpec =
  | {
      kind: "artifact";
      path: string;
      required: boolean;
    }
  | {
      kind: "file";
      path: string;
      required: boolean;
    };

export type NodeCheckSpec =
  | {
      kind: "require-artifacts";
      paths: string[];
      message: string;
    }
  | {
      kind: "require-file";
      path: string;
      message: string;
    };

export type PipelineNodeResult<TResult> = {
  value: TResult;
  outputs?: NodeOutputSpec[];
};

export type PipelineContext = {
  issueKey: string;
  jiraRef: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  ui: OutputAdapter;
  dryRun: boolean;
  verbose: boolean;
  runtime: RuntimeServices;
  executors: ExecutorRegistry;
  nodes: NodeRegistry;
  setSummary?: (markdown: string) => void;
};

export type PipelineNodeDefinition<TParams, TResult> = {
  kind: string;
  version: number;
  run: (context: PipelineContext, params: TParams) => Promise<PipelineNodeResult<TResult>>;
  checks?: (context: PipelineContext, params: TParams, result: PipelineNodeResult<TResult>) => NodeCheckSpec[];
};

export function toExecutorContext(context: PipelineContext): ExecutorContext {
  return {
    cwd: context.cwd,
    env: context.env,
    ui: context.ui,
    dryRun: context.dryRun,
    verbose: context.verbose,
    runtime: context.runtime,
  };
}
