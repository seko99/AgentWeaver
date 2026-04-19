import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { readyToMergeFile } from "../artifacts.js";

export function clearReadyToMergeFile(taskKey: string): boolean {
  const filePath = readyToMergeFile(taskKey);
  if (!existsSync(filePath)) {
    return false;
  }
  rmSync(filePath);
  return true;
}

export function writeReadyToMergeFile(taskKey: string, options: {
  mdLang?: "en" | "ru" | null;
  summary?: string | null;
} = {}): string {
  const filePath = readyToMergeFile(taskKey);
  mkdirSync(path.dirname(filePath), { recursive: true });
  const summary = options.summary?.trim();
  const lines = options.mdLang === "ru"
    ? [
        "# Готово к слиянию",
        "",
        "Блокирующих замечаний не найдено по текущему порогу severity.",
        ...(summary ? ["", "## Summary", "", summary] : []),
      ]
    : [
        "# Ready to Merge",
        "",
        "No blocking findings were detected at the configured severity threshold.",
        ...(summary ? ["", "## Summary", "", summary] : []),
      ];
  writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
  return filePath;
}
