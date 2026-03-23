import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TaskRunnerError } from "../errors.js";
import type { DeclarativeFlowSpec } from "./spec-types.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export function loadFlowSpecSync(fileName: string): DeclarativeFlowSpec {
  const filePath = path.join(MODULE_DIR, "flow-specs", fileName);
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as DeclarativeFlowSpec;
  } catch (error) {
    throw new TaskRunnerError(`Failed to load flow spec ${filePath}: ${(error as Error).message}`);
  }
}
