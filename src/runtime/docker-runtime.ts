import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function agentweaverHome(packageRoot: string): string {
  const configured = process.env.AGENTWEAVER_HOME?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return packageRoot;
}

export function defaultDockerComposeFile(packageRoot: string): string {
  return path.join(agentweaverHome(packageRoot), "docker-compose.yml");
}

function defaultCodexHomeDir(packageRoot: string): string {
  return path.join(agentweaverHome(packageRoot), ".codex-home");
}

function ensureRuntimeBindPath(targetPath: string, isDir: boolean): string {
  mkdirSync(path.dirname(targetPath), { recursive: true });
  if (isDir) {
    mkdirSync(targetPath, { recursive: true });
  } else if (!existsSync(targetPath)) {
    writeFileSync(targetPath, "", "utf8");
  }
  return targetPath;
}

function defaultHostSshDir(packageRoot: string): string {
  const candidate = path.join(os.homedir(), ".ssh");
  if (existsSync(candidate)) {
    return candidate;
  }
  return ensureRuntimeBindPath(path.join(agentweaverHome(packageRoot), ".runtime", "ssh"), true);
}

function defaultHostGitconfig(packageRoot: string): string {
  const candidate = path.join(os.homedir(), ".gitconfig");
  if (existsSync(candidate)) {
    return candidate;
  }
  return ensureRuntimeBindPath(path.join(agentweaverHome(packageRoot), ".runtime", "gitconfig"), false);
}

export function dockerRuntimeEnv(packageRoot: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  env.AGENTWEAVER_HOME ??= agentweaverHome(packageRoot);
  env.PROJECT_DIR ??= process.cwd();
  env.CODEX_HOME_DIR ??= ensureRuntimeBindPath(defaultCodexHomeDir(packageRoot), true);
  env.HOST_SSH_DIR ??= defaultHostSshDir(packageRoot);
  env.HOST_GITCONFIG ??= defaultHostGitconfig(packageRoot);
  env.LOCAL_UID ??= typeof process.getuid === "function" ? String(process.getuid()) : "1000";
  env.LOCAL_GID ??= typeof process.getgid === "function" ? String(process.getgid()) : "1000";
  return env;
}
