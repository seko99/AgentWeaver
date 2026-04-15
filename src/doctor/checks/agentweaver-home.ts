import { accessSync, constants, existsSync } from "node:fs";
import path from "node:path";
import { DoctorStatus } from "../types.js";
import { CATEGORY } from "./category.js";
import { agentweaverHome } from "../../runtime/agentweaver-home.js";

const PACKAGE_ROOT = process.cwd();

export const agentweaverHomeCheck = {
  id: "agentweaver-home-01",
  category: CATEGORY.AGENTWEAVER_HOME,
  title: "agentweaver-home",
  dependencies: [] as string[],
  execute: async () => {
    const homePath = agentweaverHome(PACKAGE_ROOT);

    if (!existsSync(homePath)) {
      return {
        id: "agentweaver-home-01",
        status: DoctorStatus.Fail,
        title: "agentweaver-home",
        message: `Directory does not exist: ${homePath}`,
        hint: "Create the ~/.agentweaver directory or set AGENTWEAVER_HOME environment variable",
        details: `resolved path: ${homePath}`,
      };
    }

    try {
      accessSync(homePath, constants.R_OK | constants.W_OK);
      return {
        id: "agentweaver-home-01",
        status: DoctorStatus.Ok,
        title: "agentweaver-home",
        message: `Directory accessible and writable: ${homePath}`,
        details: `resolved path: ${homePath}`,
      };
    } catch {
      try {
        accessSync(homePath, constants.R_OK);
        return {
          id: "agentweaver-home-01",
          status: DoctorStatus.Warn,
          title: "agentweaver-home",
          message: `Directory exists but is not writable: ${homePath}`,
          hint: "Check directory permissions; AgentWeaver needs write access to this directory",
          details: `resolved path: ${homePath}`,
        };
      } catch {
        return {
          id: "agentweaver-home-01",
          status: DoctorStatus.Fail,
          title: "agentweaver-home",
          message: `Directory exists but is not readable: ${homePath}`,
          hint: "Check directory permissions",
          details: `resolved path: ${homePath}`,
        };
      }
    }
  },
};
