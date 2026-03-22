import { accessSync, constants, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

import { TaskRunnerError } from "../errors.js";

function splitArgs(input: string): string[] {
  const result: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] ?? "";
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        result.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (quote) {
    throw new TaskRunnerError("Cannot parse command: unterminated quote");
  }
  if (current) {
    result.push(current);
  }
  return result;
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function commandExists(commandName: string): boolean {
  const result = spawnSync("bash", ["-lc", `command -v ${shellQuote(commandName)}`], { stdio: "ignore" });
  return result.status === 0;
}

export function findCmdPath(commandName: string, envVarName: string): string | null {
  const configuredPath = process.env[envVarName];
  if (configuredPath && isExecutable(configuredPath)) {
    return configuredPath;
  }

  const direct = spawnSync("bash", ["-lc", `command -v ${shellQuote(commandName)}`], { encoding: "utf8" });
  if (direct.status === 0) {
    const candidate = direct.stdout.trim().split(/\r?\n/)[0] ?? "";
    if (candidate && !candidate.includes("alias") && isExecutable(candidate)) {
      return candidate;
    }
  }

  const interactive = spawnSync("bash", ["-ic", `type -a -- ${shellQuote(commandName)}`], {
    encoding: "utf8",
  });
  if (interactive.status !== 0) {
    return null;
  }

  for (const rawLine of interactive.stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (line.startsWith(`${commandName} is aliased to `)) {
      const aliasValue = line.split(" is aliased to ", 2)[1]?.replace(/^['`]|['`]$/g, "") ?? "";
      if (aliasValue && isExecutable(aliasValue)) {
        return aliasValue;
      }
      continue;
    }
    if (line.startsWith("/")) {
      const candidate = line.split(/\s+/)[0] ?? "";
      if (candidate && isExecutable(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

export function resolveCmd(commandName: string, envVarName: string): string {
  const candidate = findCmdPath(commandName, envVarName);
  if (candidate) {
    return candidate;
  }
  throw new TaskRunnerError(`Missing required command: ${commandName}`);
}

export function requireDockerCompose(): void {
  if (!commandExists("docker")) {
    throw new TaskRunnerError("Missing required command: docker");
  }
  const result = spawnSync("docker", ["compose", "version"], { stdio: "ignore" });
  if (result.status !== 0) {
    throw new TaskRunnerError("Missing required docker compose plugin");
  }
}

export function resolveDockerComposeCmd(): string[] {
  const configured = process.env.DOCKER_COMPOSE_BIN?.trim() ?? "";
  if (configured) {
    const parts = splitArgs(configured);
    if (parts.length === 0) {
      throw new TaskRunnerError("DOCKER_COMPOSE_BIN is set but empty.");
    }
    const executable = parts[0] ?? "";
    try {
      if (path.isAbsolute(executable)) {
        accessSync(executable, constants.X_OK);
        return parts;
      }
    } catch {
      throw new TaskRunnerError(`Configured docker compose command is not executable: ${configured}`);
    }
    if (commandExists(executable)) {
      return parts;
    }
    throw new TaskRunnerError(`Configured docker compose command is not executable: ${configured}`);
  }

  if (commandExists("docker-compose")) {
    return ["docker-compose"];
  }

  requireDockerCompose();
  return ["docker", "compose"];
}
