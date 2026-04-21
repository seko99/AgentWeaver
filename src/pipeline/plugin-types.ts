import type { ExecutorDefinition, JsonValue } from "../executors/types.js";
import type { PipelineNodeDefinition } from "./types.js";
import type { NodeContractMetadata } from "./node-contract.js";

export const AGENTWEAVER_PLUGIN_SDK_VERSION = 1;

export type PluginManifest = {
  id: string;
  sdk_version: number;
  entrypoint: string;
  name?: string;
  version?: string;
  description?: string;
};

export type PluginExecutorRegistration = {
  id: string;
  definition: ExecutorDefinition<JsonValue, unknown, unknown>;
};

export type PluginNodeRegistration = {
  id: string;
  definition: PipelineNodeDefinition<Record<string, unknown>, unknown>;
  metadata: NodeContractMetadata;
};

export type PluginEntryModuleExports = {
  executors?: PluginExecutorRegistration[];
  nodes?: PluginNodeRegistration[];
};

export type PluginOwner = {
  kind: "core" | "plugin";
  id: string;
  manifestPath: string;
  entrypointPath?: string;
};

export type NormalizedPluginExecutorRegistration = {
  type: "executor";
  id: string;
  pluginId: string;
  manifestPath: string;
  entrypointPath: string;
  definition: ExecutorDefinition<JsonValue, unknown, unknown>;
};

export type NormalizedPluginNodeRegistration = {
  type: "node";
  id: string;
  pluginId: string;
  manifestPath: string;
  entrypointPath: string;
  definition: PipelineNodeDefinition<Record<string, unknown>, unknown>;
  metadata: NodeContractMetadata;
};

export type LoadedPlugin = {
  manifest: PluginManifest;
  manifestPath: string;
  entrypointPath: string;
  executors: NormalizedPluginExecutorRegistration[];
  nodes: NormalizedPluginNodeRegistration[];
};

export type PluginRegistryCollision = {
  registrationType: "executor" | "node";
  id: string;
  owner: PluginOwner;
  conflictingOwner: PluginOwner;
};
