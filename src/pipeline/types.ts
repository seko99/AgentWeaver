import type { ExecutorContext, RuntimeServices } from "../executors/types.js";
import type { ArtifactLineageInput, ArtifactPayloadFamily } from "../artifact-manifest.js";
import type { StructuredArtifactCheck } from "../structured-artifacts.js";
import type { OutputAdapter } from "../tui.js";
import type { UserInputRequester } from "../user-input.js";
import type { ResolvedExecutionRouting } from "./execution-routing-config.js";
import type { NodeRegistry } from "./node-registry.js";
import type { ExecutorRegistry } from "./registry.js";

export type NodeOutputManifestSpec = {
  publish?: boolean;
  logicalKey?: string;
  schemaId?: string;
  schemaVersion?: number;
  payloadFamily?: ArtifactPayloadFamily;
  inputRefs?: ArtifactLineageInput[];
};

export type NodeOutputSpec =
  | {
      kind: "artifact";
      path: string;
      required: boolean;
      manifest?: NodeOutputManifestSpec;
    }
  | {
      kind: "file";
      path: string;
      required: boolean;
      manifest?: NodeOutputManifestSpec;
    };

export type NodeCheckSpec =
  | {
      kind: "require-artifacts";
      paths: string[];
      message: string;
    }
  | {
      kind: "require-structured-artifacts";
      items: StructuredArtifactCheck[];
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
  mdLang?: "en" | "ru" | null;
  runtime: RuntimeServices;
  executors: ExecutorRegistry;
  nodes: NodeRegistry;
  setSummary?: (markdown: string) => void;
  requestUserInput?: UserInputRequester;
  executionRouting?: ResolvedExecutionRouting;
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
    mdLang: context.mdLang ?? null,
    runtime: context.runtime,
  };
}
