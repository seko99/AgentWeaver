import { existsSync } from "node:fs";

import {
  designFile,
  designJsonFile,
  latestArtifactIteration,
  planFile,
  planJsonFile,
  qaFile,
  qaJsonFile,
} from "../artifacts.js";
import { TaskRunnerError } from "../errors.js";
import { validateStructuredArtifacts } from "../structured-artifacts.js";

type PlanningPrefix = "design" | "plan" | "qa";

export type PlanningBundlePaths = {
  designFile: string;
  designJsonFile: string;
  planFile: string;
  planJsonFile: string;
  qaFile: string;
  qaJsonFile: string;
};

export type PlanningBundleResolution = PlanningBundlePaths & {
  planningIteration: number;
};

export type PlanningBundleInspection =
  | {
      status: "missing";
      planningIteration: null;
      missingFiles: string[];
      bundle: null;
      errorMessage: string;
    }
  | {
      status: "incomplete";
      planningIteration: number;
      missingFiles: string[];
      bundle: PlanningBundlePaths;
      errorMessage: string;
    }
  | {
      status: "invalid";
      planningIteration: number;
      missingFiles: [];
      bundle: PlanningBundlePaths;
      errorMessage: string;
    }
  | {
      status: "valid";
      planningIteration: number;
      missingFiles: [];
      bundle: PlanningBundlePaths;
    };

type PlanningIterationSearchOptions = {
  requireQa: boolean;
};

function planningPrefixes(options: PlanningIterationSearchOptions): PlanningPrefix[] {
  return options.requireQa ? ["design", "plan", "qa"] : ["design", "plan"];
}

function maxPlanningIteration(taskKey: string, options: PlanningIterationSearchOptions): number | null {
  let maxIteration: number | null = null;
  for (const prefix of planningPrefixes(options)) {
    for (const extension of ["md", "json"] as const) {
      const iteration = latestArtifactIteration(taskKey, prefix, extension);
      if (iteration === null) {
        continue;
      }
      maxIteration = maxIteration === null ? iteration : Math.max(maxIteration, iteration);
    }
  }
  return maxIteration;
}

export function planningBundlePaths(taskKey: string, iteration: number): PlanningBundlePaths {
  return {
    designFile: designFile(taskKey, iteration),
    designJsonFile: designJsonFile(taskKey, iteration),
    planFile: planFile(taskKey, iteration),
    planJsonFile: planJsonFile(taskKey, iteration),
    qaFile: qaFile(taskKey, iteration),
    qaJsonFile: qaJsonFile(taskKey, iteration),
  };
}

function requiredPlanningPaths(bundle: PlanningBundlePaths, options: PlanningIterationSearchOptions): string[] {
  const required = [
    bundle.designFile,
    bundle.designJsonFile,
    bundle.planFile,
    bundle.planJsonFile,
  ];
  if (options.requireQa) {
    required.push(bundle.qaFile, bundle.qaJsonFile);
  }
  return required;
}

export function findLatestCompletedPlanningIteration(
  taskKey: string,
  options: PlanningIterationSearchOptions,
): number | null {
  const latestKnownIteration = maxPlanningIteration(taskKey, options);
  if (latestKnownIteration === null) {
    return null;
  }

  for (let iteration = latestKnownIteration; iteration >= 1; iteration -= 1) {
    const bundle = planningBundlePaths(taskKey, iteration);
    const requiredPaths = requiredPlanningPaths(bundle, options);
    if (requiredPaths.every((candidate) => existsSync(candidate))) {
      return iteration;
    }
  }

  return null;
}

export function resolveLatestCompletedPlanningIteration(
  taskKey: string,
  options: PlanningIterationSearchOptions & { missingMessage: string },
): number {
  const resolvedIteration = findLatestCompletedPlanningIteration(taskKey, options);
  if (resolvedIteration !== null) {
    return resolvedIteration;
  }

  const fallbackIteration = maxPlanningIteration(taskKey, options) ?? 1;
  const fallbackBundle = planningBundlePaths(taskKey, fallbackIteration);
  const requiredPaths = requiredPlanningPaths(fallbackBundle, options);
  const missing = requiredPaths.filter((candidate) => !existsSync(candidate));
  throw new TaskRunnerError(`${options.missingMessage}\nMissing files: ${missing.join(", ")}`);
}

export function inspectLatestPlanningBundle(taskKey: string): PlanningBundleInspection {
  const latestKnownIteration = maxPlanningIteration(taskKey, { requireQa: true });
  if (latestKnownIteration === null) {
    return {
      status: "missing",
      planningIteration: null,
      missingFiles: [],
      bundle: null,
      errorMessage: "Implement mode requires planning artifacts from the planning phase, but none were found.",
    };
  }

  const bundle = planningBundlePaths(taskKey, latestKnownIteration);
  const missingFiles = requiredPlanningPaths(bundle, { requireQa: true }).filter((candidate) => !existsSync(candidate));
  if (missingFiles.length > 0) {
    return {
      status: "incomplete",
      planningIteration: latestKnownIteration,
      missingFiles,
      bundle,
      errorMessage:
        `Implement mode requires a complete planning bundle for iteration ${latestKnownIteration}.` +
        `\nMissing files: ${missingFiles.join(", ")}`,
    };
  }

  try {
    validateStructuredArtifacts(
      [
        { path: bundle.designJsonFile, schemaId: "implementation-design/v1" },
        { path: bundle.planJsonFile, schemaId: "implementation-plan/v1" },
        { path: bundle.qaJsonFile, schemaId: "qa-plan/v1" },
      ],
      `Implement mode requires a valid structured planning bundle for iteration ${latestKnownIteration}.`,
    );
  } catch (error) {
    return {
      status: "invalid",
      planningIteration: latestKnownIteration,
      missingFiles: [],
      bundle,
      errorMessage: (error as Error).message,
    };
  }

  return {
    status: "valid",
    planningIteration: latestKnownIteration,
    missingFiles: [],
    bundle,
  };
}

export function resolveLatestPlanningBundle(taskKey: string): PlanningBundleResolution {
  const inspection = inspectLatestPlanningBundle(taskKey);
  if (inspection.status !== "valid") {
    throw new TaskRunnerError(inspection.errorMessage);
  }

  return {
    planningIteration: inspection.planningIteration,
    ...inspection.bundle,
  };
}
