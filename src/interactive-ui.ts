import path from "node:path";
import blessed from "neo-blessed";

import { renderMarkdownToTerminal } from "./markdown.js";
import type { FlowExecutionState } from "./pipeline/spec-types.js";
import { setOutputAdapter, stripAnsi, type OutputAdapter } from "./tui.js";
import { FlowInterruptedError, TaskRunnerError } from "./errors.js";
import {
  buildInitialUserInputValues,
  validateUserInputValues,
  type UserInputFieldDefinition,
  type UserInputFormDefinition,
  type UserInputFormValues,
  type UserInputResult,
} from "./user-input.js";

type InteractiveFlowDefinition = {
  id: string;
  label: string;
  description: string;
  source: "built-in" | "project-local";
  treePath: string[];
  sourcePath?: string;
  phases: Array<{
    id: string;
    repeatVars: Record<string, string | number | boolean | null>;
    steps: Array<{
      id: string;
    }>;
  }>;
};

type InteractiveUiOptions = {
  scopeKey: string;
  jiraIssueKey?: string | null;
  summaryText: string;
  cwd: string;
  gitBranchName: string | null;
  flows: InteractiveFlowDefinition[];
  getRunConfirmation: (flowId: string) => Promise<{
    resumeAvailable: boolean;
    hasExistingState: boolean;
    details?: string | null;
  }>;
  onRun: (flowId: string, mode: "resume" | "restart") => Promise<void>;
  onInterrupt: (flowId: string) => Promise<void>;
  onExit: () => void;
};

type FocusPane = "flows" | "progress" | "summary" | "log";

type FlowStatusState = {
  flowId: string | null;
  executionState: FlowExecutionState | null;
};

type ActiveFormSession = {
  form: UserInputFormDefinition;
  values: UserInputFormValues;
  currentFieldIndex: number;
  currentOptionIndex: number;
  resolve: (result: UserInputResult) => void;
  reject: (error: Error) => void;
};

type ConfirmSession = {
  kind: "run" | "interrupt";
  flowId: string;
  resumeAvailable: boolean;
  hasExistingState: boolean;
  details?: string | null;
  selectedAction: "resume" | "restart" | "cancel" | "ok" | "stop";
};

const CONFIRM_MIN_WIDTH = 44;
const CONFIRM_MIN_HEIGHT = 8;

type FlowTreeFolderNode = {
  kind: "folder";
  key: string;
  name: string;
  pathSegments: string[];
  children: FlowTreeNode[];
};

type FlowTreeFlowNode = {
  kind: "flow";
  key: string;
  name: string;
  pathSegments: string[];
  flow: InteractiveFlowDefinition;
};

type FlowTreeNode = FlowTreeFolderNode | FlowTreeFlowNode;

type VisibleFlowTreeItem =
  | {
      kind: "folder";
      key: string;
      name: string;
      depth: number;
      pathSegments: string[];
    }
  | {
      kind: "flow";
      key: string;
      name: string;
      depth: number;
      pathSegments: string[];
      flow: InteractiveFlowDefinition;
    };

function compareTreeNames(left: string, right: string): number {
  return left.localeCompare(right, "ru");
}

function makeFolderKey(pathSegments: string[]): string {
  return `folder:${pathSegments.join("/")}`;
}

function makeFlowKey(flowId: string): string {
  return `flow:${flowId}`;
}

function buildFlowTree(flows: InteractiveFlowDefinition[]): FlowTreeNode[] {
  const roots = new Map<string, FlowTreeFolderNode>();

  const ensureFolder = (pathSegments: string[]): FlowTreeFolderNode => {
    const firstSegment = pathSegments[0];
    if (!firstSegment) {
      throw new Error("Flow tree folder path cannot be empty.");
    }

    const rootFolder = roots.get(firstSegment);
    let currentFolder: FlowTreeFolderNode;
    if (rootFolder) {
      currentFolder = rootFolder;
    } else {
      currentFolder = {
        kind: "folder",
        key: makeFolderKey([firstSegment]),
        name: firstSegment,
        pathSegments: [firstSegment],
        children: [],
      };
      roots.set(firstSegment, currentFolder);
    }

    for (let index = 1; index < pathSegments.length; index += 1) {
      const segment = pathSegments[index] ?? "";
      const folderPath = pathSegments.slice(0, index + 1);
      let nextFolder = currentFolder.children.find(
        (child): child is FlowTreeFolderNode => child.kind === "folder" && child.name === segment,
      );
      if (!nextFolder) {
        nextFolder = {
          kind: "folder",
          key: makeFolderKey(folderPath),
          name: segment,
          pathSegments: folderPath,
          children: [],
        };
        currentFolder.children.push(nextFolder);
      }
      currentFolder = nextFolder;
    }

    return currentFolder;
  };

  for (const flow of flows) {
    if (flow.treePath.length === 0) {
      continue;
    }
    const folderPath = flow.treePath.slice(0, -1);
    const leafName = flow.treePath[flow.treePath.length - 1] ?? flow.id;
    const parent = ensureFolder(folderPath);
    parent.children.push({
      kind: "flow",
      key: makeFlowKey(flow.id),
      name: leafName,
      pathSegments: [...flow.treePath],
      flow,
    });
  }

  const sortNodes = (nodes: FlowTreeNode[]): FlowTreeNode[] =>
    [...nodes]
      .sort((left, right) => {
        if (left.kind !== right.kind) {
          return left.kind === "folder" ? -1 : 1;
        }
        return compareTreeNames(left.name, right.name);
      })
      .map((node) =>
        node.kind === "folder"
          ? {
              ...node,
              children: sortNodes(node.children),
            }
          : node,
      );

  const orderedRootNames = ["custom", "default"];
  const sortedRoots = [...roots.values()].sort((left, right) => {
    const leftIndex = orderedRootNames.indexOf(left.name);
    const rightIndex = orderedRootNames.indexOf(right.name);
    if (leftIndex !== -1 || rightIndex !== -1) {
      if (leftIndex === -1) {
        return 1;
      }
      if (rightIndex === -1) {
        return -1;
      }
      return leftIndex - rightIndex;
    }
    return compareTreeNames(left.name, right.name);
  });
  return sortNodes(sortedRoots);
}

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
  private readonly formModal: any;
  private readonly flowMap: Map<string, InteractiveFlowDefinition>;
  private readonly flowTree: FlowTreeNode[];
  private readonly expandedFlowFolders = new Set<string>();
  private visibleFlowItems: VisibleFlowTreeItem[] = [];
  private busy = false;
  private currentFlowId: string | null = null;
  private selectedFlowId: string;
  private selectedFlowItemKey: string;
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
  private activeFormSession: ActiveFormSession | null = null;
  private confirmSession: ConfirmSession | null = null;
  private scopeKey: string;
  private jiraIssueKey: string | null;
  private summaryVisible: boolean;

  constructor(private readonly options: InteractiveUiOptions) {
    if (options.flows.length === 0) {
      throw new Error("Interactive UI requires at least one flow.");
    }
    this.flowMap = new Map(options.flows.map((flow) => [flow.id, flow]));
    this.flowTree = buildFlowTree(options.flows);
    this.selectedFlowId = options.flows[0]?.id ?? "auto";
    this.visibleFlowItems = this.computeVisibleFlowItems();
    this.selectedFlowItemKey = this.visibleFlowItems[0]?.key ?? makeFlowKey(this.selectedFlowId);
    this.scopeKey = options.scopeKey;
    this.jiraIssueKey = options.jiraIssueKey ?? null;
    this.summaryVisible = options.summaryText.trim().length > 0;

    this.screen = blessed.screen({
      smartCSR: true,
      fullUnicode: true,
      title: `AgentWeaver ${this.scopeKey}`,
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

    this.formModal = blessed.box({
      parent: this.screen,
      top: "center",
      left: "center",
      width: "72%",
      height: "68%",
      hidden: true,
      tags: true,
      label: " User Input ",
      padding: {
        left: 1,
        right: 1,
        top: 1,
        bottom: 1,
      },
      border: "line",
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      style: {
        border: { fg: "magenta" },
        bg: "black",
        fg: "white",
      },
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

  private applyRightPaneLayout(): void {
    if (this.summaryVisible) {
      this.summary.show();
      this.summary.top = 3;
      this.summary.height = 16;
      this.log.top = 19;
      this.log.bottom = 1;
    } else {
      this.summary.hide();
      this.log.top = 3;
      this.log.bottom = 1;
    }
  }

  private bindKeys(): void {
    this.screen.key(["C-c", "q"], () => {
      if (this.hasActiveForm()) {
        return;
      }
      this.options.onExit();
    });

    this.screen.key(["f1", "h", "?"], () => {
      if (this.confirm.visible || this.hasActiveForm()) {
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
      if (this.busy && this.confirm.hidden && this.help.hidden) {
        this.openInterruptConfirm();
        return;
      }
      if (this.hasActiveForm()) {
        this.cancelActiveForm();
        return;
      }
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
      if (this.hasActiveForm()) {
        return;
      }
      this.log.setContent("");
      this.appendLog("Log cleared.");
    });

    this.screen.key(["tab"], () => {
      if (this.confirm.visible || !this.help.hidden || this.hasActiveForm()) {
        return;
      }
      this.cycleFocus(1);
    });

    this.screen.key(["S-tab"], () => {
      if (this.confirm.visible || !this.help.hidden || this.hasActiveForm()) {
        return;
      }
      this.cycleFocus(-1);
    });

    this.flowList.on("select item", (_item: unknown, index: number) => {
      if (this.hasActiveForm()) {
        return;
      }
      const selectedItem = this.visibleFlowItems[index];
      if (!selectedItem) {
        return;
      }
      this.selectedFlowItemKey = selectedItem.key;
      if (selectedItem.kind === "flow") {
        this.selectedFlowId = selectedItem.flow.id;
      }
      this.updateHeader();
      this.renderDescription();
      this.renderProgress();
      this.requestRender();
    });

    this.flowList.key(["enter"], async () => {
      if (this.busy || this.confirm.visible || !this.help.hidden || this.hasActiveForm()) {
        return;
      }
      const selectedItem = this.selectedFlowTreeItem();
      if (selectedItem?.kind === "folder") {
        this.toggleFlowFolder(selectedItem.key);
        return;
      }
      await this.openConfirm();
    });

    this.flowList.key(["right"], () => {
      if (this.hasActiveForm()) {
        return;
      }
      this.expandSelectedFlowFolder();
    });

    this.flowList.key(["left"], () => {
      if (this.hasActiveForm()) {
        return;
      }
      this.collapseSelectedFlowFolderOrSelectParent();
    });

    this.flowList.key(["pageup"], () => {
      if (this.hasActiveForm()) {
        return;
      }
      this.flowList.scroll(-(this.flowList.height - 2));
      this.requestRender();
    });

    this.flowList.key(["pagedown"], () => {
      if (this.hasActiveForm()) {
        return;
      }
      this.flowList.scroll(this.flowList.height - 2);
      this.requestRender();
    });

    this.log.key(["up"], () => {
      if (this.hasActiveForm()) {
        return;
      }
      this.log.scroll(-1);
      this.requestRender();
    });

    this.log.key(["down"], () => {
      if (this.hasActiveForm()) {
        return;
      }
      this.log.scroll(1);
      this.requestRender();
    });

    this.log.key(["pageup"], () => {
      if (this.hasActiveForm()) {
        return;
      }
      this.log.scroll(-(this.log.height - 2));
      this.requestRender();
    });

    this.log.key(["pagedown"], () => {
      if (this.hasActiveForm()) {
        return;
      }
      this.log.scroll(this.log.height - 2);
      this.requestRender();
    });

    this.log.key(["home"], () => {
      if (this.hasActiveForm()) {
        return;
      }
      this.log.setScroll(0);
      this.requestRender();
    });

    this.log.key(["end"], () => {
      if (this.hasActiveForm()) {
        return;
      }
      this.log.setScrollPerc(100);
      this.requestRender();
    });

    this.summary.key(["pageup"], () => {
      if (this.hasActiveForm()) {
        return;
      }
      this.summary.scroll(-(this.summary.height - 2));
      this.requestRender();
    });

    this.summary.key(["pagedown"], () => {
      if (this.hasActiveForm()) {
        return;
      }
      this.summary.scroll(this.summary.height - 2);
      this.requestRender();
    });

    this.progress.key(["pageup"], () => {
      if (this.hasActiveForm()) {
        return;
      }
      this.progress.scroll(-(this.progress.height - 2));
      this.requestRender();
    });

    this.progress.key(["pagedown"], () => {
      if (this.hasActiveForm()) {
        return;
      }
      this.progress.scroll(this.progress.height - 2);
      this.requestRender();
    });

    this.confirm.key(["enter"], async () => {
      if (this.confirm.hidden || !this.confirmSession) {
        return;
      }
      if (this.hasActiveForm() && this.confirmSession.kind !== "interrupt") {
        return;
      }
      const { flowId, selectedAction, kind } = this.confirmSession;
      if (selectedAction === "cancel") {
        this.closeConfirm();
        return;
      }
      if (kind === "interrupt") {
        this.closeConfirm();
        await this.options.onInterrupt(flowId);
        return;
      }
      this.closeConfirm();
      this.setBusy(true, flowId);
      this.clearFlowFailure(flowId);
      this.setFlowDisplayState(flowId, null);
      try {
        const launchMode = selectedAction === "resume" ? "resume" : "restart";
        await this.options.onRun(flowId, launchMode);
      } finally {
        this.setBusy(false);
        this.focusPane("flows");
      }
    });

    this.confirm.key(["escape"], () => {
      if (this.hasActiveForm()) {
        return;
      }
      this.closeConfirm();
    });

    this.confirm.key(["left", "S-tab"], () => {
      this.moveConfirmSelection(-1);
    });

    this.confirm.key(["right", "tab"], () => {
      this.moveConfirmSelection(1);
    });

    this.screen.on("keypress", (ch: string, key: { full?: string; name?: string; ctrl?: boolean; shift?: boolean }) => {
      if (!this.activeFormSession) {
        return;
      }
      this.handleActiveFormKey(ch, key);
    });
  }

  private cycleFocus(direction: 1 | -1): void {
    const panes: FocusPane[] = this.summaryVisible ? ["flows", "progress", "summary", "log"] : ["flows", "progress", "log"];
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
    } else if (pane === "summary" && this.summaryVisible) {
      this.summary.focus();
    } else {
      this.log.focus();
    }

    this.footer.setContent(
      ` Focus: ${pane} | Up/Down: select | Left/Right: fold | Enter: toggle/run | h: help | Esc: close/interrupt | Tab: switch pane | q: exit `,
    );
    this.requestRender();
  }

  private renderStaticContent(): void {
    this.summaryText = this.options.summaryText.trim();
    this.summaryVisible = this.summaryText.length > 0;
    this.applyRightPaneLayout();
    this.updateHeader();
    this.renderFlowTreeList();
    this.renderDescription();
    this.renderSummary();
    this.renderProgress();

    this.help.setContent(
      renderMarkdownToTerminal(
        [
          "AgentWeaver interactive mode",
          "",
          "Клавиши:",
          "Up / Down    выбрать папку или flow",
          "Right        раскрыть папку",
          "Left         свернуть папку или перейти к родителю",
          "Enter        раскрыть папку или открыть запуск flow",
          "Enter        подтвердить запуск в модалке",
          "Esc          закрыть help/модалку или прервать running flow",
          "F1           открыть или закрыть help",
          "Tab          переключить pane",
          "Ctrl+L       очистить лог",
          "q / Ctrl+C   выйти",
          "",
          "Доступные flow:",
          ...this.options.flows.map((flow) => flow.treePath.join("/")),
        ].join("\n"),
      ),
    );

    this.footer.setContent(" Up/Down: select | Left/Right: fold | Enter: toggle/run | Esc: close/interrupt | h: help | Tab: switch pane | q: exit ");
  }

  private updateHeader(): void {
    const current = this.currentFlowId ?? this.selectedHeaderLabel();
    const pathParts = this.options.cwd.split(path.sep).filter(Boolean);
    const folderName = pathParts.slice(-3).join("/") || this.options.cwd;
    const branchLabel = this.options.gitBranchName ? this.options.gitBranchName : "detached-head";
    const flowLabel = `${current}${this.busy ? " {yellow-fg}[running]{/yellow-fg}" : ""}`;
    const divider = " {gray-fg}│{/gray-fg} ";
    this.header.setContent(
      [
        "{bold}AgentWeaver{/bold}",
        divider,
        `{bold}Scope{/bold} {green-fg}${this.scopeKey}{/green-fg}`,
        this.jiraIssueKey ? `${divider}{bold}Jira{/bold} {yellow-fg}${this.jiraIssueKey}{/yellow-fg}` : "",
        divider,
        `{bold}Flow{/bold} ${flowLabel}`,
        divider,
        `{bold}Location{/bold} {cyan-fg}${folderName}{/cyan-fg} {gray-fg}•{/gray-fg} {magenta-fg}${branchLabel}{/magenta-fg}`,
      ].join(""),
    );
  }

  private renderSummary(): void {
    const summaryBody = this.summaryText || "Task summary is not available yet.";
    this.summary.setContent(renderMarkdownToTerminal(stripAnsi(summaryBody)));
  }

  private hasActiveForm(): boolean {
    return this.activeFormSession !== null;
  }

  private currentFormField(): UserInputFieldDefinition | null {
    if (!this.activeFormSession) {
      return null;
    }
    return this.activeFormSession.form.fields[this.activeFormSession.currentFieldIndex] ?? null;
  }

  private renderTextInputValue(value: string, placeholder?: string): string[] {
    const rawText = value || placeholder || "Введите текст";
    const frameWidth = Math.max(36, rawText.length + 6);
    const innerWidth = Math.max(32, frameWidth - 4);
    const visibleText = rawText.length > innerWidth - 2 ? `${rawText.slice(0, innerWidth - 5)}...` : rawText;
    const padded = value
      ? `{white-fg}${visibleText.padEnd(innerWidth - 2, " ")}{/white-fg}`
      : `{gray-fg}${visibleText.padEnd(innerWidth - 2, " ")}{/gray-fg}`;

    return [
      `{cyan-fg}┌${"─".repeat(frameWidth - 2)}┐{/cyan-fg}`,
      `{cyan-fg}│{/cyan-fg}{black-bg} {green-fg}>{/green-fg} ${padded} {/black-bg}{cyan-fg}│{/cyan-fg}`,
      `{cyan-fg}└${"─".repeat(frameWidth - 2)}┘{/cyan-fg}`,
    ];
  }

  private renderActiveForm(): void {
    if (!this.activeFormSession) {
      this.formModal.hide();
      this.footer.setContent(" Up/Down: select | Left/Right: fold | Enter: toggle/run | Esc: close/interrupt | h: help | Tab: switch pane | q: exit ");
      this.requestRender();
      return;
    }

    const session = this.activeFormSession;
    const field = this.currentFormField();
    if (!field) {
      return;
    }

    const lines: string[] = [`{bold}${session.form.title}{/bold}`];
    if (session.form.description?.trim()) {
      lines.push("");
      lines.push(session.form.description.trim());
    }
    lines.push("");
    lines.push(`Field ${session.currentFieldIndex + 1}/${session.form.fields.length}`);
    lines.push(`{yellow-fg}${field.label}{/yellow-fg}`);
    if (field.help?.trim()) {
      lines.push(field.help.trim());
    }
    lines.push("");

    if (field.type === "boolean") {
      const current = session.values[field.id] === true;
      lines.push(`${current ? "[x]" : "[ ]"} ${field.label}`);
      lines.push("");
      lines.push("Space: toggle");
      lines.push("Enter/Tab: next field");
    } else if (field.type === "text") {
      const current = String(session.values[field.id] ?? "");
      lines.push(...this.renderTextInputValue(current, field.placeholder));
      lines.push("");
      lines.push("Type text, Backspace: delete");
      lines.push("Enter/Tab: next field");
    } else {
      const currentOptionIndex = Math.min(session.currentOptionIndex, Math.max(0, field.options.length - 1));
      session.currentOptionIndex = currentOptionIndex;
      field.options.forEach((option, index) => {
        const isCursor = index === currentOptionIndex;
        const value = session.values[field.id];
        const isSelected =
          field.type === "single-select"
            ? value === option.value
            : Array.isArray(value) && value.includes(option.value);
        const cursor = isCursor ? "{cyan-fg}>{/cyan-fg}" : " ";
        const marker = isSelected ? "[x]" : "[ ]";
        lines.push(`${cursor} ${marker} ${option.label}`);
        if (option.description?.trim()) {
          lines.push(`    {gray-fg}${option.description.trim()}{/gray-fg}`);
        }
      });
      lines.push("");
      lines.push("Up/Down: move");
      lines.push("Space: select/toggle");
      lines.push("Enter/Tab: next field");
    }

    lines.push("");
    lines.push("{green-fg}Ctrl+S{/green-fg}: submit");
    lines.push("{magenta-fg}Shift+Tab{/magenta-fg}: previous field");
    lines.push("{red-fg}Esc{/red-fg}: cancel");

    this.formModal.setContent(lines.join("\n"));
    this.formModal.show();
    this.formModal.setFront();
    this.formModal.focus();
    this.footer.setContent(" Form: Space select | Tab next | Shift+Tab prev | Ctrl+S submit | Esc cancel ");
    this.requestRender();
  }

  private moveActiveFormField(delta: 1 | -1): void {
    if (!this.activeFormSession) {
      return;
    }
    const nextIndex = Math.min(
      this.activeFormSession.form.fields.length - 1,
      Math.max(0, this.activeFormSession.currentFieldIndex + delta),
    );
    this.activeFormSession.currentFieldIndex = nextIndex;
    this.activeFormSession.currentOptionIndex = 0;
    this.renderActiveForm();
  }

  private moveActiveFormOption(delta: 1 | -1): void {
    const field = this.currentFormField();
    if (!this.activeFormSession || !field || (field.type !== "single-select" && field.type !== "multi-select")) {
      return;
    }
    const nextIndex = Math.min(field.options.length - 1, Math.max(0, this.activeFormSession.currentOptionIndex + delta));
    this.activeFormSession.currentOptionIndex = nextIndex;
    this.renderActiveForm();
  }

  private toggleActiveFormValue(): void {
    const session = this.activeFormSession;
    const field = this.currentFormField();
    if (!session || !field) {
      return;
    }

    if (field.type === "boolean") {
      session.values[field.id] = session.values[field.id] !== true;
      this.renderActiveForm();
      return;
    }

    if (field.type === "single-select") {
      const option = field.options[session.currentOptionIndex];
      if (!option) {
        return;
      }
      session.values[field.id] = option.value;
      this.renderActiveForm();
      return;
    }

    if (field.type === "multi-select") {
      const option = field.options[session.currentOptionIndex];
      if (!option) {
        return;
      }
      const current = Array.isArray(session.values[field.id]) ? [...(session.values[field.id] as string[])] : [];
      const next = current.includes(option.value)
        ? current.filter((item) => item !== option.value)
        : [...current, option.value];
      session.values[field.id] = next;
      this.renderActiveForm();
    }
  }

  private appendActiveFormText(ch: string, key: { name?: string; ctrl?: boolean; meta?: boolean }): void {
    const session = this.activeFormSession;
    const field = this.currentFormField();
    if (!session || !field || field.type !== "text") {
      return;
    }
    const current = String(session.values[field.id] ?? "");
    if (key.name === "backspace") {
      session.values[field.id] = current.slice(0, -1);
      this.renderActiveForm();
      return;
    }
    if (key.ctrl || key.meta || !ch || ch === "\r" || ch === "\n" || ch === "\t") {
      return;
    }
    session.values[field.id] = `${current}${ch}`;
    this.renderActiveForm();
  }

  private submitActiveForm(): void {
    if (!this.activeFormSession) {
      return;
    }
    const session = this.activeFormSession;
    try {
      validateUserInputValues(session.form, session.values);
      const result: UserInputResult = {
        formId: session.form.formId,
        submittedAt: new Date().toISOString(),
        values: session.values,
      };
      this.activeFormSession = null;
      this.formModal.hide();
      this.focusPane("flows");
      session.resolve(result);
      this.renderActiveForm();
    } catch (error) {
      this.appendLog((error as Error).message);
      this.renderActiveForm();
    }
  }

  private cancelActiveForm(): void {
    if (!this.activeFormSession) {
      return;
    }
    const session = this.activeFormSession;
    this.activeFormSession = null;
    this.formModal.hide();
    this.focusPane("flows");
    session.reject(new TaskRunnerError(`User cancelled form '${session.form.formId}'.`));
    this.renderActiveForm();
  }

  interruptActiveForm(message = "Flow interrupted by user."): void {
    if (!this.activeFormSession) {
      return;
    }
    const session = this.activeFormSession;
    this.activeFormSession = null;
    this.formModal.hide();
    this.focusPane("flows");
    session.reject(new FlowInterruptedError(message));
    this.renderActiveForm();
  }

  private handleActiveFormKey(ch: string, key: { full?: string; name?: string; ctrl?: boolean; shift?: boolean; meta?: boolean }): void {
    const field = this.currentFormField();
    if (!field) {
      return;
    }
    if (key.ctrl && key.name === "s") {
      this.submitActiveForm();
      return;
    }
    if (key.name === "escape") {
      this.cancelActiveForm();
      return;
    }
    if (key.name === "tab") {
      this.moveActiveFormField(1);
      return;
    }
    if (key.name === "backtab") {
      this.moveActiveFormField(-1);
      return;
    }

    if (field.type === "text") {
      if (key.name === "enter") {
        this.moveActiveFormField(1);
        return;
      }
      this.appendActiveFormText(ch, key);
      return;
    }

    if (field.type === "boolean") {
      if (key.name === "space" || key.name === "left" || key.name === "right") {
        this.toggleActiveFormValue();
        return;
      }
      if (key.name === "enter") {
        this.moveActiveFormField(1);
      }
      return;
    }

    if (key.name === "up") {
      this.moveActiveFormOption(-1);
      return;
    }
    if (key.name === "down") {
      this.moveActiveFormOption(1);
      return;
    }
    if (key.name === "space") {
      this.toggleActiveFormValue();
      return;
    }
    if (key.name === "enter") {
      if (field.type === "single-select") {
        this.toggleActiveFormValue();
      }
      this.moveActiveFormField(1);
    }
  }

  private renderDescription(): void {
    const selectedItem = this.selectedFlowTreeItem();
    if (!selectedItem) {
      this.description.setContent("Flow structure is not available.");
      return;
    }

    if (selectedItem.kind === "folder") {
      const kindLabel = selectedItem.pathSegments[0] === "custom" ? "project-local" : "built-in";
      const folderDescription = [
        `Папка flow \`${selectedItem.pathSegments.join("/")}\`.`,
        "",
        `Источник: ${kindLabel}`,
        `Статус: ${this.expandedFlowFolders.has(selectedItem.key) ? "развёрнута" : "свёрнута"}`,
      ].join("\n");
      this.description.setContent(renderMarkdownToTerminal(stripAnsi(folderDescription)));
      return;
    }

    const { flow } = selectedItem;
    const description = flow.description?.trim() || "Описание для этого flow пока не задано.";
    const details = [
      `Путь: ${flow.treePath.join("/")}`,
      `Источник: ${flow.source === "project-local" ? "project-local" : "built-in"}`,
      flow.source === "project-local" && flow.sourcePath ? `Файл: ${flow.sourcePath}` : "",
    ]
      .filter((line) => line.length > 0)
      .join("\n");
    this.description.setContent(renderMarkdownToTerminal(stripAnsi(details ? `${description}\n\n${details}` : description)));
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
    if (this.busy) {
      return this.flowMap.get(this.activeFlowId());
    }
    const selectedItem = this.selectedFlowTreeItem();
    if (selectedItem?.kind === "flow") {
      return selectedItem.flow;
    }
    return undefined;
  }

  private renderProgress(): void {
    const flow = this.progressFlowDefinition();
    if (!flow) {
      this.progress.setContent("Выберите конкретный flow в дереве, чтобы увидеть его прогресс.");
      return;
    }

    const flowState =
      this.flowState.flowId === flow.id
        ? this.flowState.executionState
        : this.currentFlowId === flow.id
          ? this.flowState.executionState
          : null;

    const lines: string[] = [`{bold}${flow.label}{/bold}`, ""];
    let anchorLine: number | null = null;
    let sawExecutedItem = false;
    const rememberAnchor = (status: "pending" | "running" | "done" | "skipped"): void => {
      if (status === "running") {
        anchorLine = lines.length;
        sawExecutedItem = true;
        return;
      }
      if (status === "done" || status === "skipped") {
        sawExecutedItem = true;
        return;
      }
      if (status === "pending" && sawExecutedItem && anchorLine === null) {
        anchorLine = lines.length;
      }
    };
    for (const item of this.visiblePhaseItems(flow, flowState)) {
      if (item.kind === "group") {
        const visiblePhases = item.phases.filter((phase) => this.shouldDisplayPhase(flow, flowState, phase));
        if (visiblePhases.length === 0) {
          continue;
        }
        const groupStatus = this.statusForGroup(flow, visiblePhases, flowState);
        rememberAnchor(groupStatus);
        lines.push(`${this.symbolForGroup(flow.id, flow, visiblePhases, flowState)} ${this.colorizeProgressLabel(item.label, groupStatus)}`);
        for (const phase of visiblePhases) {
          const phaseState = flowState?.phases.find((candidate) => candidate.id === phase.id);
          const phaseStatus = this.displayStatusForPhase(flowState, flow, phase, phaseState?.status ?? null);
          rememberAnchor(phaseStatus);
          lines.push(`  ${this.symbolForStatus(flow.id, phaseStatus)} ${this.colorizeProgressLabel(this.displayPhaseId(phase), phaseStatus)}`);
          for (const step of phase.steps) {
            const stepState = phaseState?.steps.find((candidate) => candidate.id === step.id);
            const stepStatus = this.displayStatusForStep(flowState, flow, phase, stepState?.status ?? null);
            rememberAnchor(stepStatus);
            lines.push(`    ${this.symbolForStatus(flow.id, stepStatus)} ${this.colorizeProgressLabel(step.id, stepStatus)}`);
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
      rememberAnchor(phaseStatus);
      lines.push(`${this.symbolForStatus(flow.id, phaseStatus)} ${this.colorizeProgressLabel(this.displayPhaseId(phase), phaseStatus)}`);
      for (const step of phase.steps) {
        const stepState = phaseState?.steps.find((candidate) => candidate.id === step.id);
        const stepStatus = this.displayStatusForStep(flowState, flow, phase, stepState?.status ?? null);
        rememberAnchor(stepStatus);
        lines.push(`  ${this.symbolForStatus(flow.id, stepStatus)} ${this.colorizeProgressLabel(step.id, stepStatus)}`);
      }
      lines.push("");
    }
    if (flowState?.terminated) {
      lines.push(`{green-fg}✓{/green-fg} {green-fg}Flow completed successfully{/green-fg}`);
      lines.push(`{gray-fg}Reason: ${flowState.terminationReason ?? "flow terminated"}{/gray-fg}`);
    }
    this.progress.setContent(lines.join("\n").trimEnd());
    if (this.busy && this.activeFlowId() === flow.id && anchorLine !== null) {
      const viewportHeight = Math.max(1, Number(this.progress.height) - 2);
      const targetScroll = Math.max(0, anchorLine - Math.floor(viewportHeight / 2));
      this.progress.setScroll(targetScroll);
    }
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
      return "{green-fg}✓{/green-fg}";
    }
    if (status === "skipped") {
      return "{gray-fg}·{/gray-fg}";
    }
    if (status === "running") {
      const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
      if (this.failedFlowId === flowId && !this.busy) {
        return "{red-fg}×{/red-fg}";
      }
      return `{yellow-fg}${frames[this.spinnerFrame] ?? "▶"}{/yellow-fg}`;
    }
    return "{gray-fg}○{/gray-fg}";
  }

  private colorizeProgressLabel(
    text: string,
    status: "pending" | "running" | "done" | "skipped",
  ): string {
    if (status === "done") {
      return `{green-fg}${text}{/green-fg}`;
    }
    if (status === "running") {
      return `{yellow-fg}${text}{/yellow-fg}`;
    }
    if (status === "skipped") {
      return `{gray-fg}${text}{/gray-fg}`;
    }
    return `{white-fg}${text}{/white-fg}`;
  }

  private statusForGroup(
    flow: InteractiveFlowDefinition,
    phases: InteractiveFlowDefinition["phases"],
    flowState: FlowExecutionState | null,
  ): "pending" | "running" | "done" | "skipped" {
    const statuses = phases.map((phase) =>
      this.displayStatusForPhase(
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

  private symbolForGroup(
    flowId: string,
    flow: InteractiveFlowDefinition,
    phases: InteractiveFlowDefinition["phases"],
    flowState: FlowExecutionState | null,
  ): string {
    const groupStatus = this.statusForGroup(flow, phases, flowState);
    if (groupStatus === "running") {
      return this.symbolForStatus(flowId, "running");
    }
    if (groupStatus === "skipped") {
      return "{gray-fg}·{/gray-fg}";
    }
    if (groupStatus === "done") {
      return "{green-fg}✓{/green-fg}";
    }
    return "{gray-fg}○{/gray-fg}";
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
      return true;
    }
    if (phaseState?.status === "skipped" && flowState.terminated && this.isAfterTermination(flowState, flow, phase)) {
      return false;
    }
    return true;
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

  private moveConfirmSelection(delta: 1 | -1): void {
    if (!this.confirmSession) {
      return;
    }
    const actions = this.confirmActions();
    const currentIndex = actions.indexOf(this.confirmSession.selectedAction);
    const nextIndex = (currentIndex + delta + actions.length) % actions.length;
    this.confirmSession.selectedAction = (actions[nextIndex] ?? "cancel") as ConfirmSession["selectedAction"];
    this.renderConfirm();
  }

  private confirmActions(): string[] {
    if (!this.confirmSession) {
      return ["cancel"];
    }
    if (this.confirmSession.kind === "interrupt") {
      return ["stop", "cancel"];
    }
    return this.confirmSession.resumeAvailable
      ? ["resume", "restart", "cancel"]
      : this.confirmSession.hasExistingState
        ? ["restart", "cancel"]
        : ["ok", "cancel"];
  }

  private renderConfirm(): void {
    const session = this.confirmSession;
    if (!session) {
      return;
    }
    const flow = this.flowMap.get(session.flowId);
    const actions = this.confirmActions();
    const actionLabels = actions
      .map((action) => {
        const label = action === "stop"
          ? "Stop"
          : action === "resume"
            ? "Resume"
            : action === "restart"
              ? "Restart"
              : action === "ok"
                ? "OK"
                : "Cancel";
        return session.selectedAction === action ? `[ ${label} ]` : `  ${label}  `;
      })
      .join("   ");
    const lines = [session.kind === "interrupt" ? `Interrupt flow "${flow?.label ?? session.flowId}"?` : `Run flow "${flow?.label ?? session.flowId}"?`];
    if (session.details?.trim()) {
      lines.push("", session.details.trim());
    }
    lines.push("", actionLabels, "", "Left/Right or Tab: choose    Enter: confirm    Esc: cancel");
    const content = lines.join("\n");
    const contentLines = content.split("\n");
    const lineCount = contentLines.length;
    const maxLineLength = contentLines.reduce((max, line) => Math.max(max, stripAnsi(line).length), 0);
    const screenWidth = Math.max(Number(this.screen.width ?? 0), CONFIRM_MIN_WIDTH);
    const screenHeight = Math.max(Number(this.screen.height ?? 0), CONFIRM_MIN_HEIGHT);
    const desiredWidth = Math.max(CONFIRM_MIN_WIDTH, maxLineLength + 6);
    const desiredHeight = Math.max(CONFIRM_MIN_HEIGHT, lineCount + 4);

    this.confirm.width = Math.min(desiredWidth, Math.max(CONFIRM_MIN_WIDTH, screenWidth - 4));
    this.confirm.height = Math.min(desiredHeight, Math.max(CONFIRM_MIN_HEIGHT, screenHeight - 2));
    this.confirm.setContent(content);
    this.confirm.show();
    this.confirm.setFront();
    this.confirm.focus();
    this.requestRender();
  }

  private async openConfirm(): Promise<void> {
    const selectedItem = this.selectedFlowTreeItem();
    if (!selectedItem || selectedItem.kind !== "flow") {
      return;
    }
    const flow = selectedItem.flow;
    if (!flow) {
      return;
    }
    const confirmation = await this.options.getRunConfirmation(flow.id);
    this.confirmSession = {
      kind: "run",
      flowId: flow.id,
      resumeAvailable: confirmation.resumeAvailable,
      hasExistingState: confirmation.hasExistingState,
      details: confirmation.details ?? null,
      selectedAction: confirmation.resumeAvailable ? "resume" : confirmation.hasExistingState ? "restart" : "ok",
    };
    this.renderConfirm();
  }

  private openInterruptConfirm(): void {
    const flowId = this.currentFlowId;
    if (!flowId || this.confirm.visible) {
      return;
    }
    this.confirmSession = {
      kind: "interrupt",
      flowId,
      resumeAvailable: true,
      hasExistingState: true,
      details: "Текущий flow будет остановлен. Состояние сохранится, и его можно будет продолжить через Resume.",
      selectedAction: "stop",
    };
    this.renderConfirm();
  }

  private closeConfirm(): void {
    this.confirmSession = null;
    this.confirm.hide();
    this.focusPane("flows");
    this.requestRender();
  }

  requestUserInput(form: UserInputFormDefinition): Promise<UserInputResult> {
    if (this.activeFormSession) {
      return Promise.reject(new TaskRunnerError("Another user input form is already active."));
    }
    if (form.fields.length === 0) {
      return Promise.resolve({
        formId: form.formId,
        submittedAt: new Date().toISOString(),
        values: {},
      });
    }
    return new Promise<UserInputResult>((resolve, reject) => {
      this.activeFormSession = {
        form,
        values: buildInitialUserInputValues(form.fields),
        currentFieldIndex: 0,
        currentOptionIndex: 0,
        resolve,
        reject,
      };
      this.renderActiveForm();
    });
  }

  mount(): void {
    setOutputAdapter(this.createAdapter());
    this.applyRightPaneLayout();
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
    if (this.activeFormSession) {
      this.activeFormSession.reject(new TaskRunnerError(`User cancelled form '${this.activeFormSession.form.formId}'.`));
      this.activeFormSession = null;
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
    this.summaryVisible = this.summaryText.length > 0;
    this.applyRightPaneLayout();
    if (!this.summaryVisible && this.focusedPane === "summary") {
      this.focusPane("log");
      return;
    }
    this.renderSummary();
    this.requestRender();
  }

  clearSummary(): void {
    this.summaryText = "";
    this.summaryVisible = false;
    this.applyRightPaneLayout();
    if (this.focusedPane === "summary") {
      this.focusPane("log");
      return;
    }
    this.requestRender();
  }

  setScope(scopeKey: string, jiraIssueKey?: string | null): void {
    this.scopeKey = scopeKey;
    this.jiraIssueKey = jiraIssueKey ?? null;
    this.screen.title = `AgentWeaver ${scopeKey}`;
    this.updateHeader();
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

  private computeVisibleFlowItems(): VisibleFlowTreeItem[] {
    const items: VisibleFlowTreeItem[] = [];
    const walk = (nodes: FlowTreeNode[], depth: number): void => {
      for (const node of nodes) {
        if (node.kind === "folder") {
          items.push({
            kind: "folder",
            key: node.key,
            name: node.name,
            depth,
            pathSegments: [...node.pathSegments],
          });
          if (this.expandedFlowFolders.has(node.key)) {
            walk(node.children, depth + 1);
          }
          continue;
        }
        items.push({
          kind: "flow",
          key: node.key,
          name: node.name,
          depth,
          pathSegments: [...node.pathSegments],
          flow: node.flow,
        });
      }
    };
    walk(this.flowTree, 0);
    return items;
  }

  private selectedFlowTreeItem(): VisibleFlowTreeItem | undefined {
    return this.visibleFlowItems.find((item) => item.key === this.selectedFlowItemKey);
  }

  private selectedHeaderLabel(): string {
    const selectedItem = this.selectedFlowTreeItem();
    if (!selectedItem) {
      return this.selectedFlowId;
    }
    return selectedItem.kind === "folder" ? selectedItem.pathSegments.join("/") : selectedItem.flow.label;
  }

  private refreshVisibleFlowItems(): void {
    this.visibleFlowItems = this.computeVisibleFlowItems();
    if (!this.visibleFlowItems.some((item) => item.key === this.selectedFlowItemKey)) {
      this.selectedFlowItemKey = this.visibleFlowItems[0]?.key ?? makeFlowKey(this.selectedFlowId);
    }
    const selectedItem = this.selectedFlowTreeItem();
    if (selectedItem?.kind === "flow") {
      this.selectedFlowId = selectedItem.flow.id;
    }
  }

  private renderFlowTreeList(): void {
    this.refreshVisibleFlowItems();
    this.flowList.setItems(this.visibleFlowItems.map((item) => this.renderFlowTreeLabel(item)));
    const selectedIndex = this.visibleFlowItems.findIndex((item) => item.key === this.selectedFlowItemKey);
    this.flowList.select(selectedIndex >= 0 ? selectedIndex : 0);
  }

  private renderFlowTreeLabel(item: VisibleFlowTreeItem): string {
    const indent = "  ".repeat(item.depth);
    if (item.kind === "folder") {
      const expanded = this.expandedFlowFolders.has(item.key);
      const color = "cyan";
      return `${indent}{${color}-fg}${expanded ? "▾" : "▸"} ${item.name}{/${color}-fg}`;
    }
    const color = "white";
    return `${indent}{${color}-fg}• ${item.name}{/${color}-fg}`;
  }

  private toggleFlowFolder(folderKey: string): void {
    if (this.expandedFlowFolders.has(folderKey)) {
      this.expandedFlowFolders.delete(folderKey);
    } else {
      this.expandedFlowFolders.add(folderKey);
    }
    this.renderFlowTreeList();
    this.renderDescription();
    this.renderProgress();
    this.updateHeader();
    this.requestRender();
  }

  private expandSelectedFlowFolder(): void {
    const selectedItem = this.selectedFlowTreeItem();
    if (!selectedItem || selectedItem.kind !== "folder" || this.expandedFlowFolders.has(selectedItem.key)) {
      return;
    }
    this.toggleFlowFolder(selectedItem.key);
  }

  private collapseSelectedFlowFolderOrSelectParent(): void {
    const selectedItem = this.selectedFlowTreeItem();
    if (!selectedItem) {
      return;
    }
    if (selectedItem.kind === "folder" && this.expandedFlowFolders.has(selectedItem.key)) {
      this.toggleFlowFolder(selectedItem.key);
      return;
    }
    const parentPath = selectedItem.pathSegments.slice(0, -1);
    if (parentPath.length === 0) {
      return;
    }
    const parentKey = makeFolderKey(parentPath);
    if (!this.visibleFlowItems.some((item) => item.key === parentKey)) {
      return;
    }
    this.selectedFlowItemKey = parentKey;
    this.renderFlowTreeList();
    this.renderDescription();
    this.renderProgress();
    this.updateHeader();
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
