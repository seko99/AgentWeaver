import type { PipelineContext } from "./types.js";

export type FlowStepResult = {
  completed: boolean;
  metadata?: Record<string, string | number | boolean | null>;
};

export type FlowStepDefinition<TParams> = {
  id: string;
  run: (context: PipelineContext, params: TParams) => Promise<FlowStepResult>;
};

export type FlowDefinition<TParams> = {
  kind: string;
  version: number;
  steps: FlowStepDefinition<TParams>[];
};

export type FlowRunResult = {
  steps: Array<{
    id: string;
    result: FlowStepResult;
  }>;
};

export type FlowRunOptions<TParams> = {
  onStepStart?: (step: FlowStepDefinition<TParams>) => void | Promise<void>;
  onStepComplete?: (step: FlowStepDefinition<TParams>, result: FlowStepResult) => void | Promise<void>;
};
