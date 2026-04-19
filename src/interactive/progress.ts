import type { FlowExecutionState } from "../pipeline/spec-types.js";
import type {
  FlowStatus,
  GroupedPhaseItem,
  InteractiveFlowDefinition,
  ProgressViewModel,
  ProgressViewModelItem,
} from "./types.js";

export function displayPhaseId(phase: InteractiveFlowDefinition["phases"][number]): string {
  let result = phase.id;
  const values = Object.entries(phase.repeatVars)
    .filter(([key]) => !key.endsWith("_minus_one"))
    .map(([, value]) => value);
  for (const value of values) {
    const suffix = `_${String(value)}`;
    if (result.endsWith(suffix)) {
      result = result.slice(0, -suffix.length);
    }
  }
  return result;
}

function repeatGroupKey(repeatVars: Record<string, string | number | boolean | null>): string {
  const entries = Object.entries(repeatVars).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(entries);
}

function repeatSeriesKey(phases: InteractiveFlowDefinition["phases"]): string {
  const repeatVarNames = Object.keys(phases[0]?.repeatVars ?? {}).sort();
  const phaseNames = phases.map((phase) => displayPhaseId(phase));
  return JSON.stringify({
    repeatVarNames,
    phaseNames,
  });
}

function repeatLabel(repeatVars: Record<string, string | number | boolean | null>): string | null {
  const entries = Object.entries(repeatVars).filter(([key]) => !key.endsWith("_minus_one"));
  if (entries.length === 0) {
    return null;
  }
  if (entries.length === 1) {
    const [key, value] = entries[0] ?? ["repeat", ""];
    return `${key} ${value}`;
  }
  return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}

export function isAfterTermination(
  flowState: FlowExecutionState,
  flow: InteractiveFlowDefinition,
  phase: InteractiveFlowDefinition["phases"][number],
): boolean {
  const terminationReason = flowState.terminationReason ?? "";
  const match = /^Stopped by ([^:]+):/.exec(terminationReason);
  if (!match) {
    return false;
  }
  const stoppedPhaseId = match[1];
  const stoppedIndex = flow.phases.findIndex((candidate) => candidate.id === stoppedPhaseId);
  const currentIndex = flow.phases.findIndex((candidate) => candidate.id === phase.id);
  if (stoppedIndex < 0 || currentIndex < 0) {
    return false;
  }
  return currentIndex > stoppedIndex;
}

export function displayStatusForPhase(
  flowState: FlowExecutionState | null,
  flow: InteractiveFlowDefinition,
  phase: InteractiveFlowDefinition["phases"][number],
  actualStatus: FlowStatus | null,
): FlowStatus {
  if (actualStatus) {
    return actualStatus;
  }
  if (!flowState?.terminated) {
    return "pending";
  }
  return isAfterTermination(flowState, flow, phase) ? "skipped" : "pending";
}

export function displayStatusForStep(
  flowState: FlowExecutionState | null,
  flow: InteractiveFlowDefinition,
  phase: InteractiveFlowDefinition["phases"][number],
  actualStatus: FlowStatus | null,
): FlowStatus {
  if (actualStatus) {
    return actualStatus;
  }
  if (!flowState?.terminated) {
    return "pending";
  }
  return isAfterTermination(flowState, flow, phase) ? "skipped" : "pending";
}

export function statusForGroup(
  flow: InteractiveFlowDefinition,
  phases: InteractiveFlowDefinition["phases"],
  flowState: FlowExecutionState | null,
): FlowStatus {
  const statuses = phases.map((phase) =>
    displayStatusForPhase(
      flowState,
      flow,
      phase,
      flowState?.phases.find((candidate) => candidate.id === phase.id)?.status ?? null,
    ),
  );
  if (statuses.some((status) => status === "running")) {
    return "running";
  }
  if (statuses.every((status) => status === "skipped")) {
    return "skipped";
  }
  if (statuses.every((status) => status === "done" || status === "skipped")) {
    return "done";
  }
  return "pending";
}

export function groupPhases(flow: InteractiveFlowDefinition): GroupedPhaseItem[] {
  const items: GroupedPhaseItem[] = [];

  let index = 0;
  while (index < flow.phases.length) {
    const phase = flow.phases[index];
    if (!phase) {
      break;
    }
    const label = repeatLabel(phase.repeatVars);
    if (!label) {
      items.push({ kind: "phase", phase });
      index += 1;
      continue;
    }

    const phases = [phase];
    let nextIndex = index + 1;
    while (nextIndex < flow.phases.length) {
      const candidate = flow.phases[nextIndex];
      if (!candidate || repeatGroupKey(candidate.repeatVars) !== repeatGroupKey(phase.repeatVars)) {
        break;
      }
      phases.push(candidate);
      nextIndex += 1;
    }
    items.push({ kind: "group", label, phases, seriesKey: repeatSeriesKey(phases) });
    index = nextIndex;
  }

  return items;
}

export function shouldDisplayPhase(
  flow: InteractiveFlowDefinition,
  flowState: FlowExecutionState | null,
  phase: InteractiveFlowDefinition["phases"][number],
): boolean {
  const phaseState = flowState?.phases.find((candidate) => candidate.id === phase.id) ?? null;
  if (!flowState) {
    return true;
  }
  if (phaseState?.status === "skipped" && flowState.terminated && isAfterTermination(flowState, flow, phase)) {
    return false;
  }
  return true;
}

export function visiblePhaseItems(
  flow: InteractiveFlowDefinition,
  flowState: FlowExecutionState | null,
): GroupedPhaseItem[] {
  const pendingSeries = new Set<string>();
  return groupPhases(flow).filter((item) => {
    if (item.kind === "phase") {
      return shouldDisplayPhase(flow, flowState, item.phase);
    }
    const visiblePhases = item.phases.filter((phase) => shouldDisplayPhase(flow, flowState, phase));
    const hasState = visiblePhases.some((phase) => flowState?.phases.some((candidate) => candidate.id === phase.id));
    if (visiblePhases.length === 0) {
      return false;
    }
    if (hasState) {
      return true;
    }
    if (pendingSeries.has(item.seriesKey)) {
      return false;
    }
    pendingSeries.add(item.seriesKey);
    return true;
  });
}

export function buildProgressViewModel(
  flow: InteractiveFlowDefinition | null,
  flowState: FlowExecutionState | null,
): ProgressViewModel {
  if (!flow) {
    return {
      flow: null,
      items: [],
      anchorIndex: null,
    };
  }

  const items: ProgressViewModelItem[] = [];
  let anchorIndex: number | null = null;
  let sawExecutedItem = false;

  const rememberAnchor = (status: FlowStatus): void => {
    if (status === "running") {
      anchorIndex = items.length;
      sawExecutedItem = true;
      return;
    }
    if (status === "done" || status === "skipped") {
      sawExecutedItem = true;
      return;
    }
    if (status === "pending" && sawExecutedItem && anchorIndex === null) {
      anchorIndex = items.length;
    }
  };

  for (const item of visiblePhaseItems(flow, flowState)) {
    if (item.kind === "group") {
      const visiblePhases = item.phases.filter((phase) => shouldDisplayPhase(flow, flowState, phase));
      if (visiblePhases.length === 0) {
        continue;
      }
      const groupStatus = statusForGroup(flow, visiblePhases, flowState);
      rememberAnchor(groupStatus);
      items.push({
        kind: "group",
        label: item.label,
        depth: 0,
        status: groupStatus,
      });

      for (const phase of visiblePhases) {
        const phaseState = flowState?.phases.find((candidate) => candidate.id === phase.id);
        const phaseStatus = displayStatusForPhase(flowState, flow, phase, phaseState?.status ?? null);
        rememberAnchor(phaseStatus);
        items.push({
          kind: "phase",
          label: displayPhaseId(phase),
          depth: 1,
          status: phaseStatus,
        });

        for (const step of phase.steps) {
          const stepState = phaseState?.steps.find((candidate) => candidate.id === step.id);
          const stepStatus = displayStatusForStep(flowState, flow, phase, stepState?.status ?? null);
          rememberAnchor(stepStatus);
          items.push({
            kind: "step",
            label: step.id,
            depth: 2,
            status: stepStatus,
          });
        }
      }
      continue;
    }

    const phase = item.phase;
    if (!shouldDisplayPhase(flow, flowState, phase)) {
      continue;
    }
    const phaseState = flowState?.phases.find((candidate) => candidate.id === phase.id);
    const phaseStatus = displayStatusForPhase(flowState, flow, phase, phaseState?.status ?? null);
    rememberAnchor(phaseStatus);
    items.push({
      kind: "phase",
      label: displayPhaseId(phase),
      depth: 0,
      status: phaseStatus,
    });

    for (const step of phase.steps) {
      const stepState = phaseState?.steps.find((candidate) => candidate.id === step.id);
      const stepStatus = displayStatusForStep(flowState, flow, phase, stepState?.status ?? null);
      rememberAnchor(stepStatus);
      items.push({
        kind: "step",
        label: step.id,
        depth: 1,
        status: stepStatus,
      });
    }
  }

  if (flowState?.terminated) {
    const terminationOutcome = flowState.terminationOutcome ?? "success";
    items.push({
      kind: "termination",
      label: terminationOutcome === "stopped" ? "Flow stopped before completion" : "Flow completed successfully",
      detail: `Reason: ${flowState.terminationReason ?? "flow terminated"}`,
      depth: 0,
      status: terminationOutcome === "stopped" ? "running" : "done",
    });
  }

  return {
    flow,
    items,
    anchorIndex,
  };
}
