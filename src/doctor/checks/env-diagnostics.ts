import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DoctorImpact, DoctorStatus } from "../types.js";
import { CATEGORY } from "./category.js";
import { detectJiraDeployment } from "../../jira.js";

type EnvSource = "shell" | "project-local" | "global" | "default" | "missing";
type EnvState = "configured" | "defaulted" | "unset" | "invalid";

interface EnvKeyInfo {
  key: string;
  source: EnvSource;
  state: EnvState;
  isSecret: boolean;
  note?: string;
}

interface EnvDiagnosticsData {
  kind: "env-config";
  summary: {
    checked: number;
    configured: number;
    defaulted: number;
    unset: number;
    invalid: number;
    secrets: number;
  };
  warnings: string[];
  keys: EnvKeyInfo[];
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

const KEY_NOTES: Partial<Record<(typeof MONITORED_KEYS)[number], string>> = {
  JIRA_API_KEY: "Required for Jira-backed flows.",
  JIRA_USERNAME: "Required only for Jira Cloud basic auth.",
  GITLAB_TOKEN: "Required for GitLab-backed flows.",
  AGENTWEAVER_HOME: "Optional override for the AgentWeaver package home.",
  CODEX_BIN: "Optional override for the codex executable path.",
  CODEX_MODEL: "Optional fallback model override for Codex-backed executors.",
  OPENCODE_BIN: "Optional override for the opencode executable path.",
  OPENCODE_MODEL: "Optional fallback model override for OpenCode-backed executors.",
};

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
  projectEnv: Record<string, string>,
  globalEnv: Record<string, string>,
  currentValue: string | null,
): EnvSource {
  if (currentValue === null) {
    return "missing";
  }

  if (Object.prototype.hasOwnProperty.call(shellSnapshot, key)) {
    return "shell";
  }

  if (Object.prototype.hasOwnProperty.call(projectEnv, key)) {
    return "project-local";
  }

  if (Object.prototype.hasOwnProperty.call(globalEnv, key)) {
    return "global";
  }

  return "shell";
}

function defaultNote(key: string): string | null {
  if (key === "JIRA_AUTH_MODE") {
    return "Defaults to auto.";
  }
  return null;
}

function validateJiraAuthMode(value: string | null): boolean {
  if (value === null) {
    return true;
  }
  return JIRA_AUTH_MODE_ALLOWED_VALUES.includes(value.trim().toLowerCase());
}

function keyNote(key: (typeof MONITORED_KEYS)[number]): string | undefined {
  return KEY_NOTES[key];
}

function formatKeyLine(info: EnvKeyInfo): string {
  const source = info.state === "unset" ? "unset" : info.source === "default" ? "default" : info.source;
  const secretLabel = info.isSecret ? ", secret" : "";
  const noteLabel = info.note ? `, ${info.note}` : "";
  return `- ${info.key} (${source}${secretLabel}${noteLabel})`;
}

function buildDetails(
  configured: EnvKeyInfo[],
  defaulted: EnvKeyInfo[],
  unset: EnvKeyInfo[],
  invalid: EnvKeyInfo[],
  warnings: string[],
): string {
  const lines: string[] = [];

  if (warnings.length > 0) {
    lines.push("warnings:");
    for (const warning of warnings) {
      lines.push(`- ${warning}`);
    }
  }

  if (configured.length > 0) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push("configured:");
    for (const info of configured) {
      lines.push(formatKeyLine(info));
    }
  }

  if (defaulted.length > 0) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push("defaulted:");
    for (const info of defaulted) {
      lines.push(formatKeyLine(info));
    }
  }

  if (unset.length > 0) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push("unset:");
    for (const info of unset) {
      lines.push(formatKeyLine(info));
    }
  }

  if (invalid.length > 0) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push("invalid:");
    for (const info of invalid) {
      lines.push(formatKeyLine(info));
    }
  }

  return lines.join("\n");
}

function checkEnvDiagnostics() {
  const shellSnapshot: Record<string, string> = {};
  for (const key of Object.keys(process.env)) {
    const value = process.env[key];
    if (value !== undefined) {
      shellSnapshot[key] = value;
    }
  }

  const projectEnv = parseEnvFileRaw(getProjectEnvPath());
  const globalEnv = parseEnvFileRaw(getGlobalEnvPath());

  const keyInfos: EnvKeyInfo[] = [];
  const warnings: string[] = [];

  const jiraApiKey = process.env.JIRA_API_KEY?.trim() || null;
  const jiraUsername = process.env.JIRA_USERNAME?.trim() || null;
  const jiraAuthModeRaw = process.env.JIRA_AUTH_MODE?.trim() || null;
  const jiraBaseUrl = process.env.JIRA_BASE_URL?.trim() || null;

  for (const key of MONITORED_KEYS) {
    const currentValue = process.env[key]?.trim() || null;
    const isSecret = SECRET_KEYS.has(key);
    const source = determineSource(key, shellSnapshot, projectEnv, globalEnv, currentValue);
    const defaultHint = currentValue === null ? defaultNote(key) : null;

    let state: EnvState = "configured";
    if (currentValue === null && defaultHint) {
      state = "defaulted";
    } else if (currentValue === null) {
      state = "unset";
    }

    if (key === "JIRA_AUTH_MODE" && currentValue !== null && !validateJiraAuthMode(currentValue)) {
      state = "invalid";
    }

    const note = state === "defaulted" ? defaultHint ?? undefined : keyNote(key);
    keyInfos.push({
      key,
      source: state === "defaulted" ? "default" : source,
      state,
      isSecret,
      ...(note ? { note } : {}),
    });
  }

  const jiraHasAnyConfig = !!(jiraApiKey || jiraBaseUrl || jiraUsername || jiraAuthModeRaw);
  const jiraHasCorePair = !!(jiraApiKey && jiraBaseUrl);

  if ((jiraApiKey && !jiraBaseUrl) || (!jiraApiKey && jiraBaseUrl)) {
    warnings.push("Jira configuration is partial: set both JIRA_API_KEY and JIRA_BASE_URL for Jira-backed flows.");
  }

  if (jiraAuthModeRaw !== null && !validateJiraAuthMode(jiraAuthModeRaw)) {
    warnings.push("JIRA_AUTH_MODE must be one of: auto, basic, bearer.");
  }

  if (jiraHasCorePair && jiraBaseUrl) {
    const authMode = jiraAuthModeRaw?.toLowerCase() || "auto";
    const isCloud = detectJiraDeployment(jiraBaseUrl) === "cloud";
    const usesBasicAuth = authMode === "basic" || (authMode === "auto" && isCloud);
    if (usesBasicAuth && !jiraUsername) {
      warnings.push("JIRA_USERNAME is required for Jira Cloud basic auth with the current Jira URL and auth mode.");
    }
  } else if (jiraHasAnyConfig && jiraUsername && !jiraApiKey && !jiraBaseUrl) {
    warnings.push("JIRA_USERNAME is set without the Jira API key/base URL pair.");
  }

  const configured = keyInfos.filter((info) => info.state === "configured");
  const defaulted = keyInfos.filter((info) => info.state === "defaulted");
  const unset = keyInfos.filter((info) => info.state === "unset");
  const invalid = keyInfos.filter((info) => info.state === "invalid");

  const status = warnings.length > 0 ? DoctorStatus.Warn : DoctorStatus.Ok;
  const summary = {
    checked: keyInfos.length,
    configured: configured.length,
    defaulted: defaulted.length,
    unset: unset.length,
    invalid: invalid.length,
    secrets: keyInfos.filter((info) => info.isSecret).length,
  };

  const messageParts = [
    `${summary.checked} keys checked`,
    `${summary.configured} configured`,
  ];
  if (summary.defaulted > 0) {
    messageParts.push(`${summary.defaulted} defaulted`);
  }
  if (summary.unset > 0) {
    messageParts.push(`${summary.unset} unset`);
  }
  if (summary.invalid > 0) {
    messageParts.push(`${summary.invalid} invalid`);
  }

  const details = buildDetails(configured, defaulted, unset, invalid, warnings);
  const data: EnvDiagnosticsData = {
    kind: "env-config",
    summary,
    warnings,
    keys: keyInfos,
  };

  return {
    id: "env-diagnostics-01",
    impact: DoctorImpact.Advisory,
    status,
    title: "env-config",
    message: messageParts.join(", "),
    ...(warnings.length > 0
      ? { hint: `${warnings.length} configuration issue${warnings.length === 1 ? "" : "s"} detected` }
      : unset.length > 0
        ? { hint: "Unset keys are optional unless you use the related integrations or overrides" }
        : {}),
    details,
    data,
  };
}

export const envDiagnosticsCheck = {
  id: "env-diagnostics-01",
  category: CATEGORY.ENV_DIAGNOSTICS,
  title: "env-config",
  impact: DoctorImpact.Advisory,
  dependencies: [],
  execute: async () => {
    return checkEnvDiagnostics();
  },
};
