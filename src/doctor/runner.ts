import { DoctorStatus, ReadinessStatus } from "./types.js";
import { REGISTRY } from "./registry.js";
import { DoctorOrchestrator } from "./orchestrator.js";

const STATUS_ICONS: Record<DoctorStatus, string> = {
  [DoctorStatus.Ok]: "✓",
  [DoctorStatus.Warn]: "⚠",
  [DoctorStatus.Fail]: "✗",
};

const READINESS_LABELS: Record<ReadinessStatus, string> = {
  [ReadinessStatus.Ready]: "Ready",
  [ReadinessStatus.ReadyWithWarnings]: "Ready with warnings",
  [ReadinessStatus.NotReady]: "Not ready",
};

async function runDoctorCommand(args: string[]): Promise<number> {
  const filter = args[0];
  const orchestrator = new DoctorOrchestrator();

  const report = await orchestrator.run(undefined, filter);

  for (const result of report.checks) {
    const icon = STATUS_ICONS[result.status];
    const line = `[${icon}] ${result.title} - ${result.message}`;
    console.log(line);
    if (result.hint) {
      console.log(`  Hint: ${result.hint}`);
    }
    if (result.details) {
      console.log(`  Details: ${result.details}`);
    }
  }

  console.log();
  console.log(`Overall: ${READINESS_LABELS[report.overall]}`);
  console.log(`Timestamp: ${report.timestamp}`);

  return report.overall === ReadinessStatus.NotReady ? 1 : 0;
}

export { runDoctorCommand };