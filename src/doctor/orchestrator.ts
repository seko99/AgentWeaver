import type { DoctorCheck, DoctorReport, DoctorResult } from "./types.js";
import { DoctorImpact, DoctorStatus, ReadinessStatus } from "./types.js";
import { REGISTRY } from "./registry.js";

class DoctorOrchestrator {
  async run(checks?: DoctorCheck[], filter?: string): Promise<DoctorReport> {
    let checksToRun: DoctorCheck[];

    if (checks) {
      checksToRun = checks;
    } else if (filter) {
      const byCategory = REGISTRY.getByCategory(filter);
      if (byCategory.length > 0) {
        checksToRun = byCategory;
      } else {
        const byId = REGISTRY.getById(filter);
        if (byId) {
          checksToRun = [byId];
        } else {
          const byTitle = REGISTRY.getByTitle(filter);
          if (byTitle) {
            checksToRun = [byTitle];
          } else {
            checksToRun = [];
          }
        }
      }
    } else {
      checksToRun = REGISTRY.getDependencyOrder();
    }

    const results: DoctorResult[] = [];

    for (const check of checksToRun) {
      const result = await this.executeCheck(check);
      results.push(result);

      if (result.status === DoctorStatus.Fail && result.impact === DoctorImpact.Blocking) {
        break;
      }
    }

    const overall = this.aggregateReadiness(results);

    return {
      overall,
      checks: results,
      timestamp: new Date().toISOString(),
    };
  }

  private async executeCheck(check: DoctorCheck): Promise<DoctorResult> {
    const timeout = check.timeout ?? 30000;
    let timeoutHandle: NodeJS.Timeout | undefined;

    try {
      const timeoutPromise = new Promise<DoctorResult>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(`Check '${check.id}' timed out after ${timeout}ms`)), timeout);
        timeoutHandle.unref?.();
      });

      const result = await Promise.race([check.execute(), timeoutPromise]);
      return {
        ...result,
        impact: result.impact ?? check.impact ?? DoctorImpact.Blocking,
      };
    } catch (error) {
      return {
        id: check.id,
        impact: check.impact ?? DoctorImpact.Blocking,
        status: DoctorStatus.Fail,
        title: check.title,
        message: error instanceof Error ? error.message : "Unknown error occurred",
        hint: `Check execution failed: ${check.id}`,
      };
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private aggregateReadiness(results: DoctorResult[]): ReadinessStatus {
    const blockingResults = results.filter((result) => result.impact === DoctorImpact.Blocking);

    if (blockingResults.some((r) => r.status === DoctorStatus.Fail)) {
      return ReadinessStatus.NotReady;
    }
    if (blockingResults.some((r) => r.status === DoctorStatus.Warn)) {
      return ReadinessStatus.ReadyWithWarnings;
    }
    return ReadinessStatus.Ready;
  }
}

export { DoctorOrchestrator };
