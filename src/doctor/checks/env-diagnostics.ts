import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DoctorStatus } from "../types.js";
import { CATEGORY } from "./category.js";

type EnvSource = "shell" | "project-local" | "global" | "default" | "missing";

interface EnvKeyInfo {
  key: string;
  source: EnvSource;
  value: string | null;
  maskedValue: string | null;
  isSecret: boolean;
}

const MONITORED_KEYS = [
  "JIRA_API_KEY",
  "JIRA_USERNAME",
  "JIRA_AUTH_MODE",
  "JIRA_BASE_URL",
  "GITLAB_TOKEN",
  "AGENTWEAVER_HOME",
  "CODEX_BIN",
  "CODEX_MODEL",
  "OPENCODE_BIN",
  "OPENCODE_MODEL",
] as const;

const SECRET_KEYS = new Set(["JIRA_API_KEY", "GITLAB_TOKEN"]);

const JIRA_AUTH_MODE_ALLOWED_VALUES = ["auto", "basic", "bearer"];

function maskSecret(value: string): string {
  if (value.length <= 6) {
    if (value.length <= 3) {
      return "***";
    }
    const start = value.slice(0, Math.ceil(value.length / 2));
    const end = value.slice(Math.ceil(value.length / 2));
    return `${start}***${end}`;
  }
  const start = value.slice(0, 3);
  const end = value.slice(-3);
  return `${start}***${end}`;
}

function globalConfigDir(): string {
  return path.join(os.homedir(), ".agentweaver");
}

function parseEnvFileRaw(envFilePath: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!existsSync(envFilePath)) {
    return result;
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
    if (!key) {
      continue;
    }
    let value = line.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function getProjectEnvPath(): string {
  return path.join(process.cwd(), ".agentweaver", ".env");
}

function getGlobalEnvPath(): string {
  return path.join(globalConfigDir(), ".env");
}

function determineSource(
  key: string,
  shellSnapshot: Record<string, string>,
  currentValue: string | null
): EnvSource {
  if (currentValue === null) {
    return "missing";
  }

  const isInShellSnapshot = shellSnapshot.hasOwnProperty(key);

  if (isInShellSnapshot) {
    return "shell";
  }

  const globalEnv = parseEnvFileRaw(getGlobalEnvPath());
  if (globalEnv.hasOwnProperty(key)) {
    return "global";
  }

  const projectEnv = parseEnvFileRaw(getProjectEnvPath());
  if (projectEnv.hasOwnProperty(key)) {
    return "project-local";
  }

  return "shell";
}

function getDefaultValue(key: string): string | null {
  switch (key) {
    case "AGENTWEAVER_HOME":
      return path.join(os.homedir(), ".agentweaver");
    default:
      return null;
  }
}

type EnvDiagnosticsStatus = DoctorStatus;

function validateJiraAuthMode(value: string | null): boolean {
  if (value === null) {
    return true;
  }
  return JIRA_AUTH_MODE_ALLOWED_VALUES.includes(value);
}

function checkEnvDiagnostics(): { id: string; status: DoctorStatus; title: string; message: string; hint?: string; details?: string } {
  const shellSnapshot: Record<string, string> = {};
  for (const key of Object.keys(process.env)) {
    shellSnapshot[key] = process.env[key] as string;
  }

  const projectEnv = parseEnvFileRaw(getProjectEnvPath());
  const globalEnv = parseEnvFileRaw(getGlobalEnvPath());

  const keyInfos: EnvKeyInfo[] = [];
  let hasWarnings = false;

  for (const key of MONITORED_KEYS) {
    const currentValue = process.env[key] ?? null;
    const source = determineSource(key, shellSnapshot, currentValue);
    const isSecret = SECRET_KEYS.has(key);

    let maskedValue: string | null = null;
    if (currentValue !== null && isSecret) {
      maskedValue = maskSecret(currentValue);
    } else if (currentValue !== null) {
      maskedValue = currentValue;
    }

    const keyInfo: EnvKeyInfo = {
      key,
      source,
      value: currentValue,
      maskedValue,
      isSecret,
    };
    keyInfos.push(keyInfo);

    if (source === "missing") {
      hasWarnings = true;
    }

    if (key === "JIRA_AUTH_MODE" && currentValue !== null) {
      if (!validateJiraAuthMode(currentValue)) {
        hasWarnings = true;
      }
    }
  }

  const status = hasWarnings ? DoctorStatus.Warn : DoctorStatus.Ok;

  const keyCount = keyInfos.length;
  const missingCount = keyInfos.filter(k => k.source === "missing").length;
  const secretCount = keyInfos.filter(k => k.isSecret).length;

  const summaryParts: string[] = [];
  summaryParts.push(`${keyCount} keys checked`);
  if (missingCount > 0) {
    summaryParts.push(`${missingCount} missing`);
  }
  if (secretCount > 0) {
    summaryParts.push(`${secretCount} secrets`);
  }

  const result: { id: string; status: DoctorStatus; title: string; message: string; hint?: string; details?: string } = {
    id: "env-diagnostics-01",
    status,
    title: "env-config",
    message: summaryParts.join(", "),
    ...(missingCount > 0 ? { hint: `${missingCount} configuration keys are missing` } : {}),
    details: JSON.stringify(keyInfos),
  };

  return result;
}

export const envDiagnosticsCheck = {
  id: "env-diagnostics-01",
  category: CATEGORY.ENV_DIAGNOSTICS,
  title: "env-config",
  dependencies: [],
  execute: async () => {
    return checkEnvDiagnostics();
  },
};