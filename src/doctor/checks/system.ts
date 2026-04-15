import { spawnSync } from "node:child_process";
import { DoctorStatus } from "../types.js";
import { CATEGORY } from "./category.js";
import { resolveCmd } from "../../runtime/command-resolution.js";

interface BinaryCheckSpec {
  id: string;
  title: string;
  command: string;
  versionArgs: string[];
  versionEnvVar: string;
  parseVersion: (stdout: string) => string;
}

const BINARY_CHECKS: BinaryCheckSpec[] = [
  {
    id: "system-01",
    title: "node",
    command: "node",
    versionArgs: ["--version"],
    versionEnvVar: "",
    parseVersion: (stdout: string) => stdout.trim(),
  },
  {
    id: "system-02",
    title: "npm",
    command: "npm",
    versionArgs: ["--version"],
    versionEnvVar: "",
    parseVersion: (stdout: string) => stdout.trim(),
  },
  {
    id: "system-03",
    title: "git",
    command: "git",
    versionArgs: ["--version"],
    versionEnvVar: "",
    parseVersion: (stdout: string) => stdout.trim(),
  },
  {
    id: "system-04",
    title: "bash",
    command: "bash",
    versionArgs: ["--version"],
    versionEnvVar: "",
    parseVersion: (stdout: string) => (stdout.split("\n")[0] ?? stdout).trim(),
  },
];

function runVersionCheck(spec: BinaryCheckSpec): { status: DoctorStatus; message: string; hint?: string; details?: string } {
  let cmdPath: string;
  try {
    cmdPath = resolveCmd(spec.command, "");
  } catch {
    return {
      status: DoctorStatus.Fail,
      message: `${spec.title} binary not found`,
      hint: `Install ${spec.title} or ensure it is available in PATH`,
    };
  }

  const result = spawnSync(cmdPath, spec.versionArgs, { encoding: "utf8", stdio: "pipe" });

  if (result.status !== 0 || !result.stdout) {
    return {
      status: DoctorStatus.Fail,
      message: `Failed to get ${spec.title} version`,
      hint: `${spec.title} --version did not return expected output`,
    };
  }

  const stdout = result.stdout as string;
  const version = spec.parseVersion(stdout);
  const okResult: { status: DoctorStatus; message: string; details?: string } = {
    status: DoctorStatus.Ok,
    message: version,
  };
  if (spec.title === "node") {
    okResult.details = `process.version: ${process.version}`;
  }
  return okResult;
}

export const systemChecks = BINARY_CHECKS.map((spec) => ({
  id: spec.id,
  category: CATEGORY.SYSTEM,
  title: spec.title,
  dependencies: [] as string[],
  execute: async () => {
    const result = runVersionCheck(spec);
    const checkResult: { id: string; status: DoctorStatus; title: string; message: string; hint?: string; details?: string } = {
      id: spec.id,
      status: result.status,
      title: spec.title,
      message: result.message,
    };
    if (result.hint) {
      checkResult.hint = result.hint;
    }
    if (result.details) {
      checkResult.details = result.details;
    }
    return checkResult;
  },
}));
