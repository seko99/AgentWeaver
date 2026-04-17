import { accessSync, constants, existsSync } from "node:fs";
import { DoctorImpact, DoctorStatus } from "../types.js";
import { CATEGORY } from "./category.js";

export const cwdContextCheck = {
  id: "cwd-context-01",
  category: CATEGORY.CWD_CONTEXT,
  title: "cwd-context",
  dependencies: [] as string[],
  execute: async () => {
    const cwd = process.cwd();
    let permissionStatus: DoctorStatus;
    let permissionMessage: string;
    let permissionHint: string | undefined;

    try {
      accessSync(cwd, constants.R_OK | constants.W_OK);
      permissionStatus = DoctorStatus.Ok;
      permissionMessage = "Working directory is readable and writable";
      permissionHint = undefined;
    } catch {
      try {
        accessSync(cwd, constants.R_OK);
        permissionStatus = DoctorStatus.Warn;
        permissionMessage = "Working directory is readable but not writable";
        permissionHint = "Some operations may fail if write access is required";
      } catch {
        permissionStatus = DoctorStatus.Fail;
        permissionMessage = "Working directory is not readable";
        permissionHint = "Check directory permissions";
      }
    }

    const gitRepoExists = existsSync(".git");
    const gitStatusMessage = gitRepoExists ? "git repository detected" : "not a git repository";
    const gitStatus: DoctorStatus = gitRepoExists ? DoctorStatus.Ok : DoctorStatus.Warn;

    if (permissionStatus === DoctorStatus.Ok && gitStatus === DoctorStatus.Ok) {
      return {
        id: "cwd-context-01",
        impact: DoctorImpact.Blocking,
        status: DoctorStatus.Ok,
        title: "cwd-context",
        message: `${permissionMessage}; ${gitStatusMessage}`,
        details: `cwd: ${cwd}, git: ${gitStatusMessage}`,
      };
    }

    if (permissionStatus === DoctorStatus.Ok && gitStatus === DoctorStatus.Warn) {
      return {
        id: "cwd-context-01",
        impact: DoctorImpact.Advisory,
        status: DoctorStatus.Warn,
        title: "cwd-context",
        message: `${permissionMessage}; ${gitStatusMessage} (soft warning)`,
        hint: "Git repository is recommended but not required",
        details: `cwd: ${cwd}, git: ${gitStatusMessage}`,
      };
    }

    const result: { id: string; impact: DoctorImpact; status: DoctorStatus; title: string; message: string; hint?: string; details: string } = {
      id: "cwd-context-01",
      impact: DoctorImpact.Blocking,
      status: permissionStatus,
      title: "cwd-context",
      message: permissionMessage,
      details: `cwd: ${cwd}, git: ${gitStatusMessage}`,
    };
    if (permissionHint) {
      result.hint = permissionHint;
    }
    return result;
  },
};
