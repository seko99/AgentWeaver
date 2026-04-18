import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { TaskRunnerError } from "../errors.js";
import type {
  ResolvedExecutionRouting,
  SelectedExecutionPreset,
  StoredExecutionRoutingEntry,
} from "../pipeline/execution-routing-config.js";
import { resolveStoredExecutionRoutingSnapshot } from "./execution-routing.js";
import { agentweaverConfigDir } from "./env-loader.js";

const EXECUTION_ROUTING_STORE_VERSION = 1;

type ExecutionRoutingStore = {
  version: number;
  namedPresets: Record<string, StoredExecutionRoutingEntry>;
  flowDefaults: Record<string, StoredExecutionRoutingEntry>;
  lastUsedByFlow: Record<string, StoredExecutionRoutingEntry>;
};

function storePath(): string {
  return path.join(agentweaverConfigDir(), "execution-routing.json");
}

function nowIso8601(): string {
  return new Date().toISOString();
}

function emptyStore(): ExecutionRoutingStore {
  return {
    version: EXECUTION_ROUTING_STORE_VERSION,
    namedPresets: {},
    flowDefaults: {},
    lastUsedByFlow: {},
  };
}

function validateSelectedPreset(value: unknown, pathLabel: string): SelectedExecutionPreset {
  if (!value || typeof value !== "object") {
    throw new TaskRunnerError(`Invalid execution routing store entry at ${pathLabel}.selectedPreset.`);
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.kind !== "string" || typeof candidate.label !== "string") {
    throw new TaskRunnerError(`Invalid execution routing store entry at ${pathLabel}.selectedPreset.`);
  }
  if (candidate.kind === "built-in" || candidate.kind === "named") {
    if (typeof candidate.presetId !== "string" || candidate.presetId.trim().length === 0) {
      throw new TaskRunnerError(`Invalid execution routing store entry at ${pathLabel}.selectedPreset.presetId.`);
    }
    return {
      kind: candidate.kind,
      presetId: candidate.presetId,
      label: candidate.label,
    } as SelectedExecutionPreset;
  }
  if (candidate.kind === "flow-default" || candidate.kind === "last-used" || candidate.kind === "custom") {
    return {
      kind: candidate.kind,
      label: candidate.label,
    } as SelectedExecutionPreset;
  }
  throw new TaskRunnerError(`Invalid execution routing store entry at ${pathLabel}.selectedPreset.kind.`);
}

function validateRoutingEntry(value: unknown, pathLabel: string): StoredExecutionRoutingEntry {
  if (!value || typeof value !== "object") {
    throw new TaskRunnerError(`Invalid execution routing store entry at ${pathLabel}.`);
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.updatedAt !== "string") {
    throw new TaskRunnerError(`Invalid execution routing store entry at ${pathLabel}.updatedAt.`);
  }
  return {
    routing: resolveStoredExecutionRoutingSnapshot(candidate.routing as ResolvedExecutionRouting),
    selectedPreset: validateSelectedPreset(candidate.selectedPreset, pathLabel),
    updatedAt: candidate.updatedAt,
  };
}

function validateEntryMap(value: unknown, pathLabel: string): Record<string, StoredExecutionRoutingEntry> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TaskRunnerError(`Invalid execution routing store section '${pathLabel}'.`);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, validateRoutingEntry(entry, `${pathLabel}.${key}`)]),
  );
}

function validateStore(raw: unknown): ExecutionRoutingStore {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TaskRunnerError("Execution routing store must be a JSON object.");
  }
  const candidate = raw as Record<string, unknown>;
  if (candidate.version !== EXECUTION_ROUTING_STORE_VERSION) {
    throw new TaskRunnerError(`Unsupported execution routing store version: ${String(candidate.version ?? "unknown")}.`);
  }
  return {
    version: EXECUTION_ROUTING_STORE_VERSION,
    namedPresets: validateEntryMap(candidate.namedPresets ?? {}, "namedPresets"),
    flowDefaults: validateEntryMap(candidate.flowDefaults ?? {}, "flowDefaults"),
    lastUsedByFlow: validateEntryMap(candidate.lastUsedByFlow ?? {}, "lastUsedByFlow"),
  };
}

export function loadExecutionRoutingStore(): ExecutionRoutingStore {
  const filePath = storePath();
  if (!existsSync(filePath)) {
    return emptyStore();
  }
  try {
    return validateStore(JSON.parse(readFileSync(filePath, "utf8")));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new TaskRunnerError(
      `Failed to load execution routing store ${filePath}: ${message}. Delete or repair the file and try again.`,
    );
  }
}

export function saveExecutionRoutingStore(store: ExecutionRoutingStore): void {
  const filePath = storePath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempFilePath = `${filePath}.tmp`;
  writeFileSync(`${tempFilePath}`, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  renameSync(tempFilePath, filePath);
}

function withUpdatedAt(entry: Omit<StoredExecutionRoutingEntry, "updatedAt">): StoredExecutionRoutingEntry {
  return {
    ...entry,
    updatedAt: nowIso8601(),
  };
}

export function saveNamedExecutionPreset(name: string, routing: ResolvedExecutionRouting, selectedPreset: SelectedExecutionPreset): void {
  const store = loadExecutionRoutingStore();
  store.namedPresets[name] = withUpdatedAt({ routing, selectedPreset });
  saveExecutionRoutingStore(store);
}

export function saveFlowDefaultExecutionRouting(flowKey: string, routing: ResolvedExecutionRouting, selectedPreset: SelectedExecutionPreset): void {
  const store = loadExecutionRoutingStore();
  store.flowDefaults[flowKey] = withUpdatedAt({ routing, selectedPreset });
  saveExecutionRoutingStore(store);
}

export function saveLastUsedExecutionRouting(flowKey: string, routing: ResolvedExecutionRouting, selectedPreset: SelectedExecutionPreset): void {
  const store = loadExecutionRoutingStore();
  store.lastUsedByFlow[flowKey] = withUpdatedAt({ routing, selectedPreset });
  saveExecutionRoutingStore(store);
}

export function getNamedExecutionPresets(): Record<string, StoredExecutionRoutingEntry> {
  return loadExecutionRoutingStore().namedPresets;
}

export function getFlowDefaultExecutionRouting(flowKey: string): StoredExecutionRoutingEntry | null {
  return loadExecutionRoutingStore().flowDefaults[flowKey] ?? null;
}

export function getLastUsedExecutionRouting(flowKey: string): StoredExecutionRoutingEntry | null {
  return loadExecutionRoutingStore().lastUsedByFlow[flowKey] ?? null;
}

export function executionRoutingStoreFile(): string {
  return storePath();
}
