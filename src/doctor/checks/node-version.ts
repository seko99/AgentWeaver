import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import semver from "semver";
import { DoctorStatus } from "../types.js";
import { CATEGORY } from "./category.js";

const PACKAGE_ROOT = process.cwd();

export const nodeVersionCheck = {
  id: "node-version-01",
  category: CATEGORY.NODE_VERSION,
  title: "node-version",
  dependencies: ["system-01"],
  execute: async () => {
    const packageJsonPath = path.join(PACKAGE_ROOT, "package.json");

    if (!existsSync(packageJsonPath)) {
      return {
        id: "node-version-01",
        status: DoctorStatus.Warn,
        title: "node-version",
        message: "package.json not found in project root",
        hint: "Cannot verify Node.js compatibility without package.json",
      };
    }

    let enginesNode: string;
    try {
      const raw = readFileSync(packageJsonPath, "utf8");
      const pkg = JSON.parse(raw) as { engines?: { node?: string } };
      if (!pkg.engines?.node) {
        return {
          id: "node-version-01",
          status: DoctorStatus.Warn,
          title: "node-version",
          message: "engines.node not specified in package.json",
          hint: "Consider adding engines.node requirement to package.json",
        };
      }
      enginesNode = pkg.engines.node;
    } catch {
      return {
        id: "node-version-01",
        status: DoctorStatus.Warn,
        title: "node-version",
        message: "Failed to read package.json",
        hint: "Ensure package.json is valid JSON",
      };
    }

    const currentVersion = process.version.slice(1);
    const validRange = semver.validRange(enginesNode);
    if (!validRange) {
      return {
        id: "node-version-01",
        status: DoctorStatus.Warn,
        title: "node-version",
        message: `Invalid semver range in engines.node: ${enginesNode}`,
        hint: "Ensure engines.node contains a valid semver range",
      };
    }
    const satisfied = semver.satisfies(currentVersion, validRange);

    if (satisfied) {
      return {
        id: "node-version-01",
        status: DoctorStatus.Ok,
        title: "node-version",
        message: `Compatible: ${currentVersion} satisfies ${enginesNode}`,
        details: `engine requirement: ${enginesNode}, current: ${currentVersion}`,
      };
    } else {
      return {
        id: "node-version-01",
        status: DoctorStatus.Warn,
        title: "node-version",
        message: `Incompatible: ${currentVersion} does not satisfy ${enginesNode}`,
        hint: "Consider using a Node.js version that matches the engines.node requirement",
        details: `engine requirement: ${enginesNode}, current: ${currentVersion}`,
      };
    }
  },
};
