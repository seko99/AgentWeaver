import { DoctorStatus, ReadinessStatus } from "./types.js";
import { REGISTRY } from "./registry.js";
import { DoctorOrchestrator } from "./orchestrator.js";
import { CATEGORY } from "./checks/category.js";

import "./checks/register.js";

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

const CATEGORY_LABELS: Record<string, string> = {
  [CATEGORY.SYSTEM]: "System",
  [CATEGORY.EXECUTORS]: "Executors",
  [CATEGORY.ENV_DIAGNOSTICS]: "Environment",
  [CATEGORY.FLOW_READINESS]: "Flow Readiness",
};

async function runDoctorCommand(args: string[]): Promise<number> {
  const jsonMode = args.includes("--json");
  const filter = args.find((arg) => arg !== "--json");
  const orchestrator = new DoctorOrchestrator();

  const report = await orchestrator.run(undefined, filter);

  if (jsonMode) {
    process.stdout.write(JSON.stringify(report, null, 2));
    return report.overall === ReadinessStatus.NotReady ? 1 : 0;
  }

  const grouped = new Map<string, typeof report.checks>();
  for (const result of report.checks) {
    const check = REGISTRY.getById(result.id);
    const cat = check?.category ?? "unknown";
    if (!grouped.has(cat)) {
      grouped.set(cat, []);
    }
    grouped.get(cat)!.push(result);
  }

  const categoryOrder = [
    CATEGORY.SYSTEM,
    CATEGORY.EXECUTORS,
    CATEGORY.ENV_DIAGNOSTICS,
    CATEGORY.FLOW_READINESS,
  ];

  for (const cat of categoryOrder) {
    const items = grouped.get(cat);
    if (!items || items.length === 0) continue;

    const label = CATEGORY_LABELS[cat] ?? cat;
    console.log(`## ${label}`);
    console.log();

    for (const result of items) {
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
  }

  for (const [cat, items] of grouped) {
    if (categoryOrder.includes(cat as typeof categoryOrder[number])) continue;
    const label = CATEGORY_LABELS[cat] ?? cat;
    console.log(`## ${label}`);
    console.log();
    for (const result of items) {
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
  }

  console.log(`Overall: ${READINESS_LABELS[report.overall]}`);
  console.log(`Timestamp: ${report.timestamp}`);

  return report.overall === ReadinessStatus.NotReady ? 1 : 0;
}

export { runDoctorCommand };