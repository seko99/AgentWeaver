import blessed from "neo-blessed";

import { renderMarkdownToTerminal } from "./markdown.js";
import type { FlowExecutionState } from "./pipeline/spec-types.js";
import { setOutputAdapter, stripAnsi, type OutputAdapter } from "./tui.js";

type InteractiveFlowDefinition = {
  id: string;
  label: string;
  description: string;
  phases: Array<{
    id: string;
    repeatVars: Record<string, string | number | boolean | null>;
    steps: Array<{
      id: string;
    }>;
  }>;
};

type InteractiveUiOptions = {
  issueKey: string;
  summaryText: string;
  cwd: string;
  flows: InteractiveFlowDefinition[];
  onRun: (flowId: string) => Promise<void>;
  onExit: () => void;
};

type FocusPane = "flows" | "progress" | "summary" | "log";

type FlowStatusState = {
  flowId: string | null;
  executionState: FlowExecutionState | null;
};

export class InteractiveUi {
  private readonly screen: any;
  private readonly header: any;
  private readonly progress: any;
  private readonly flowList: any;
  private readonly description: any;
  private readonly status: any;
  private readonly summary: any;
  private readonly log: any;
  private readonly footer: any;
  private readonly help: any;
  private readonly confirm: any;
  private readonly flowMap: Map<string, InteractiveFlowDefinition>;
  private busy = false;
  private currentFlowId: string | null = null;
  private selectedFlowId: string;
  private summaryText = "";
  private focusedPane: FocusPane = "flows";
  private currentNode: string | null = null;
  private currentExecutor: string | null = null;
  private spinnerFrame = 0;
  private spinnerTimer: NodeJS.Timeout | null = null;
  private runningStartedAt: number | null = null;
  private renderScheduled = false;
  private logFlushTimer: NodeJS.Timeout | null = null;
  private readonly pendingLogLines: string[] = [];
  private flowState: FlowStatusState = {
    flowId: null,
    executionState: null,
  };
  private failedFlowId: string | null = null;

  constructor(private readonly options: InteractiveUiOptions) {
    if (options.flows.length === 0) {
      throw new Error("Interactive UI requires at least one flow.");
    }
    this.flowMap = new Map(options.flows.map((flow) => [flow.id, flow]));
    this.selectedFlowId = options.flows[0]?.id ?? "auto";

    this.screen = blessed.screen({
      smartCSR: true,
      fullUnicode: true,
      title: `AgentWeaver ${options.issueKey}`,
      dockBorders: true,
      autoPadding: false,
    });

    this.header = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: "100%",
      height: 3,
      tags: true,
      padding: {
        left: 1,
        right: 1,
      },
      border: "line",
      style: {
        border: { fg: "green" },
        fg: "white",
      },
    });

    this.progress = blessed.box({
      parent: this.screen,
      top: 3,
      left: 0,
      width: "34%",
      height: "50%-1",
      tags: true,
      label: " Current Flow ",
      padding: {
        left: 1,
        right: 1,
      },
      border: "line",
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      style: {
        border: { fg: "green" },
        fg: "white",
      },
    });

    this.flowList = blessed.list({
      parent: this.screen,
      top: "50%+2",
      left: 0,
      width: "34%",
      bottom: 11,
      keys: true,
      vi: true,
      mouse: true,
      tags: true,
      label: " Flows ",
      padding: {
        left: 1,
        right: 1,
      },
      border: "line",
      scrollable: true,
      alwaysScroll: true,
      style: {
        border: { fg: "cyan" },
        fg: "white",
        selected: {
          fg: "black",
          bg: "green",
          bold: true,
        },
      },
    });

    this.confirm = blessed.box({
      parent: this.screen,
      top: "center",
      left: "center",
      width: 44,
      height: 8,
      hidden: true,
      tags: true,
      label: " Confirm ",
      padding: {
        left: 1,
        right: 1,
        top: 1,
        bottom: 1,
      },
      border: "line",
      keys: true,
      vi: true,
      style: {
        border: { fg: "yellow" },
        bg: undefined,
        fg: "white",
      },
      align: "center",
      valign: "middle",
    });

    this.description = blessed.box({
      parent: this.screen,
      bottom: 6,
      left: 0,
      width: "34%",
      height: 5,
      tags: true,
      label: " Flow Description ",
      padding: {
        left: 1,
        right: 1,
      },
      border: "line",
      scrollable: true,
      alwaysScroll: true,
      style: {
        border: { fg: "magenta" },
        fg: "white",
      },
    });

    this.status = blessed.box({
      parent: this.screen,
      bottom: 1,
      left: 0,
      width: "34%",
      height: 5,
      tags: true,
      label: " Status ",
      padding: {
        left: 1,
        right: 1,
      },
      border: "line",
      style: {
        border: { fg: "green" },
        fg: "white",
      },
    });

    this.summary = blessed.box({
      parent: this.screen,
      top: 3,
      left: "34%",
      width: "66%",
      height: 16,
      tags: true,
      label: " Task Summary ",
      padding: {
        left: 1,
        right: 1,
      },
      border: "line",
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      style: {
        border: { fg: "green" },
        fg: "white",
      },
    });

    this.log = blessed.log({
      parent: this.screen,
      top: 19,
      bottom: 1,
      left: "34%",
      width: "66%",
      tags: false,
      label: " Activity ",
      padding: {
        left: 1,
        right: 1,
      },
      border: "line",
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
      scrollbar: {
        ch: " ",
        inverse: true,
      },
      style: {
        border: { fg: "yellow" },
        fg: "white",
      },
    });

    this.footer = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: "100%",
      height: 1,
      tags: true,
      style: { fg: "gray" },
    });

    this.help = blessed.box({
      parent: this.screen,
      top: "center",
      left: "center",
      width: "64%",
      height: "52%",
      hidden: true,
      tags: true,
      label: " Help ",
      padding: {
        left: 1,
        right: 1,
      },
      border: "line",
      scrollable: true,
      keys: true,
      vi: true,
      mouse: true,
      style: {
        border: { fg: "magenta" },
        bg: "black",
        fg: "white",
      },
    });

    this.bindKeys();
    this.renderStaticContent();
  }

  private bindKeys(): void {
    this.screen.key(["C-c", "q"], () => {
      this.options.onExit();
    });

    this.screen.key(["f1", "h", "?"], () => {
      if (this.confirm.visible) {
        return;
      }
      this.help.hidden = !this.help.hidden;
      if (!this.help.hidden) {
        this.help.focus();
      } else {
        this.focusPane("flows");
      }
      this.requestRender();
    });

    this.screen.key(["escape"], () => {
      if (!this.help.hidden) {
        this.help.hide();
        this.focusPane("flows");
        this.requestRender();
        return;
      }
      if (this.confirm.visible) {
        this.closeConfirm();
      }
    });

    this.screen.key(["C-l"], () => {
      this.log.setContent("");
      this.appendLog("Log cleared.");
    });

    this.screen.key(["tab"], () => {
      if (this.confirm.visible || !this.help.hidden) {
        return;
      }
      this.cycleFocus(1);
    });

    this.screen.key(["S-tab"], () => {
      if (this.confirm.visible || !this.help.hidden) {
        return;
      }
      this.cycleFocus(-1);
    });

    this.flowList.on("select item", (_item: unknown, index: number) => {
      const flow = this.options.flows[index];
      if (!flow) {
        return;
      }
      this.selectedFlowId = flow.id;
      this.renderDescription();
      this.renderProgress();
      this.requestRender();
    });

    this.flowList.key(["enter"], () => {
      if (this.busy || this.confirm.visible || !this.help.hidden) {
        return;
      }
      this.openConfirm();
    });

    this.flowList.key(["pageup"], () => {
      this.flowList.scroll(-(this.flowList.height - 2));
      this.requestRender();
    });

    this.flowList.key(["pagedown"], () => {
      this.flowList.scroll(this.flowList.height - 2);
      this.requestRender();
    });

    this.log.key(["up"], () => {
      this.log.scroll(-1);
      this.requestRender();
    });

    this.log.key(["down"], () => {
      this.log.scroll(1);
      this.requestRender();
    });

    this.log.key(["pageup"], () => {
      this.log.scroll(-(this.log.height - 2));
      this.requestRender();
    });

    this.log.key(["pagedown"], () => {
      this.log.scroll(this.log.height - 2);
      this.requestRender();
    });

    this.log.key(["home"], () => {
      this.log.setScroll(0);
      this.requestRender();
    });

    this.log.key(["end"], () => {
      this.log.setScrollPerc(100);
      this.requestRender();
    });

    this.summary.key(["pageup"], () => {
      this.summary.scroll(-(this.summary.height - 2));
      this.requestRender();
    });

    this.summary.key(["pagedown"], () => {
      this.summary.scroll(this.summary.height - 2);
      this.requestRender();
    });

    this.progress.key(["pageup"], () => {
      this.progress.scroll(-(this.progress.height - 2));
      this.requestRender();
    });

    this.progress.key(["pagedown"], () => {
      this.progress.scroll(this.progress.height - 2);
      this.requestRender();
    });

    this.confirm.key(["enter"], async () => {
      if (this.busy || this.confirm.hidden) {
        return;
      }
      const flowId = this.selectedFlowId;
      this.closeConfirm();
      this.setBusy(true, flowId);
      this.clearFlowFailure(flowId);
      this.setFlowDisplayState(flowId, null);
      try {
        await this.options.onRun(flowId);
      } finally {
        this.setBusy(false);
        this.focusPane("flows");
      }
    });

    this.confirm.key(["escape"], () => {
      this.closeConfirm();
    });
  }

  private cycleFocus(direction: 1 | -1): void {
    const panes: FocusPane[] = ["flows", "progress", "summary", "log"];
    const currentIndex = panes.indexOf(this.focusedPane);
    const nextIndex = (currentIndex + direction + panes.length) % panes.length;
    this.focusPane(panes[nextIndex] ?? "flows");
  }

  private focusPane(pane: FocusPane): void {
    this.focusedPane = pane;
    this.flowList.style.border.fg = pane === "flows" ? "brightCyan" : "cyan";
    this.progress.style.border.fg = pane === "progress" ? "brightGreen" : "green";
    this.summary.style.border.fg = pane === "summary" ? "brightGreen" : "green";
    this.log.style.border.fg = pane === "log" ? "brightYellow" : "yellow";
    this.flowList.setLabel(pane === "flows" ? " ▶ Flows " : " Flows ");
    this.progress.setLabel(pane === "progress" ? " ▶ Current Flow " : " Current Flow ");
    this.summary.setLabel(pane === "summary" ? " ▶ Task Summary " : " Task Summary ");
    this.log.setLabel(pane === "log" ? " ▶ Activity " : " Activity ");

    if (pane === "flows") {
      if (this.confirm.visible) {
        this.confirm.focus();
      } else {
        this.flowList.focus();
      }
    } else if (pane === "progress") {
      this.progress.focus();
    } else if (pane === "summary") {
      this.summary.focus();
    } else {
      this.log.focus();
    }

    this.footer.setContent(
      ` Focus: ${pane} | Up/Down: select flow | Enter: confirm run | h: help | Esc: close | Tab: switch pane | q: exit `,
    );
    this.requestRender();
  }

  private renderStaticContent(): void {
    this.summaryText = this.options.summaryText.trim();
    this.updateHeader();
    this.flowList.setItems(this.options.flows.map((flow) => flow.label));
    this.flowList.select(this.options.flows.findIndex((flow) => flow.id === this.selectedFlowId));
    this.renderDescription();
    this.renderSummary();
    this.renderProgress();

    this.help.setContent(
      renderMarkdownToTerminal(
        [
          "AgentWeaver interactive mode",
          "",
          "Клавиши:",
          "Up / Down    выбрать flow",
          "Enter        открыть подтверждение запуска",
          "Enter        подтвердить запуск в модалке",
          "Esc          закрыть help или модалку",
          "h / F1       открыть или закрыть help",
          "Tab          переключить pane",
          "Ctrl+L       очистить лог",
          "q / Ctrl+C   выйти",
          "",
          "Доступные flow:",
          ...this.options.flows.map((flow) => flow.label),
        ].join("\n"),
      ),
    );

    this.footer.setContent(" Up/Down: select flow | Enter: confirm run | h: help | Tab: switch pane | q: exit ");
  }

  private updateHeader(): void {
    const current = this.currentFlowId ?? this.selectedFlowId;
    this.header.setContent(
      `{bold}AgentWeaver{/bold}  {green-fg}${this.options.issueKey}{/green-fg}\n` +
        `cwd: ${this.options.cwd}   current: ${current}${this.busy ? " {yellow-fg}[running]{/yellow-fg}" : ""}`,
    );
  }

  private renderSummary(): void {
    const summaryBody = this.summaryText || "Task summary is not available yet.";
    this.summary.setContent(renderMarkdownToTerminal(stripAnsi(summaryBody)));
  }

  private renderDescription(): void {
    const flow = this.flowMap.get(this.selectedFlowId);
    const description = flow?.description?.trim() || "Описание для этого flow пока не задано.";
    this.description.setContent(renderMarkdownToTerminal(stripAnsi(description)));
  }

  private createAdapter(): OutputAdapter {
    return {
      writeStdout: (text) => {
        this.appendLog(stripAnsi(text).replace(/\r/g, ""));
      },
      writeStderr: (text) => {
        this.appendLog(stripAnsi(text).replace(/\r/g, ""));
      },
      supportsTransientStatus: false,
      supportsPassthrough: false,
      renderAuxiliaryOutput: true,
      renderPanelsAsPlainText: true,
      setExecutionState: (state) => {
        this.currentNode = state.node;
        this.currentExecutor = state.executor;
        this.updateRunningPanel();
      },
      setFlowState: (state) => {
        this.setFlowDisplayState(state.flowId, state.executionState);
      },
    };
  }

  private activeFlowId(): string {
    return this.currentFlowId ?? this.selectedFlowId;
  }

  private progressFlowDefinition(): InteractiveFlowDefinition | undefined {
    const preferredFlowId = this.busy ? this.activeFlowId() : this.selectedFlowId;
    return this.flowMap.get(preferredFlowId);
  }

  private renderProgress(): void {
    const flow = this.progressFlowDefinition();
    if (!flow) {
      this.progress.setContent("Flow structure is not available.");
      return;
    }

    const flowState =
      this.flowState.flowId === flow.id
        ? this.flowState.executionState
        : this.currentFlowId === flow.id
          ? this.flowState.executionState
          : null;

    const lines: string[] = [flow.label, ""];
    for (const item of this.visiblePhaseItems(flow, flowState)) {
      if (item.kind === "group") {
        const visiblePhases = item.phases.filter((phase) => this.shouldDisplayPhase(flow, flowState, phase));
        if (visiblePhases.length === 0) {
          continue;
        }
        lines.push(`${this.symbolForGroup(flow.id, flow, visiblePhases, flowState)} ${item.label}`);
        for (const phase of visiblePhases) {
          const phaseState = flowState?.phases.find((candidate) => candidate.id === phase.id);
          const phaseStatus = this.displayStatusForPhase(flowState, flow, phase, phaseState?.status ?? null);
          lines.push(`  ${this.symbolForStatus(flow.id, phaseStatus)} ${this.displayPhaseId(phase)}`);
          for (const step of phase.steps) {
            const stepState = phaseState?.steps.find((candidate) => candidate.id === step.id);
            const stepStatus = this.displayStatusForStep(flowState, flow, phase, stepState?.status ?? null);
            lines.push(`    ${this.symbolForStatus(flow.id, stepStatus)} ${step.id}`);
          }
        }
        lines.push("");
        continue;
      }
      const phase = item.phase;
      if (!this.shouldDisplayPhase(flow, flowState, phase)) {
        continue;
      }
      const phaseState = flowState?.phases.find((candidate) => candidate.id === phase.id);
      const phaseStatus = this.displayStatusForPhase(flowState, flow, phase, phaseState?.status ?? null);
      lines.push(`${this.symbolForStatus(flow.id, phaseStatus)} ${this.displayPhaseId(phase)}`);
      for (const step of phase.steps) {
        const stepState = phaseState?.steps.find((candidate) => candidate.id === step.id);
        const stepStatus = this.displayStatusForStep(flowState, flow, phase, stepState?.status ?? null);
        lines.push(`  ${this.symbolForStatus(flow.id, stepStatus)} ${step.id}`);
      }
      lines.push("");
    }
    if (flowState?.terminated) {
      lines.push(`✓ Flow completed successfully`);
      lines.push(`Reason: ${flowState.terminationReason ?? "flow terminated"}`);
    }
    this.progress.setContent(lines.join("\n").trimEnd());
  }

  private displayStatusForPhase(
    flowState: FlowExecutionState | null,
    flow: InteractiveFlowDefinition,
    phase: InteractiveFlowDefinition["phases"][number],
    actualStatus: "pending" | "running" | "done" | "skipped" | null,
  ): "pending" | "running" | "done" | "skipped" {
    if (actualStatus) {
      return actualStatus;
    }
    if (!flowState?.terminated) {
      return "pending";
    }
    return this.isAfterTermination(flowState, flow, phase) ? "skipped" : "pending";
  }

  private displayStatusForStep(
    flowState: FlowExecutionState | null,
    flow: InteractiveFlowDefinition,
    phase: InteractiveFlowDefinition["phases"][number],
    actualStatus: "pending" | "running" | "done" | "skipped" | null,
  ): "pending" | "running" | "done" | "skipped" {
    if (actualStatus) {
      return actualStatus;
    }
    if (!flowState?.terminated) {
      return "pending";
    }
    return this.isAfterTermination(flowState, flow, phase) ? "skipped" : "pending";
  }

  private symbolForStatus(
    flowId: string,
    status: "pending" | "running" | "done" | "skipped",
  ): string {
    if (status === "done") {
      return "✓";
    }
    if (status === "skipped") {
      return "·";
    }
    if (status === "running") {
      const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
      return this.failedFlowId === flowId && !this.busy ? "×" : (frames[this.spinnerFrame] ?? "▶");
    }
    return "○";
  }

  private symbolForGroup(
    flowId: string,
    flow: InteractiveFlowDefinition,
    phases: InteractiveFlowDefinition["phases"],
    flowState: FlowExecutionState | null,
  ): string {
    const statuses = phases.map((phase) =>
      this.displayStatusForPhase(
        flowState,
        flow,
        phase,
        flowState?.phases.find((candidate) => candidate.id === phase.id)?.status ?? null,
      ),
    );
    if (statuses.some((status) => status === "running")) {
      return this.symbolForStatus(flowId, "running");
    }
    if (statuses.every((status) => status === "skipped")) {
      return "·";
    }
    if (statuses.every((status) => status === "done" || status === "skipped")) {
      return "✓";
    }
    return "○";
  }

  private groupPhases(flow: InteractiveFlowDefinition): Array<
    | { kind: "phase"; phase: InteractiveFlowDefinition["phases"][number] }
    | { kind: "group"; label: string; phases: InteractiveFlowDefinition["phases"]; seriesKey: string }
  > {
    const items: Array<
      | { kind: "phase"; phase: InteractiveFlowDefinition["phases"][number] }
      | { kind: "group"; label: string; phases: InteractiveFlowDefinition["phases"]; seriesKey: string }
    > = [];

    let index = 0;
    while (index < flow.phases.length) {
      const phase = flow.phases[index];
      if (!phase) {
        break;
      }
      const repeatLabel = this.repeatLabel(phase.repeatVars);
      if (!repeatLabel) {
        items.push({ kind: "phase", phase });
        index += 1;
        continue;
      }

      const phases = [phase];
      let nextIndex = index + 1;
      while (nextIndex < flow.phases.length) {
        const candidate = flow.phases[nextIndex];
        if (!candidate || this.repeatGroupKey(candidate.repeatVars) !== this.repeatGroupKey(phase.repeatVars)) {
          break;
        }
        phases.push(candidate);
        nextIndex += 1;
      }
      items.push({ kind: "group", label: repeatLabel, phases, seriesKey: this.repeatSeriesKey(phases) });
      index = nextIndex;
    }

    return items;
  }

  private visiblePhaseItems(
    flow: InteractiveFlowDefinition,
    flowState: FlowExecutionState | null,
  ): Array<
    | { kind: "phase"; phase: InteractiveFlowDefinition["phases"][number] }
    | { kind: "group"; label: string; phases: InteractiveFlowDefinition["phases"]; seriesKey: string }
  > {
    const pendingSeries = new Set<string>();
    return this.groupPhases(flow).filter((item) => {
      if (item.kind === "phase") {
        return this.shouldDisplayPhase(flow, flowState, item.phase);
      }
      const visiblePhases = item.phases.filter((phase) => this.shouldDisplayPhase(flow, flowState, phase));
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

  private repeatGroupKey(repeatVars: Record<string, string | number | boolean | null>): string {
    const entries = Object.entries(repeatVars).sort(([left], [right]) => left.localeCompare(right));
    return JSON.stringify(entries);
  }

  private shouldDisplayPhase(
    flow: InteractiveFlowDefinition,
    flowState: FlowExecutionState | null,
    phase: InteractiveFlowDefinition["phases"][number],
  ): boolean {
    const phaseState = flowState?.phases.find((candidate) => candidate.id === phase.id) ?? null;
    if (!flowState) {
      if (Object.keys(phase.repeatVars).length > 0) {
        return false;
      }
      return !this.hasPreviousRepeatPhase(flow, phase);
    }
    if (Object.keys(phase.repeatVars).length === 0) {
      if (!phaseState) {
        return false;
      }
      if (phaseState?.status === "skipped" && flowState.terminated && this.isAfterTermination(flowState, flow, phase)) {
        return false;
      }
      return true;
    }
    if (!phaseState) {
      return false;
    }
    if (phaseState.status === "skipped" && flowState.terminated && this.isAfterTermination(flowState, flow, phase)) {
      return false;
    }
    return true;
  }

  private hasPreviousRepeatPhase(
    flow: InteractiveFlowDefinition,
    phase: InteractiveFlowDefinition["phases"][number],
  ): boolean {
    for (const candidate of flow.phases) {
      if (candidate.id === phase.id) {
        return false;
      }
      if (Object.keys(candidate.repeatVars).length > 0) {
        return true;
      }
    }
    return false;
  }

  private repeatSeriesKey(phases: InteractiveFlowDefinition["phases"]): string {
    const repeatVarNames = Object.keys(phases[0]?.repeatVars ?? {}).sort();
    const phaseNames = phases.map((phase) => this.displayPhaseId(phase));
    return JSON.stringify({
      repeatVarNames,
      phaseNames,
    });
  }

  private repeatLabel(repeatVars: Record<string, string | number | boolean | null>): string | null {
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

  private displayPhaseId(phase: InteractiveFlowDefinition["phases"][number]): string {
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

  private isAfterTermination(
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

  private openConfirm(): void {
    const flow = this.flowMap.get(this.selectedFlowId);
    if (!flow) {
      return;
    }
    this.confirm.setContent(`Run flow "${flow.label}"?\n\nEnter: yes    Esc: no`);
    this.confirm.show();
    this.confirm.setFront();
    this.confirm.focus();
    this.requestRender();
  }

  private closeConfirm(): void {
    this.confirm.hide();
    this.focusPane("flows");
    this.requestRender();
  }

  mount(): void {
    setOutputAdapter(this.createAdapter());
    this.focusPane("flows");
  }

  destroy(): void {
    this.flushPendingLogLines();
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
    }
    if (this.logFlushTimer) {
      clearTimeout(this.logFlushTimer);
      this.logFlushTimer = null;
    }
    setOutputAdapter(null);
    this.screen.destroy();
  }

  setBusy(busy: boolean, flowId?: string): void {
    this.busy = busy;
    this.currentFlowId = flowId ?? (busy ? this.currentFlowId : this.currentFlowId);
    if (busy && this.runningStartedAt === null) {
      this.runningStartedAt = Date.now();
    } else if (!busy && this.currentNode === null && this.currentExecutor === null) {
      this.runningStartedAt = null;
    }
    if (!busy && flowId === undefined) {
      this.currentFlowId = this.currentFlowId ?? this.selectedFlowId;
    }
    this.updateHeader();
    this.updateRunningPanel();
    this.renderProgress();
    this.requestRender();
  }

  setFlowFailed(flowId: string): void {
    this.failedFlowId = flowId;
    this.renderProgress();
    this.requestRender();
  }

  clearFlowFailure(flowId: string): void {
    if (this.failedFlowId === flowId) {
      this.failedFlowId = null;
    }
  }

  setStatus(status: string): void {
    this.currentFlowId = status;
    this.updateHeader();
    this.requestRender();
  }

  setSummary(markdown: string): void {
    this.summaryText = markdown.trim();
    this.renderSummary();
    this.requestRender();
  }

  appendLog(text: string): void {
    const normalized = text
      .split("\n")
      .map((line) => line.replace(/\t/g, "  "))
      .join("\n")
      .trimEnd();

    if (!normalized) {
      this.pendingLogLines.push("");
    } else {
      this.pendingLogLines.push(...normalized.split("\n"));
    }
    this.scheduleLogFlush();
  }

  private setFlowDisplayState(flowId: string | null, executionState: FlowExecutionState | null): void {
    this.flowState = {
      flowId,
      executionState,
    };
    if (flowId) {
      this.currentFlowId = flowId;
    }
    this.renderProgress();
    this.requestRender();
  }

  private updateRunningPanel(): void {
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    const running = this.busy || this.currentNode !== null || this.currentExecutor !== null;
    if (running && this.spinnerTimer === null) {
      if (this.runningStartedAt === null) {
        this.runningStartedAt = Date.now();
      }
      this.spinnerTimer = setInterval(() => {
        this.spinnerFrame = (this.spinnerFrame + 1) % frames.length;
        this.updateRunningPanel();
        this.renderProgress();
        this.requestRender();
      }, 120);
    } else if (!running && this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
      this.spinnerFrame = 0;
      this.runningStartedAt = null;
    }

    const spinner = running ? `{green-fg}${frames[this.spinnerFrame] ?? "•"}{/green-fg}` : "•";
    const elapsed = this.formatElapsed(running ? Date.now() : null);
    const nodeLine = `Node: ${this.currentNode ?? "-"}`;
    const executorLine = `Executor: ${this.currentExecutor ?? "-"}`;
    const stateLine = `State: ${running ? `${spinner} running` : "idle"}`;
    const elapsedLine = `Time: ${elapsed}`;
    this.status.setContent([stateLine, elapsedLine, nodeLine, executorLine].join("\n"));
    this.requestRender();
  }

  private formatElapsed(now: number | null): string {
    if (this.runningStartedAt === null || now === null) {
      return "00:00:00";
    }
    const totalSeconds = Math.max(0, Math.floor((now - this.runningStartedAt) / 1000));
    const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const minutes = String((totalSeconds % 3600) / 60 | 0).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
  }

  private scheduleLogFlush(): void {
    if (this.logFlushTimer) {
      return;
    }
    this.logFlushTimer = setTimeout(() => {
      this.logFlushTimer = null;
      this.flushPendingLogLines();
    }, 50);
  }

  private flushPendingLogLines(): void {
    if (this.pendingLogLines.length === 0) {
      return;
    }
    const lines = this.pendingLogLines.splice(0, this.pendingLogLines.length);
    for (const line of lines) {
      this.log.add(line);
    }
    this.log.setScrollPerc(100);
    this.requestRender();
  }

  private requestRender(): void {
    if (this.renderScheduled) {
      return;
    }
    this.renderScheduled = true;
    setImmediate(() => {
      this.renderScheduled = false;
      this.screen.render();
    });
  }
}

export type { InteractiveFlowDefinition };
