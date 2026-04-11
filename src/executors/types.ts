import type { OutputAdapter } from "../tui.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;

export type RuntimeServices = {
  resolveCmd: (commandName: string, envVarName: string) => string;
  runCommand: (
    argv: string[],
    options?: {
      env?: NodeJS.ProcessEnv;
      dryRun?: boolean;
      verbose?: boolean;
      label?: string;
      printFailureOutput?: boolean;
      signal?: AbortSignal;
    },
  ) => Promise<string>;
};

export type ExecutorContext = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  ui: OutputAdapter;
  dryRun: boolean;
  verbose: boolean;
  mdLang?: "en" | "ru" | null;
  runtime: RuntimeServices;
};

export type ExecutorDefinition<TConfig extends JsonValue, TInput, TResult> = {
  kind: string;
  version: number;
  defaultConfig: TConfig;
  execute: (context: ExecutorContext, input: TInput, config: TConfig) => Promise<TResult>;
};
