import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

import { getExecutionState, getOutputAdapter, printFramedBlock, printInfo, setCurrentExecutor } from "../tui.js";
import { shellQuote } from "./command-resolution.js";

export function formatCommand(argv: string[], env?: NodeJS.ProcessEnv): string {
  const envParts = Object.entries(env ?? {})
    .filter(([key, value]) => value !== undefined && process.env[key] !== value)
    .map(([key, value]) => `${key}=${shellQuote(value ?? "")}`);
  const command = argv.map(shellQuote).join(" ");
  return envParts.length > 0 ? `${envParts.join(" ")} ${command}` : command;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatLaunchDetails(statusLabel: string): string {
  const state = getExecutionState();
  const lines: string[] = [];
  if (state.node) {
    lines.push(`Node: ${state.node}`);
  }

  const executorLabel = state.executor ?? statusLabel;
  const separatorIndex = executorLabel.indexOf(":");
  if (separatorIndex >= 0) {
    lines.push(`Executor: ${executorLabel.slice(0, separatorIndex)}`);
    lines.push(`Model: ${executorLabel.slice(separatorIndex + 1)}`);
  } else {
    lines.push(`Executor: ${executorLabel}`);
  }

  return lines.join("\n");
}

export async function runCommand(
  argv: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    dryRun?: boolean;
    verbose?: boolean;
    label?: string;
    printFailureOutput?: boolean;
  } = {},
): Promise<string> {
  const { env, dryRun = false, verbose = false, label, printFailureOutput = true } = options;
  const outputAdapter = getOutputAdapter();

  if (dryRun) {
    setCurrentExecutor(label ?? path.basename(argv[0] ?? argv.join(" ")));
    outputAdapter.writeStdout(`${formatCommand(argv, env)}\n`);
    setCurrentExecutor(null);
    return "";
  }

  if (verbose && outputAdapter.supportsPassthrough) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(argv[0] ?? "", argv.slice(1), {
        stdio: "inherit",
        env,
      });
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(String(code ?? 1)))));
      child.on("error", reject);
    }).catch((error) => {
      const code = Number.parseInt((error as Error).message, 10);
      throw Object.assign(new Error(`Command failed with exit code ${Number.isNaN(code) ? 1 : code}`), {
        returnCode: Number.isNaN(code) ? 1 : code,
        output: "",
      });
    });
    return "";
  }

  const startedAt = Date.now();
  const statusLabel = label ?? path.basename(argv[0] ?? argv.join(" "));
  let output = "";

  const child = spawn(argv[0] ?? "", argv.slice(1), {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  setCurrentExecutor(statusLabel);

  child.stdout?.on("data", (chunk) => {
    const text = String(chunk);
    output += text;
    if (verbose) {
      outputAdapter.writeStdout(text);
    }
  });
  child.stderr?.on("data", (chunk) => {
    const text = String(chunk);
    output += text;
    if (verbose) {
      outputAdapter.writeStderr(text);
    }
  });

  if (outputAdapter.renderAuxiliaryOutput !== false) {
    printFramedBlock("Запуск", formatLaunchDetails(statusLabel), "cyan");
  }

  try {
    const exitCode = await new Promise<number>((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code) => resolve(code ?? 1));
    });

    if (outputAdapter.renderAuxiliaryOutput !== false) {
      printInfo(`Закончили работу: ${statusLabel} (${formatDuration(Date.now() - startedAt)})`);
    }

    if (exitCode !== 0) {
      if (output && printFailureOutput && outputAdapter.supportsTransientStatus) {
        process.stderr.write(output);
        if (!output.endsWith("\n")) {
          process.stderr.write("\n");
        }
      }
      throw Object.assign(new Error(`Command failed with exit code ${exitCode}`), {
        returnCode: exitCode,
        output,
      });
    }

    return output;
  } finally {
    setCurrentExecutor(null);
  }
}
