import { existsSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function parseEnvFile(envFilePath: string, protectedKeys: ReadonlySet<string>): void {
  if (!existsSync(envFilePath)) {
    return;
  }

  const lines = readFileSync(envFilePath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    if (line.startsWith("export ")) {
      line = line.slice(7).trim();
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    if (!key || protectedKeys.has(key)) {
      continue;
    }
    let value = line.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function globalConfigDir(): string {
  return path.join(os.homedir(), ".agentweaver");
}

function ensureGlobalConfigDir(): void {
  mkdirSync(globalConfigDir(), { recursive: true });
}

export function loadTieredEnv(projectDir: string): void {
  ensureGlobalConfigDir();
  const shellEnvKeys = new Set(Object.keys(process.env));
  parseEnvFile(path.join(globalConfigDir(), ".env"), shellEnvKeys);
  parseEnvFile(path.join(projectDir, ".agentweaver", ".env"), shellEnvKeys);
}
