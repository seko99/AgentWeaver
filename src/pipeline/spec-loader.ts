import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TaskRunnerError } from "../errors.js";
import type { DeclarativeFlowSpec } from "./spec-types.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const BUILT_IN_FLOW_SPECS_DIR = path.join(MODULE_DIR, "flow-specs");

export type FlowSpecSource =
  | { source: "built-in"; fileName: string }
  | { source: "project-local"; filePath: string };

function parseFlowSpec(filePath: string): DeclarativeFlowSpec {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as DeclarativeFlowSpec;
  } catch (error) {
    throw new TaskRunnerError(`Failed to load flow spec ${filePath}: ${(error as Error).message}`);
  }
}

export function resolveBuiltInFlowSpecPath(fileName: string): string {
  return path.join(BUILT_IN_FLOW_SPECS_DIR, fileName);
}

export function projectFlowSpecsDir(cwd: string): string {
  return path.join(cwd, ".agentweaver", ".flows");
}

export function listBuiltInFlowSpecFiles(): string[] {
  if (!existsSync(BUILT_IN_FLOW_SPECS_DIR)) {
    return [];
  }
  return readdirSync(BUILT_IN_FLOW_SPECS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

export function listProjectFlowSpecFiles(cwd: string): string[] {
  const directory = projectFlowSpecsDir(cwd);
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(directory, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

export function loadFlowSpecSync(source: FlowSpecSource): DeclarativeFlowSpec {
  return parseFlowSpec(source.source === "built-in" ? resolveBuiltInFlowSpecPath(source.fileName) : source.filePath);
}

export function loadBuiltInFlowSpecSync(fileName: string): DeclarativeFlowSpec {
  return loadFlowSpecSync({ source: "built-in", fileName });
}

export function loadProjectFlowSpecSync(filePath: string): DeclarativeFlowSpec {
  return loadFlowSpecSync({ source: "project-local", filePath });
}
