import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { TaskRunnerError } from "../errors.js";
import type { ExecutorDefinition, JsonValue } from "../executors/types.js";
import { createNodeRegistry, type NodeRegistry } from "./node-registry.js";
import { createExecutorRegistry, type ExecutorRegistry } from "./registry.js";
import type { PipelineNodeDefinition } from "./types.js";
import type { NodeContractMetadata, NodeContractPromptMode } from "./node-contract.js";
import {
  AGENTWEAVER_PLUGIN_SDK_VERSION,
  type LoadedPlugin,
  type NormalizedPluginExecutorRegistration,
  type NormalizedPluginNodeRegistration,
  type PluginManifest,
} from "./plugin-types.js";

export type PipelineRegistryContext = {
  cwd: string;
  cacheKey: string;
  executors: ExecutorRegistry;
  nodes: NodeRegistry;
  plugins: LoadedPlugin[];
};

type RawPluginModule = Record<string, unknown>;

function projectPluginsDir(cwd: string): string {
  return path.join(cwd, ".agentweaver", ".plugins");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((candidate) => typeof candidate === "string" && candidate.trim().length > 0);
}

function assertJsonSerializable(value: JsonValue, pluginId: string, pathLabel: string): void {
  const seen = new Set<unknown>();
  const visit = (candidate: unknown, candidatePath: string): void => {
    if (
      candidate === null ||
      typeof candidate === "string" ||
      typeof candidate === "number" ||
      typeof candidate === "boolean"
    ) {
      return;
    }
    if (Array.isArray(candidate)) {
      candidate.forEach((item, index) => visit(item, `${candidatePath}[${index}]`));
      return;
    }
    if (typeof candidate === "object") {
      if (seen.has(candidate)) {
        throw new TaskRunnerError(`Plugin '${pluginId}' has circular defaultConfig at ${pathLabel} (${candidatePath}).`);
      }
      seen.add(candidate);
      for (const [key, item] of Object.entries(candidate as Record<string, unknown>)) {
        visit(item, `${candidatePath}.${key}`);
      }
      seen.delete(candidate);
      return;
    }
    throw new TaskRunnerError(`Plugin '${pluginId}' has non-JSON-serializable defaultConfig at ${pathLabel} (${candidatePath}).`);
  };
  visit(value, pathLabel);
}

function parseManifest(manifestPath: string, directoryName: string): PluginManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new TaskRunnerError(`Failed to parse plugin manifest ${manifestPath}: ${(error as Error).message}`);
  }
  if (!isPlainObject(parsed)) {
    throw new TaskRunnerError(`Plugin manifest ${manifestPath} must contain a JSON object.`);
  }
  const manifest = parsed as Record<string, unknown>;
  const id = typeof manifest["id"] === "string" ? manifest["id"].trim() : "";
  const entrypoint = typeof manifest["entrypoint"] === "string" ? manifest["entrypoint"].trim() : "";
  const sdkVersion = manifest["sdk_version"];
  if (!id) {
    throw new TaskRunnerError(`Plugin manifest ${manifestPath} must define a non-empty 'id'.`);
  }
  if (!isPositiveInteger(sdkVersion)) {
    throw new TaskRunnerError(`Plugin '${id}' manifest ${manifestPath} must define a positive integer 'sdk_version'.`);
  }
  if (!entrypoint) {
    throw new TaskRunnerError(`Plugin '${id}' manifest ${manifestPath} must define a non-empty 'entrypoint'.`);
  }
  if (id !== directoryName) {
    throw new TaskRunnerError(
      `Plugin manifest id '${id}' does not match installation directory '${directoryName}' at ${manifestPath}.`,
    );
  }
  if (sdkVersion !== AGENTWEAVER_PLUGIN_SDK_VERSION) {
    throw new TaskRunnerError(
      `Plugin '${id}' manifest ${manifestPath} declares sdk_version ${sdkVersion}, but AgentWeaver supports ${AGENTWEAVER_PLUGIN_SDK_VERSION}.`,
    );
  }
  return {
    id,
    sdk_version: sdkVersion,
    entrypoint,
    ...(typeof manifest["name"] === "string" ? { name: manifest["name"] } : {}),
    ...(typeof manifest["version"] === "string" ? { version: manifest["version"] } : {}),
    ...(typeof manifest["description"] === "string" ? { description: manifest["description"] } : {}),
  };
}

function resolveEntrypoint(pluginRoot: string, manifestPath: string, manifest: PluginManifest): string {
  const entrypointPath = path.resolve(path.dirname(manifestPath), manifest.entrypoint);
  const relative = path.relative(pluginRoot, entrypointPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new TaskRunnerError(
      `Plugin '${manifest.id}' manifest ${manifestPath} resolves entrypoint outside plugin root ${pluginRoot}: ${entrypointPath}.`,
    );
  }
  const extension = path.extname(entrypointPath);
  if (extension !== ".js" && extension !== ".mjs") {
    throw new TaskRunnerError(
      `Plugin '${manifest.id}' manifest ${manifestPath} must point to an ESM .js or .mjs entrypoint, got '${manifest.entrypoint}'.`,
    );
  }
  return entrypointPath;
}

async function loadPluginModule(manifest: PluginManifest, manifestPath: string, entrypointPath: string): Promise<RawPluginModule> {
  try {
    const namespace = await import(pathToFileURL(entrypointPath).href);
    if ("default" in namespace) {
      throw new TaskRunnerError(
        `Plugin '${manifest.id}' manifest ${manifestPath} must use named exports only; default exports are not supported.`,
      );
    }
    return namespace as RawPluginModule;
  } catch (error) {
    if (error instanceof TaskRunnerError) {
      throw error;
    }
    throw new TaskRunnerError(
      `Failed to load plugin '${manifest.id}' entrypoint ${entrypointPath} from ${manifestPath}: ${(error as Error).message}`,
    );
  }
}

function validatePromptMode(value: unknown, pluginId: string, pathLabel: string): NodeContractPromptMode {
  if (value === "required" || value === "allowed" || value === "forbidden") {
    return value;
  }
  throw new TaskRunnerError(`Plugin '${pluginId}' has invalid prompt mode at ${pathLabel}.`);
}

function normalizeExecutorRegistration(
  candidate: unknown,
  index: number,
  manifest: PluginManifest,
  manifestPath: string,
  entrypointPath: string,
): NormalizedPluginExecutorRegistration {
  const pathLabel = `executors[${index}]`;
  if (!isPlainObject(candidate)) {
    throw new TaskRunnerError(`Plugin '${manifest.id}' registration ${pathLabel} must be an object.`);
  }
  const id = typeof candidate["id"] === "string" ? candidate["id"].trim() : "";
  const definition = candidate["definition"];
  if (!id) {
    throw new TaskRunnerError(`Plugin '${manifest.id}' registration ${pathLabel} must define a non-empty 'id'.`);
  }
  if (!isPlainObject(definition)) {
    throw new TaskRunnerError(`Plugin '${manifest.id}' executor '${id}' must define an object 'definition'.`);
  }
  if (definition["kind"] !== id) {
    throw new TaskRunnerError(`Plugin '${manifest.id}' executor '${id}' must match definition.kind.`);
  }
  if (!isPositiveInteger(definition["version"])) {
    throw new TaskRunnerError(`Plugin '${manifest.id}' executor '${id}' must define a positive integer definition.version.`);
  }
  if (typeof definition["execute"] !== "function") {
    throw new TaskRunnerError(`Plugin '${manifest.id}' executor '${id}' must define a function definition.execute.`);
  }
  assertJsonSerializable(definition["defaultConfig"] as JsonValue, manifest.id, `${pathLabel}.definition.defaultConfig`);
  return {
    type: "executor",
    id,
    pluginId: manifest.id,
    manifestPath,
    entrypointPath,
    definition: definition as ExecutorDefinition<JsonValue, unknown, unknown>,
  };
}

function normalizeNodeMetadata(
  metadata: Record<string, unknown>,
  id: string,
  pluginId: string,
  pathLabel: string,
): NodeContractMetadata {
  if (metadata["kind"] !== id) {
    throw new TaskRunnerError(`Plugin '${pluginId}' node '${id}' must match metadata.kind.`);
  }
  if (!isPositiveInteger(metadata["version"])) {
    throw new TaskRunnerError(`Plugin '${pluginId}' node '${id}' must define a positive integer metadata.version.`);
  }
  const normalized: NodeContractMetadata = {
    kind: id,
    version: metadata["version"],
    prompt: validatePromptMode(metadata["prompt"], pluginId, `${pathLabel}.prompt`),
  };
  if (metadata["requiredParams"] !== undefined) {
    if (!isStringArray(metadata["requiredParams"])) {
      throw new TaskRunnerError(`Plugin '${pluginId}' node '${id}' must define requiredParams as string[].`);
    }
    normalized.requiredParams = metadata["requiredParams"];
  }
  if (metadata["executors"] !== undefined) {
    if (!isStringArray(metadata["executors"])) {
      throw new TaskRunnerError(`Plugin '${pluginId}' node '${id}' must define executors as string[].`);
    }
    normalized.executors = metadata["executors"];
  }
  if (metadata["nestedFlowParam"] !== undefined) {
    if (typeof metadata["nestedFlowParam"] !== "string" || metadata["nestedFlowParam"].trim().length === 0) {
      throw new TaskRunnerError(`Plugin '${pluginId}' node '${id}' must define nestedFlowParam as a non-empty string.`);
    }
    normalized.nestedFlowParam = metadata["nestedFlowParam"];
  }
  return normalized;
}

function normalizeNodeRegistration(
  candidate: unknown,
  index: number,
  manifest: PluginManifest,
  manifestPath: string,
  entrypointPath: string,
): NormalizedPluginNodeRegistration {
  const pathLabel = `nodes[${index}]`;
  if (!isPlainObject(candidate)) {
    throw new TaskRunnerError(`Plugin '${manifest.id}' registration ${pathLabel} must be an object.`);
  }
  const id = typeof candidate["id"] === "string" ? candidate["id"].trim() : "";
  const definition = candidate["definition"];
  const metadata = candidate["metadata"];
  if (!id) {
    throw new TaskRunnerError(`Plugin '${manifest.id}' registration ${pathLabel} must define a non-empty 'id'.`);
  }
  if (!isPlainObject(definition)) {
    throw new TaskRunnerError(`Plugin '${manifest.id}' node '${id}' must define an object 'definition'.`);
  }
  if (!isPlainObject(metadata)) {
    throw new TaskRunnerError(`Plugin '${manifest.id}' node '${id}' must define an object 'metadata'.`);
  }
  if (definition["kind"] !== id) {
    throw new TaskRunnerError(`Plugin '${manifest.id}' node '${id}' must match definition.kind.`);
  }
  if (!isPositiveInteger(definition["version"])) {
    throw new TaskRunnerError(`Plugin '${manifest.id}' node '${id}' must define a positive integer definition.version.`);
  }
  if (typeof definition["run"] !== "function") {
    throw new TaskRunnerError(`Plugin '${manifest.id}' node '${id}' must define a function definition.run.`);
  }
  const normalizedMetadata = normalizeNodeMetadata(metadata, id, manifest.id, `${pathLabel}.metadata`);
  if (definition["version"] !== normalizedMetadata.version) {
    throw new TaskRunnerError(`Plugin '${manifest.id}' node '${id}' must use the same version in definition and metadata.`);
  }
  return {
    type: "node",
    id,
    pluginId: manifest.id,
    manifestPath,
    entrypointPath,
    definition: definition as PipelineNodeDefinition<Record<string, unknown>, unknown>,
    metadata: normalizedMetadata,
  };
}

function normalizePluginModule(
  manifest: PluginManifest,
  manifestPath: string,
  entrypointPath: string,
  namespace: RawPluginModule,
): LoadedPlugin {
  const executorsValue = namespace["executors"];
  const nodesValue = namespace["nodes"];
  if (executorsValue !== undefined && !Array.isArray(executorsValue)) {
    throw new TaskRunnerError(`Plugin '${manifest.id}' manifest ${manifestPath} must export 'executors' as an array.`);
  }
  if (nodesValue !== undefined && !Array.isArray(nodesValue)) {
    throw new TaskRunnerError(`Plugin '${manifest.id}' manifest ${manifestPath} must export 'nodes' as an array.`);
  }
  const executorItems = (executorsValue as unknown[] | undefined) ?? [];
  const nodeItems = (nodesValue as unknown[] | undefined) ?? [];
  if (executorsValue === undefined && nodesValue === undefined) {
    throw new TaskRunnerError(`Plugin '${manifest.id}' manifest ${manifestPath} must export named 'executors' and/or 'nodes' arrays.`);
  }
  if (executorItems.length === 0 && nodeItems.length === 0) {
    throw new TaskRunnerError(`Plugin '${manifest.id}' manifest ${manifestPath} must export at least one non-empty recognized registration array.`);
  }
  return {
    manifest,
    manifestPath,
    entrypointPath,
    executors: executorItems.map((candidate, index) =>
      normalizeExecutorRegistration(candidate, index, manifest, manifestPath, entrypointPath)),
    nodes: nodeItems.map((candidate, index) =>
      normalizeNodeRegistration(candidate, index, manifest, manifestPath, entrypointPath)),
  };
}

export async function discoverProjectPlugins(cwd: string): Promise<LoadedPlugin[]> {
  const pluginsRoot = projectPluginsDir(cwd);
  if (!existsSync(pluginsRoot)) {
    return [];
  }
  const entries = readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  const plugins: LoadedPlugin[] = [];
  for (const entry of entries) {
    const pluginRoot = path.join(pluginsRoot, entry.name);
    const manifestPath = path.join(pluginRoot, "plugin.json");
    if (!existsSync(manifestPath)) {
      throw new TaskRunnerError(`Plugin installation '${entry.name}' is missing manifest ${manifestPath}.`);
    }
    const manifest = parseManifest(manifestPath, entry.name);
    const entrypointPath = resolveEntrypoint(pluginRoot, manifestPath, manifest);
    const namespace = await loadPluginModule(manifest, manifestPath, entrypointPath);
    plugins.push(normalizePluginModule(manifest, manifestPath, entrypointPath, namespace));
  }
  return plugins;
}

function cacheKeyForPlugins(cwd: string, plugins: LoadedPlugin[]): string {
  if (plugins.length === 0) {
    return `built-in:${path.resolve(cwd)}`;
  }
  const suffix = plugins
    .map((plugin) => `${plugin.manifest.id}@${plugin.manifestPath}:${plugin.entrypointPath}`)
    .join("|");
  return `plugins:${path.resolve(cwd)}:${suffix}`;
}

function validatePluginNodeDependencies(
  plugins: LoadedPlugin[],
  executorRegistry: ExecutorRegistry,
): void {
  for (const plugin of plugins) {
    for (const node of plugin.nodes) {
      for (const executorId of node.metadata.executors ?? []) {
        if (!executorRegistry.has(executorId)) {
          throw new TaskRunnerError(
            `Plugin '${plugin.manifest.id}' node '${node.id}' requires unknown executor '${executorId}'.`,
          );
        }
      }
    }
  }
}

export async function createPipelineRegistryContext(cwd: string): Promise<PipelineRegistryContext> {
  const plugins = await discoverProjectPlugins(cwd);
  const executorRegistry = createExecutorRegistry(plugins.flatMap((plugin) => plugin.executors));
  const nodeRegistry = createNodeRegistry(plugins.flatMap((plugin) => plugin.nodes));
  validatePluginNodeDependencies(plugins, executorRegistry);
  return {
    cwd: path.resolve(cwd),
    cacheKey: cacheKeyForPlugins(cwd, plugins),
    executors: executorRegistry,
    nodes: nodeRegistry,
    plugins,
  };
}

export function createBuiltInRegistryContext(cwd: string): PipelineRegistryContext {
  return {
    cwd: path.resolve(cwd),
    cacheKey: `built-in:${path.resolve(cwd)}`,
    executors: createExecutorRegistry(),
    nodes: createNodeRegistry(),
    plugins: [],
  };
}
