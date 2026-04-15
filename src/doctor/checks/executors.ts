import { spawnSync } from "node:child_process";
import { DoctorStatus } from "../types.js";
import { CATEGORY } from "./category.js";
import { ALLOWED_MODELS_BY_EXECUTOR, LlmExecutorId } from "../../pipeline/launch-profile-config.js";
import { findCmdPath, isExecutable } from "../../runtime/command-resolution.js";

interface ExecutorDetails {
  path: string | null;
  source: "env-override" | "PATH" | "not-found";
  executable: boolean;
  versionOutput: string | null;
}

interface ExecutorCheckResult {
  id: string;
  status: DoctorStatus;
  title: string;
  message: string;
  hint?: string;
  details?: string;
  detailsObj?: ExecutorDetails;
}

function getEnvVarName(executorId: LlmExecutorId): string {
  return executorId === "codex" ? "CODEX_BIN" : "OPENCODE_BIN";
}

function getCommandName(executorId: LlmExecutorId): string {
  return executorId === "codex" ? "codex" : "opencode";
}

function resolveBinaryPath(executorId: LlmExecutorId): { path: string | null; source: "env-override" | "PATH" | "not-found" } {
  const envVarName = getEnvVarName(executorId);
  const commandName = getCommandName(executorId);
  const configuredPath = process.env[envVarName];

  if (configuredPath) {
    if (isExecutable(configuredPath)) {
      return { path: configuredPath, source: "env-override" };
    }
    return { path: null, source: "not-found" };
  }

  const foundPath = findCmdPath(commandName, "");
  if (foundPath) {
    return { path: foundPath, source: "PATH" };
  }

  return { path: null, source: "not-found" };
}

function runSmokeCheck(executorPath: string): string | null {
  const result = spawnSync(executorPath, ["--version"], { encoding: "utf8", stdio: "pipe" });
  if (result.status === 0 && result.stdout) {
    return result.stdout.trim();
  }
  return null;
}

function buildDetailsObj(executorId: LlmExecutorId, resolution: { path: string | null; source: "env-override" | "PATH" | "not-found" }, versionOutput: string | null): ExecutorDetails {
  return {
    path: resolution.path,
    source: resolution.source,
    executable: resolution.path !== null && isExecutable(resolution.path),
    versionOutput,
  };
}

function createResult(executorId: LlmExecutorId, status: DoctorStatus, message: string, hint: string | undefined, details: string | undefined, resolution: { path: string | null; source: "env-override" | "PATH" | "not-found" }, versionOutput: string | null): ExecutorCheckResult {
  const result: ExecutorCheckResult = {
    id: `${executorId}-executor-01`,
    status,
    title: executorId,
    message,
  };
  if (hint) {
    result.hint = hint;
  }
  if (details) {
    result.details = details;
  }
  result.detailsObj = buildDetailsObj(executorId, resolution, versionOutput);
  return result;
}

function checkExecutor(executorId: LlmExecutorId): ExecutorCheckResult {
  const resolution = resolveBinaryPath(executorId);

  if (resolution.path === null) {
    const hint = executorId === "codex"
      ? "Set CODEX_BIN environment variable to point to the codex binary"
      : "Set OPENCODE_BIN environment variable to point to the opencode binary";
    return createResult(executorId, DoctorStatus.Fail, `${executorId} binary not found`, hint, `source: ${resolution.source}`, resolution, null);
  }

  if (!isExecutable(resolution.path)) {
    const hint = `Binary at ${resolution.path} is not executable`;
    return createResult(executorId, DoctorStatus.Fail, `${executorId} binary is not executable`, hint, `path: ${resolution.path}`, resolution, null);
  }

  const versionOutput = runSmokeCheck(resolution.path);
  if (versionOutput === null) {
    return createResult(executorId, DoctorStatus.Fail, `${executorId} --version check failed`, `${executorId} --version did not produce expected output`, `path: ${resolution.path}, source: ${resolution.source}`, resolution, null);
  }

  const allowedModels = ALLOWED_MODELS_BY_EXECUTOR[executorId];
  const modelWarnings: string[] = [];

  for (const model of allowedModels) {
    const modelResult = spawnSync(resolution.path, ["--model", model, "--version"], { encoding: "utf8", stdio: "pipe" });
    if (modelResult.status !== 0) {
      modelWarnings.push(`Model '${model}' validation failed (exit code ${modelResult.status})`);
    }
  }

  const message = versionOutput;
  if (modelWarnings.length > 0) {
    return createResult(executorId, DoctorStatus.Warn, message, `Some models failed validation: ${modelWarnings.join("; ")}`, `source: ${resolution.source}, models validated: ${allowedModels.join(", ")}`, resolution, versionOutput);
  }

  return createResult(executorId, DoctorStatus.Ok, message, undefined, `source: ${resolution.source}`, resolution, versionOutput);
}

export const codexExecutorCheck = {
  id: "codex-executor-01",
  category: CATEGORY.EXECUTORS,
  title: "codex",
  dependencies: [],
  execute: async () => {
    return checkExecutor("codex");
  },
};

export const opencodeExecutorCheck = {
  id: "opencode-executor-01",
  category: CATEGORY.EXECUTORS,
  title: "opencode",
  dependencies: [],
  execute: async () => {
    return checkExecutor("opencode");
  },
};