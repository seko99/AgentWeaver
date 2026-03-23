import blessed from "neo-blessed";

import { renderMarkdownToTerminal } from "./markdown.js";
import type { FlowExecutionState } from "./pipeline/spec-types.js";
import { setOutputAdapter, stripAnsi, type OutputAdapter } from "./tui.js";

type InteractiveFlowDefinition = {
  id: string;
  label: string;
  phases: Array<{
    id: string;
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
      bottom: 10,
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

    this.status = blessed.box({
      parent: this.screen,
      bottom: 4,
      left: 0,
      width: "34%",
      height: 6,
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
      height: 12,
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
      top: 15,
      bottom: 4,
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
      this.screen.render();
    });

    this.screen.key(["escape"], () => {
      if (!this.help.hidden) {
        this.help.hide();
        this.focusPane("flows");
        this.screen.render();
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
      this.renderProgress();
      this.screen.render();
    });

    this.flowList.key(["enter"], () => {
      if (this.busy || this.confirm.visible || !this.help.hidden) {
        return;
      }
      this.openConfirm();
    });

    this.flowList.key(["pageup"], () => {
      this.flowList.scroll(-(this.flowList.height - 2));
      this.screen.render();
    });

    this.flowList.key(["pagedown"], () => {
      this.flowList.scroll(this.flowList.height - 2);
      this.screen.render();
    });

    this.log.key(["up"], () => {
      this.log.scroll(-1);
      this.screen.render();
    });

    this.log.key(["down"], () => {
      this.log.scroll(1);
      this.screen.render();
    });

    this.log.key(["pageup"], () => {
      this.log.scroll(-(this.log.height - 2));
      this.screen.render();
    });

    this.log.key(["pagedown"], () => {
      this.log.scroll(this.log.height - 2);
      this.screen.render();
    });

    this.log.key(["home"], () => {
      this.log.setScroll(0);
      this.screen.render();
    });

    this.log.key(["end"], () => {
      this.log.setScrollPerc(100);
      this.screen.render();
    });

    this.summary.key(["pageup"], () => {
      this.summary.scroll(-(this.summary.height - 2));
      this.screen.render();
    });

    this.summary.key(["pagedown"], () => {
      this.summary.scroll(this.summary.height - 2);
      this.screen.render();
    });

    this.progress.key(["pageup"], () => {
      this.progress.scroll(-(this.progress.height - 2));
      this.screen.render();
    });

    this.progress.key(["pagedown"], () => {
      this.progress.scroll(this.progress.height - 2);
      this.screen.render();
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
    this.screen.render();
  }

  private renderStaticContent(): void {
    this.summaryText = this.options.summaryText.trim();
    this.updateHeader();
    this.flowList.setItems(this.options.flows.map((flow) => flow.label));
    this.flowList.select(this.options.flows.findIndex((flow) => flow.id === this.selectedFlowId));
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
      renderAuxiliaryOutput: false,
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
    for (const phase of flow.phases) {
      const phaseState = flowState?.phases.find((candidate) => candidate.id === phase.id);
      lines.push(`${this.symbolForStatus(flow.id, phaseState?.status ?? "pending")} ${phase.id}`);
      for (const step of phase.steps) {
        const stepState = phaseState?.steps.find((candidate) => candidate.id === step.id);
        lines.push(`  ${this.symbolForStatus(flow.id, stepState?.status ?? "pending")} ${step.id}`);
      }
      lines.push("");
    }
    if (flowState?.terminated) {
      lines.push(`Stopped: ${flowState.terminationReason ?? "flow terminated"}`);
    }
    this.progress.setContent(lines.join("\n").trimEnd());
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

  private openConfirm(): void {
    const flow = this.flowMap.get(this.selectedFlowId);
    if (!flow) {
      return;
    }
    this.confirm.setContent(`Run flow "${flow.label}"?\n\nEnter: yes    Esc: no`);
    this.confirm.show();
    this.confirm.setFront();
    this.confirm.focus();
    this.screen.render();
  }

  private closeConfirm(): void {
    this.confirm.hide();
    this.focusPane("flows");
    this.screen.render();
  }

  mount(): void {
    setOutputAdapter(this.createAdapter());
    this.focusPane("flows");
  }

  destroy(): void {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
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
    this.screen.render();
  }

  setFlowFailed(flowId: string): void {
    this.failedFlowId = flowId;
    this.renderProgress();
    this.screen.render();
  }

  clearFlowFailure(flowId: string): void {
    if (this.failedFlowId === flowId) {
      this.failedFlowId = null;
    }
  }

  setStatus(status: string): void {
    this.currentFlowId = status;
    this.updateHeader();
    this.screen.render();
  }

  setSummary(markdown: string): void {
    this.summaryText = markdown.trim();
    this.renderSummary();
    this.screen.render();
  }

  appendLog(text: string): void {
    const normalized = text
      .split("\n")
      .map((line) => line.replace(/\t/g, "  "))
      .join("\n")
      .trimEnd();

    if (!normalized) {
      this.log.add("");
    } else {
      for (const line of normalized.split("\n")) {
        this.log.add(line);
      }
    }
    this.log.setScrollPerc(100);
    this.screen.render();
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
    this.screen.render();
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
        this.screen.render();
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
    this.screen.render();
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
}

export type { InteractiveFlowDefinition };
