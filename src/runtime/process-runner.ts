import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

import { dim, formatDone, getOutputAdapter, setCurrentExecutor } from "../tui.js";
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
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let frameIndex = 0;
  let output = "";

  const child = spawn(argv[0] ?? "", argv.slice(1), {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  setCurrentExecutor(statusLabel);

  child.stdout?.on("data", (chunk) => {
    const text = String(chunk);
    output += text;
    if (!outputAdapter.supportsTransientStatus || verbose) {
      outputAdapter.writeStdout(text);
    }
  });
  child.stderr?.on("data", (chunk) => {
    const text = String(chunk);
    output += text;
    if (!outputAdapter.supportsTransientStatus || verbose) {
      outputAdapter.writeStderr(text);
    }
  });

  if (!outputAdapter.supportsTransientStatus && outputAdapter.renderAuxiliaryOutput !== false) {
    outputAdapter.writeStdout(`Running ${statusLabel}\n`);
  }

  const timer = outputAdapter.supportsTransientStatus
    ? setInterval(() => {
        const elapsed = formatDuration(Date.now() - startedAt);
        process.stdout.write(`\r${frames[frameIndex]} ${statusLabel} ${dim(elapsed)}`);
        frameIndex = (frameIndex + 1) % frames.length;
      }, 200)
    : null;

  try {
    const exitCode = await new Promise<number>((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code) => resolve(code ?? 1));
    });

    if (timer) {
      clearInterval(timer);
      process.stdout.write(`\r${" ".repeat(80)}\r${formatDone(formatDuration(Date.now() - startedAt))}\n`);
    } else if (outputAdapter.renderAuxiliaryOutput !== false) {
      outputAdapter.writeStdout(`Done ${formatDuration(Date.now() - startedAt)}\n`);
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
    if (timer) {
      clearInterval(timer);
    }
  }
}
