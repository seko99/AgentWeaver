import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { TaskRunnerError } from "../../errors.js";
import { printInfo } from "../../tui.js";
import type { PipelineNodeDefinition } from "../types.js";

export type GitStatusFileEntry = {
  xy: string;
  indexStatus: string;
  workTreeStatus: string;
  file: string;
  originalFile?: string;
  staged: boolean;
  type: string;
};

export type GitStatusNodeParams = {
  outputFile: string;
  diffOutputFile?: string;
  labelText?: string;
};

export type GitStatusNodeResult = {
  files: GitStatusFileEntry[];
  diff: string;
  diffStat: string;
};

function unquoteGitPath(s: string): string {
  if (s.length < 2 || s[0] !== '"' || s[s.length - 1] !== '"') {
    return s;
  }
  const inner = s.slice(1, -1);
  const decoder = new TextDecoder();
  let result = "";
  const byteBuf: number[] = [];
  const flushBytes = () => {
    if (byteBuf.length > 0) {
      result += decoder.decode(new Uint8Array(byteBuf));
      byteBuf.length = 0;
    }
  };
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "\\" && i + 1 < inner.length) {
      const next = inner[i + 1]!;
      switch (next) {
        case "\\":
          flushBytes();
          result += "\\";
          i++;
          break;
        case '"':
          flushBytes();
          result += '"';
          i++;
          break;
        case "a":
          flushBytes();
          result += "\x07";
          i++;
          break;
        case "b":
          flushBytes();
          result += "\b";
          i++;
          break;
        case "f":
          flushBytes();
          result += "\f";
          i++;
          break;
        case "n":
          flushBytes();
          result += "\n";
          i++;
          break;
        case "r":
          flushBytes();
          result += "\r";
          i++;
          break;
        case "t":
          flushBytes();
          result += "\t";
          i++;
          break;
        case "v":
          flushBytes();
          result += "\v";
          i++;
          break;
        default: {
          if (next >= "0" && next <= "7") {
            let octal = next;
            let consumed = 0;
            for (let j = 1; j <= 2 && i + 1 + j < inner.length; j++) {
              const ch = inner[i + 1 + j];
              if (ch !== undefined && ch >= "0" && ch <= "7") {
                octal += ch;
                consumed = j;
              } else {
                break;
              }
            }
            byteBuf.push(parseInt(octal!, 8) & 0xff);
            i += 1 + consumed;
          } else {
            flushBytes();
            result += inner[i];
          }
          break;
        }
      }
    } else {
      flushBytes();
      result += inner[i];
    }
  }
  flushBytes();
  return result;
}

function splitRename(raw: string): { original: string; file: string } | null {
  let inQuote = false;
  for (let i = 0; i <= raw.length - 4; i++) {
    if (raw[i] === "\\" && inQuote) {
      i++;
      continue;
    }
    if (raw[i] === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && raw.slice(i, i + 4) === " -> ") {
      return { original: raw.slice(0, i), file: raw.slice(i + 4) };
    }
  }
  return null;
}

export function parsePorcelain(output: string): GitStatusFileEntry[] {
  const lines = output.split(/\r?\n/);
  const files: GitStatusFileEntry[] = [];

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    const xy = line.slice(0, 2);
    const rawFile = line.slice(3);

    const indexStatus = xy[0] ?? " ";
    const workTreeStatus = xy[1] ?? " ";

    const staged = indexStatus !== " " && indexStatus !== "?";

    let type: string;
    if (indexStatus === "A" || workTreeStatus === "A") {
      type = "added";
    } else if (indexStatus === "D" || workTreeStatus === "D") {
      type = "deleted";
    } else if (indexStatus === "R") {
      type = "renamed";
    } else if (indexStatus === "?" && workTreeStatus === "?") {
      type = "untracked";
    } else {
      type = "modified";
    }

    let file: string;
    let originalFile: string | undefined;
    if (indexStatus === "R" || indexStatus === "C") {
      const parts = splitRename(rawFile);
      if (parts) {
        originalFile = unquoteGitPath(parts.original);
        file = unquoteGitPath(parts.file);
      } else {
        file = unquoteGitPath(rawFile);
      }
    } else {
      file = unquoteGitPath(rawFile);
    }

    files.push({
      xy,
      indexStatus,
      workTreeStatus,
      file,
      ...(originalFile !== undefined ? { originalFile } : {}),
      staged,
      type,
    });
  }

  return files;
}

function persistGitStatus(filePath: string, result: GitStatusNodeResult): void {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

export const gitStatusNode: PipelineNodeDefinition<GitStatusNodeParams, GitStatusNodeResult> = {
  kind: "git-status",
  version: 1,
  async run(context, params) {
    printInfo(params.labelText ?? "Collecting git status");

    const porcelainOutput = await context.runtime.runCommand(
      ["git", "status", "--porcelain"],
      {
        dryRun: context.dryRun,
        verbose: context.verbose,
        label: "git status",
      },
    );

    const files = parsePorcelain(porcelainOutput);

    if (files.length === 0) {
      throw new TaskRunnerError("No changed files to commit.");
    }

    const diff = await context.runtime.runCommand(
      ["git", "diff"],
      {
        dryRun: context.dryRun,
        verbose: context.verbose,
        label: "git diff",
      },
    );

    const stagedDiff = await context.runtime.runCommand(
      ["git", "diff", "--cached"],
      {
        dryRun: context.dryRun,
        verbose: context.verbose,
        label: "git diff --cached",
      },
    );

    const fullDiff = stagedDiff + diff;

    const diffStat = await context.runtime.runCommand(
      ["git", "diff", "--stat"],
      {
        dryRun: context.dryRun,
        verbose: context.verbose,
        label: "git diff --stat",
      },
    );

    const result: GitStatusNodeResult = {
      files,
      diff: fullDiff,
      diffStat,
    };

    writeFileSync(params.outputFile, `${JSON.stringify(result, null, 2)}\n`, "utf8");

    if (params.diffOutputFile) {
      writeFileSync(params.diffOutputFile, fullDiff, "utf8");
    }

    return {
      value: result,
    };
  },
};
