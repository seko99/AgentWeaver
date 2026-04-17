import { existsSync, rmSync } from "node:fs";

import { readyToMergeFile } from "../artifacts.js";

export function clearReadyToMergeFile(taskKey: string): boolean {
  const filePath = readyToMergeFile(taskKey);
  if (!existsSync(filePath)) {
    return false;
  }
  rmSync(filePath);
  return true;
}
