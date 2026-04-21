import path from "node:path";

import { FlowInterruptedError, TaskRunnerError } from "../errors.js";
import { renderMarkdownToTerminal } from "../markdown.js";
import type { FlowExecutionState } from "../pipeline/spec-types.js";
import { setOutputAdapter, stripAnsi, type OutputAdapter } from "../tui.js";
import {
  buildInitialUserInputValues,
  normalizeUserInputFieldValue,
  resolveFieldDefinition,
  validateUserInputValues,
  type UserInputFieldDefinition,
  type UserInputFormDefinition,
  type UserInputFormValues,
  type UserInputResult,
} from "../user-input.js";
import { buildProgressViewModel } from "./progress.js";
import type { InteractiveSessionOptions } from "./session.js";
import { selectHeaderLabel } from "./selectors.js";
import { createInitialInteractiveState, type InteractiveSessionState } from "./state.js";
import { buildFlowTree, collectInitiallyExpandedFolderKeys, computeVisibleFlowItems, makeFlowKey, makeFolderKey } from "./tree.js";
import type { FocusPane, FlowTreeNode, InteractiveFlowDefinition, VisibleFlowTreeItem } from "./types.js";
import type { InteractiveSessionViewModel, InteractiveFormViewModel } from "./view-model.js";

type Keypress = {
  full?: string;
  name?: string;
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
};

export type InteractiveSessionChangeEvent =
  | {
      type: "render";
      syncLog?: boolean;
    }
  | {
      type: "log";
      appendedLines: string[];
    };

type ActiveFormSession = {
  form: UserInputFormDefinition;
  values: UserInputFormValues;
  currentFieldIndex: number;
  currentOptionIndex: number;
  currentTextCursorIndex: number;
  previewScrollOffset: number;
  resolve: (result: UserInputResult) => void;
  reject: (error: Error) => void;
};

type ConfirmSession = {
  kind: "run" | "interrupt" | "exit";
  flowId: string | null;
  resumeAvailable: boolean;
  hasExistingState: boolean;
  details?: string | null;
  selectedAction: "resume" | "restart" | "cancel" | "ok" | "stop";
};

const HELP_TEXT = renderMarkdownToTerminal(
  [
    "AgentWeaver interactive mode",
    "",
    "Keys:",
    "Up / Down    select folder or flow",
    "Right        expand folder",
    "Left         collapse folder or go to parent",
    "Enter        expand folder or launch flow",
    "Enter        confirm launch in modal",
    "Esc          close help/modal or interrupt running flow",
    "F1           open or close help",
    "Tab          switch pane",
    "Ctrl+L       clear log",
    "q / Ctrl+C   exit",
  ].join("\n"),
);

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 200;
const LOG_FLUSH_INTERVAL_MS = 120;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isPrintableCharacter(ch: string, key: Keypress): boolean {
  return Boolean(ch) && !key.ctrl && !key.meta && !/^[\x00-\x1f\x7f]$/.test(ch);
}

function isReverseTabKey(key: Keypress): boolean {
  return key.name === "backtab" || (key.name === "tab" && key.shift === true);
}

function textIndexToLineColumn(value: string, index: number): { line: number; column: number } {
  const boundedIndex = clamp(index, 0, value.length);
  const beforeCursor = value.slice(0, boundedIndex);
  const lines = beforeCursor.split("\n");
  return {
    line: Math.max(0, lines.length - 1),
    column: (lines[lines.length - 1] ?? "").length,
  };
}

function textLineColumnToIndex(value: string, line: number, column: number): number {
  const lines = value.split("\n");
  const boundedLine = clamp(line, 0, Math.max(0, lines.length - 1));
  let index = 0;
  for (let currentLine = 0; currentLine < boundedLine; currentLine += 1) {
    index += (lines[currentLine] ?? "").length + 1;
  }
  const targetLine = lines[boundedLine] ?? "";
  return index + clamp(column, 0, targetLine.length);
}

function insertCursor(value: string, index: number): string {
  const boundedIndex = clamp(index, 0, value.length);
  return `${value.slice(0, boundedIndex)}│${value.slice(boundedIndex)}`;
}

function wrapTextLine(line: string, width: number): string[] {
  if (line.length === 0) {
    return [""];
  }
  const chunks: string[] = [];
  for (let index = 0; index < line.length; index += width) {
    chunks.push(line.slice(index, index + width));
  }
  return chunks;
}

function buildTextInputBox(value: string, cursorIndex: number, requestedWidth?: number): string[] {
  const rendered = insertCursor(value, cursorIndex);
  const naturalWidth = rendered.split("\n").reduce((max, line) => Math.max(max, line.length), 0);
  const width = requestedWidth !== undefined
    ? Math.max(8, requestedWidth)
    : clamp(naturalWidth, 18, 52);
  const renderedLines = rendered
    .split("\n")
    .flatMap((line) => wrapTextLine(line, width));

  return [
    `┌${"─".repeat(width + 2)}┐`,
    ...renderedLines.map((line) => `│ ${line.padEnd(width, " ")} │`),
    `└${"─".repeat(width + 2)}┘`,
  ];
}

function normalizeLogText(text: string): string[] {
  const normalized = text
    .split("\n")
    .map((line) => line.replace(/\t/g, "  "))
    .join("\n")
    .trimEnd();
  if (!normalized) {
    return [""];
  }
  return normalized.split("\n");
}

export class InteractiveSessionController {
  private readonly listeners = new Set<(event: InteractiveSessionChangeEvent) => void>();
  private readonly flowMap: Map<string, InteractiveFlowDefinition>;
  private readonly flowTree: FlowTreeNode[];
  private readonly expandedFlowFolders = new Set<string>();
  private visibleFlowItems: VisibleFlowTreeItem[];
  private readonly state: InteractiveSessionState;
  private readonly logLines: string[] = [];
  private readonly pendingLogLines: string[] = [];
  private logText = "";
  private logFlushTimer: NodeJS.Timeout | null = null;
  private helpVisible = false;
  private confirmSession: ConfirmSession | null = null;
  private activeFormSession: ActiveFormSession | null = null;
  private spinnerTimer: NodeJS.Timeout | null = null;
  private mounted = false;

  constructor(private readonly options: InteractiveSessionOptions) {
    if (options.flows.length === 0) {
      throw new Error("Interactive UI requires at least one flow.");
    }

    this.state = createInitialInteractiveState(options);
    this.flowMap = new Map(options.flows.map((flow) => [flow.id, flow]));
    this.flowTree = buildFlowTree(options.flows);
    collectInitiallyExpandedFolderKeys(this.flowTree).forEach((key) => this.expandedFlowFolders.add(key));
    this.visibleFlowItems = computeVisibleFlowItems(this.flowTree, this.expandedFlowFolders);
  }

  subscribe(listener: (event: InteractiveSessionChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  mount(): void {
    if (this.mounted) {
      return;
    }
    this.mounted = true;
    setOutputAdapter(this.createAdapter());
    this.focusPane("flows");
    this.emitChange();
  }

  destroy(): void {
    if (this.logFlushTimer) {
      clearTimeout(this.logFlushTimer);
      this.logFlushTimer = null;
    }
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
    }
    if (this.activeFormSession) {
      this.activeFormSession.reject(new TaskRunnerError(`User cancelled form '${this.activeFormSession.form.formId}'.`));
      this.activeFormSession = null;
    }
    this.confirmSession = null;
    this.helpVisible = false;
    this.mounted = false;
    setOutputAdapter(null);
    this.emitChange();
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
      const values = buildInitialUserInputValues(form.fields);
      const firstField = form.fields[0];
      const initialCursorIndex = firstField?.type === "text" ? String(values[firstField.id] ?? "").length : 0;
      const initialOptionIndex =
        firstField?.type === "single-select"
          ? Math.max(0, firstField.options.findIndex((option) => option.value === String(values[firstField.id] ?? "")))
          : firstField?.type === "multi-select"
            ? Math.max(
              0,
              firstField.options.findIndex((option) =>
                Array.isArray(values[firstField.id]) && (values[firstField.id] as string[]).includes(option.value)
              ),
            )
            : 0;
      this.activeFormSession = {
        form,
        values,
        currentFieldIndex: 0,
        currentOptionIndex: initialOptionIndex,
        currentTextCursorIndex: initialCursorIndex,
        previewScrollOffset: 0,
        resolve,
        reject,
      };
      this.confirmSession = null;
      this.helpVisible = false;
      this.emitChange();
    });
  }

  setSummary(markdown: string): void {
    this.state.summaryText = markdown.trim();
    this.state.summaryVisible = this.state.summaryText.length > 0;
    if (!this.state.summaryVisible && this.state.focusedPane === "summary") {
      this.state.focusedPane = "log";
    }
    this.emitChange();
  }

  clearSummary(): void {
    this.state.summaryText = "";
    this.state.summaryVisible = false;
    if (this.state.focusedPane === "summary") {
      this.state.focusedPane = "log";
    }
    this.emitChange();
  }

  setScope(scopeKey: string, jiraIssueKey?: string | null): void {
    this.state.scopeKey = scopeKey;
    this.state.jiraIssueKey = jiraIssueKey ?? null;
    this.emitChange();
  }

  appendLog(text: string): void {
    const lines = normalizeLogText(text);
    this.logLines.push(...lines);
    this.pendingLogLines.push(...lines);
    this.logText = this.logText.length > 0 ? `${this.logText}\n${lines.join("\n")}` : lines.join("\n");
    this.state.logScrollOffset = Math.max(0, this.logLines.length - 1);
    this.scheduleLogFlush();
  }

  clearLog(): void {
    this.logLines.length = 0;
    this.pendingLogLines.length = 0;
    this.logText = "";
    if (this.logFlushTimer) {
      clearTimeout(this.logFlushTimer);
      this.logFlushTimer = null;
    }
    this.state.logScrollOffset = 0;
    this.emitChange({ type: "render", syncLog: true });
    this.appendLog("Log cleared.");
  }

  setFlowFailed(flowId: string): void {
    this.state.failedFlowId = flowId;
    this.emitChange();
  }

  interruptActiveForm(message = "Flow interrupted by user."): void {
    if (!this.activeFormSession) {
      return;
    }
    const session = this.activeFormSession;
    this.activeFormSession = null;
    session.reject(new FlowInterruptedError(message));
    this.focusPane("flows");
    this.emitChange();
  }

  async handleKeypress(ch: string, key: Keypress): Promise<void> {
    if (this.activeFormSession) {
      this.handleActiveFormKey(ch, key);
      return;
    }
    if (this.confirmSession) {
      await this.handleConfirmKey(key);
      return;
    }
    if (this.helpVisible) {
      this.handleHelpKey(key);
      return;
    }

    if (key.ctrl && key.name === "c") {
      this.openExitConfirm();
      return;
    }
    if (key.ctrl && key.name === "l") {
      this.clearLog();
      return;
    }
    if (key.name === "q") {
      this.openExitConfirm();
      return;
    }
    if (key.name === "f1" || key.name === "h" || key.name === "?") {
      this.helpVisible = true;
      this.emitChange();
      return;
    }
    if (key.name === "escape") {
      if (this.state.busy) {
        this.openInterruptConfirm();
      }
      return;
    }
    if (isReverseTabKey(key)) {
      this.cycleFocus(-1);
      return;
    }
    if (key.name === "tab") {
      this.cycleFocus(1);
      return;
    }

    if (this.state.focusedPane === "flows") {
      await this.handleFlowKey(key);
      return;
    }
    if (this.state.focusedPane === "progress") {
      this.handleScrollKey("progress", key);
      return;
    }
    if (this.state.focusedPane === "summary") {
      this.handleScrollKey("summary", key);
      return;
    }
    this.handleScrollKey("log", key);
  }

  selectFlowIndex(index: number): void {
    const selectedItem = this.visibleFlowItems[index];
    if (!selectedItem) {
      return;
    }
    this.state.selectedFlowItemKey = selectedItem.key;
    if (selectedItem.kind === "flow") {
      this.state.selectedFlowId = selectedItem.flow.id;
    }
    this.emitChange();
  }

  getViewModel(layout?: { formContentWidth?: number }): InteractiveSessionViewModel {
    const selectedItem = this.selectedFlowTreeItem();
    const activeFlowId = this.activeFlowId();
    const selectedFlow = selectedItem?.kind === "flow" ? selectedItem.flow : null;
    const progressFlow = this.state.busy ? this.flowMap.get(activeFlowId) ?? null : selectedFlow;
    const progressState =
      progressFlow && this.state.flowState.flowId === progressFlow.id
        ? this.state.flowState.executionState
        : progressFlow && this.state.currentFlowId === progressFlow.id
          ? this.state.flowState.executionState
          : null;
    const progressViewModel = buildProgressViewModel(progressFlow, progressState);
    const helpText = `${HELP_TEXT}\n\nAvailable flows:\n${this.options.flows.map((flow) => `- ${flow.treePath.join("/")}`).join("\n")}`;

    return {
      header: this.buildHeaderText(),
      title: `AgentWeaver ${this.state.scopeKey}`,
      footer: this.buildFooterText(),
      helpVisible: this.helpVisible,
      helpText,
      helpScrollOffset: this.state.helpScrollOffset,
      flowListTitle: this.panelTitle("Flows", "flows"),
      flowItems: this.visibleFlowItems.map((item) => ({
        key: item.key,
        label: this.renderFlowTreeLabel(item),
      })),
      selectedFlowIndex: Math.max(0, this.visibleFlowItems.findIndex((item) => item.key === this.state.selectedFlowItemKey)),
      progressTitle: this.panelTitle("Current Flow", "progress"),
      progressText: this.renderProgress(progressViewModel),
      progressScrollOffset: this.state.progressScrollOffset,
      descriptionText: this.renderDescription(selectedItem),
      statusText: this.renderStatusText(),
      summaryVisible: this.state.summaryVisible,
      summaryTitle: this.panelTitle("Task Summary", "summary"),
      summaryText: renderMarkdownToTerminal(stripAnsi(this.state.summaryText || "Task summary is not available yet.")),
      summaryScrollOffset: this.state.summaryScrollOffset,
      logTitle: this.panelTitle("Activity", "log"),
      logText: this.logText,
      logScrollOffset: this.state.logScrollOffset,
      confirmText: this.renderConfirmText(),
      form: this.renderFormView(layout),
    };
  }

  private emitChange(event: InteractiveSessionChangeEvent = { type: "render" }): void {
    for (const listener of this.listeners) {
      listener(event);
    }
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
      setExecutionState: (next) => {
        this.state.currentNode = next.node;
        this.state.currentExecutor = next.executor;
        this.ensureSpinnerState();
        this.emitChange();
      },
      setFlowState: (next) => {
        this.state.flowState = {
          flowId: next.flowId,
          executionState: next.executionState,
        };
        if (next.flowId) {
          this.state.currentFlowId = next.flowId;
        }
        this.ensureSpinnerState();
        this.emitChange();
      },
    };
  }

  private buildHeaderText(): string {
    const current = this.state.currentFlowId ?? selectHeaderLabel(this.selectedFlowTreeItem(), this.state.selectedFlowId);
    const pathParts = this.options.cwd.split(path.sep).filter(Boolean);
    const folderName = pathParts.slice(-3).join("/") || this.options.cwd;
    const branchLabel = this.options.gitBranchName ? this.options.gitBranchName : "detached-head";
    const runningSuffix = this.state.busy ? " [running]" : "";
    const versionLabel = this.state.version ? ` | Version ${this.state.version}` : "";
    const jiraLabel = this.state.jiraIssueKey ? ` | Jira ${this.state.jiraIssueKey}` : "";
    return `AgentWeaver | Scope ${this.state.scopeKey}${versionLabel}${jiraLabel} | Flow ${current}${runningSuffix} | Location ${folderName} • ${branchLabel}`;
  }

  private buildFooterText(): string {
    if (this.activeFormSession) {
      const formView = this.renderFormView();
      return formView?.footer ?? "Form active";
    }
    if (this.confirmSession) {
      return "Confirm: Left/Right or Tab choose | Enter confirm | Esc cancel";
    }
    if (this.helpVisible) {
      return "Help: Esc close | Up/Down/PageUp/PageDown scroll";
    }
    return `Focus: ${this.state.focusedPane} | Up/Down select or scroll | Left/Right fold | Enter run | h help | Esc interrupt | Tab switch | q exit`;
  }

  private panelTitle(title: string, pane: FocusPane): string {
    return this.state.focusedPane === pane ? `▶ ${title}` : title;
  }

  private renderFlowTreeLabel(item: VisibleFlowTreeItem): string {
    const indent = "  ".repeat(item.depth);
    if (item.kind === "folder") {
      const expanded = this.expandedFlowFolders.has(item.key);
      return `${indent}${expanded ? "▾" : "▸"} ${item.name}`;
    }
    return `${indent}• ${item.name}`;
  }

  private renderDescription(selectedItem: VisibleFlowTreeItem | undefined): string {
    if (!selectedItem) {
      return "Flow structure is not available.";
    }
    if (selectedItem.kind === "folder") {
      const kindLabel = selectedItem.pathSegments[0] === "custom" ? "project-local" : "built-in";
      return [
        `Flow folder '${selectedItem.pathSegments.join("/")}'.`,
        "",
        `Source: ${kindLabel}`,
        `State: ${this.expandedFlowFolders.has(selectedItem.key) ? "expanded" : "collapsed"}`,
      ].join("\n");
    }

    const { flow } = selectedItem;
    const description = flow.description?.trim() || "No description available for this flow.";
    const details = [
      `Path: ${flow.treePath.join("/")}`,
      `Source: ${flow.source === "project-local" ? "project-local" : "built-in"}`,
      flow.source === "project-local" && flow.sourcePath ? `File: ${flow.sourcePath}` : "",
    ]
      .filter((line) => line.length > 0)
      .join("\n");
    return renderMarkdownToTerminal(stripAnsi(details ? `${description}\n\n${details}` : description));
  }

  private renderProgress(progressViewModel: ReturnType<typeof buildProgressViewModel>): string {
    if (!progressViewModel.flow) {
      return "Select a flow in the tree to see its progress.";
    }
    const lines: string[] = [progressViewModel.flow.label, ""];
    for (const item of progressViewModel.items) {
      if (item.kind === "termination") {
        const symbol = item.status === "done" ? "✓" : "■";
        lines.push(`${symbol} ${item.label}`);
        lines.push(item.detail);
        continue;
      }
      const indent = "  ".repeat(item.depth);
      lines.push(`${indent}${this.symbolForStatus(progressViewModel.flow.id, item.status)} ${item.label}`);
    }
    return lines.join("\n").trimEnd();
  }

  private renderStatusText(): string {
    const running = this.state.busy || this.state.currentNode !== null || this.state.currentExecutor !== null;
    const spinner = running ? SPINNER_FRAMES[this.state.spinnerFrame] ?? "•" : "•";
    const stateText = running ? `${spinner} running` : "idle";
    return [
      `State: ${stateText}`,
      `Time: ${this.formatElapsed(running ? Date.now() : null)}`,
      `Node: ${this.state.currentNode ?? "-"}`,
      `Executor: ${this.state.currentExecutor ?? "-"}`,
    ].join("\n");
  }

  private renderConfirmText(): string | null {
    const session = this.confirmSession;
    if (!session) {
      return null;
    }
    const flow = session.flowId ? this.flowMap.get(session.flowId) : null;
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
    const lines = [session.kind === "interrupt"
      ? `Interrupt flow "${flow?.label ?? session.flowId ?? "-"}"?`
      : session.kind === "exit"
        ? "Exit AgentWeaver?"
        : `Run flow "${flow?.label ?? session.flowId ?? "-"}"?`];
    if (session.details?.trim()) {
      lines.push("", session.details.trim());
    }
    lines.push("", actionLabels, "", "Left/Right or Tab: choose    Enter: confirm    Esc: cancel");
    return lines.join("\n");
  }

  private renderFormView(layout?: { formContentWidth?: number }): InteractiveFormViewModel | null {
    const session = this.activeFormSession;
    const field = this.currentFormField();
    if (!session || !field) {
      return null;
    }
    const isLastField = session.currentFieldIndex >= session.form.fields.length - 1;
    const lines: string[] = [session.form.title];
    if (session.form.description?.trim()) {
      lines.push("", session.form.description.trim());
    }
    lines.push("", `Field ${session.currentFieldIndex + 1}/${session.form.fields.length}`, field.label);
    if (field.help?.trim()) {
      lines.push(field.help.trim());
    }

    let footer = `Form: Enter ${isLastField ? "submit" : "next"} | Tab switch | Esc cancel`;

    if (field.type === "boolean") {
      lines.push("", `${session.values[field.id] === true ? "[x]" : "[ ]"} ${field.label}`);
      footer = `Form: Space toggle | Enter ${isLastField ? "submit" : "next"} | Tab switch | Esc cancel`;
    } else if (field.type === "text") {
      const current = String(session.values[field.id] ?? "");
      lines.push("", "Text input:");
      lines.push(...buildTextInputBox(current, session.currentTextCursorIndex, layout?.formContentWidth));
      if (!current && field.placeholder?.trim()) {
        lines.push(`Hint: ${field.placeholder.trim()}`);
      }
      footer = field.multiline
        ? "Form: Enter newline | Tab switch | Ctrl+S submit | Esc cancel"
        : `Form: Type text | Enter ${isLastField ? "submit" : "next"} | Tab switch | Esc cancel`;
    } else {
      const preview = session.form.preview?.trim() ?? "";
      if (preview) {
        const previewLines = preview.split("\n");
        const previewHeight = 10;
        const maxOffset = Math.max(0, previewLines.length - previewHeight);
        session.previewScrollOffset = clamp(session.previewScrollOffset, 0, maxOffset);
        const visibleLines = previewLines.slice(session.previewScrollOffset, session.previewScrollOffset + previewHeight);
        lines.push("", "Preview:", ...visibleLines);
        if (maxOffset > 0) {
          lines.push(`Preview ${session.previewScrollOffset + 1}-${session.previewScrollOffset + visibleLines.length} of ${previewLines.length}`);
        }
      }
      lines.push("", "Options:");
      const selectedValues = field.type === "single-select"
        ? [String(session.values[field.id] ?? "")]
        : Array.isArray(session.values[field.id]) ? (session.values[field.id] as string[]) : [];
      field.options.forEach((option, index) => {
        const pointer = index === session.currentOptionIndex ? ">" : " ";
        const marker = selectedValues.includes(option.value) ? "[x]" : "[ ]";
        lines.push(`${pointer} ${marker} ${option.label}`);
      });
      footer = preview
        ? `Form: Up/Down move | PageUp/PageDown preview | Enter ${isLastField ? "submit" : "next"} | Tab switch | Esc cancel`
        : `Form: Up/Down move | Enter ${isLastField ? "submit" : "next"} | Tab switch | Esc cancel`;
    }

    return {
      title: "User Input",
      content: lines.join("\n"),
      footer,
    };
  }

  private currentFormField(): UserInputFieldDefinition | null {
    if (!this.activeFormSession) {
      return null;
    }
    const field = this.activeFormSession.form.fields[this.activeFormSession.currentFieldIndex] ?? null;
    if (!field) {
      return null;
    }
    normalizeUserInputFieldValue(field, this.activeFormSession.values);
    return resolveFieldDefinition(field, this.activeFormSession.values);
  }

  private handleHelpKey(key: Keypress): void {
    if (key.name === "escape" || key.name === "f1" || key.name === "h" || key.name === "?") {
      this.helpVisible = false;
      this.emitChange();
      return;
    }
    this.handleScrollKey("help", key);
  }

  private async handleConfirmKey(key: Keypress): Promise<void> {
    if (key.name === "escape") {
      this.confirmSession = null;
      this.emitChange();
      return;
    }
    if (key.name === "left" || isReverseTabKey(key)) {
      this.moveConfirmSelection(-1);
      return;
    }
    if (key.name === "right" || key.name === "tab") {
      this.moveConfirmSelection(1);
      return;
    }
    if (key.name === "enter") {
      await this.acceptConfirm();
    }
  }

  private async handleFlowKey(key: Keypress): Promise<void> {
    if (key.name === "up") {
      this.moveSelectedFlow(-1);
      return;
    }
    if (key.name === "down") {
      this.moveSelectedFlow(1);
      return;
    }
    if (key.name === "home") {
      this.selectFlowIndex(0);
      return;
    }
    if (key.name === "end") {
      this.selectFlowIndex(Math.max(0, this.visibleFlowItems.length - 1));
      return;
    }
    if (key.name === "pageup") {
      this.moveSelectedFlow(-10);
      return;
    }
    if (key.name === "pagedown") {
      this.moveSelectedFlow(10);
      return;
    }
    if (key.name === "right") {
      this.expandSelectedFlowFolder();
      return;
    }
    if (key.name === "left") {
      this.collapseSelectedFlowFolderOrSelectParent();
      return;
    }
    if (key.name === "enter") {
      if (this.state.busy) {
        return;
      }
      const selectedItem = this.selectedFlowTreeItem();
      if (selectedItem?.kind === "folder") {
        this.toggleFlowFolder(selectedItem.key);
        return;
      }
      await this.openConfirm();
    }
  }

  private handleScrollKey(panel: "progress" | "summary" | "log" | "help", key: Keypress): void {
    const maxOffset = this.panelMaxScroll(panel);
    const current = this.scrollOffsetFor(panel);
    if (key.name === "up") {
      this.setScrollOffset(panel, current - 1, maxOffset);
      return;
    }
    if (key.name === "down") {
      this.setScrollOffset(panel, current + 1, maxOffset);
      return;
    }
    if (key.name === "pageup") {
      this.setScrollOffset(panel, current - 10, maxOffset);
      return;
    }
    if (key.name === "pagedown") {
      this.setScrollOffset(panel, current + 10, maxOffset);
      return;
    }
    if (key.name === "home") {
      this.setScrollOffset(panel, 0, maxOffset);
      return;
    }
    if (key.name === "end") {
      this.setScrollOffset(panel, maxOffset, maxOffset);
    }
  }

  private moveSelectedFlow(delta: number): void {
    const currentIndex = Math.max(0, this.visibleFlowItems.findIndex((item) => item.key === this.state.selectedFlowItemKey));
    this.selectFlowIndex(clamp(currentIndex + delta, 0, Math.max(0, this.visibleFlowItems.length - 1)));
  }

  private focusPane(pane: FocusPane): void {
    this.state.focusedPane = pane;
  }

  private cycleFocus(direction: 1 | -1): void {
    const panes: FocusPane[] = this.state.summaryVisible ? ["flows", "progress", "summary", "log"] : ["flows", "progress", "log"];
    const currentIndex = panes.indexOf(this.state.focusedPane);
    const nextIndex = (currentIndex + direction + panes.length) % panes.length;
    this.focusPane(panes[nextIndex] ?? "flows");
    this.emitChange();
  }

  private toggleFlowFolder(folderKey: string): void {
    if (this.expandedFlowFolders.has(folderKey)) {
      this.expandedFlowFolders.delete(folderKey);
    } else {
      this.expandedFlowFolders.add(folderKey);
    }
    this.refreshVisibleFlowItems();
    this.emitChange();
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
    this.state.selectedFlowItemKey = parentKey;
    this.refreshVisibleFlowItems();
    this.emitChange();
  }

  private refreshVisibleFlowItems(): void {
    this.visibleFlowItems = computeVisibleFlowItems(this.flowTree, this.expandedFlowFolders);
    if (!this.visibleFlowItems.some((item) => item.key === this.state.selectedFlowItemKey)) {
      this.state.selectedFlowItemKey = this.visibleFlowItems[0]?.key ?? makeFlowKey(this.state.selectedFlowId);
    }
    const selectedItem = this.selectedFlowTreeItem();
    if (selectedItem?.kind === "flow") {
      this.state.selectedFlowId = selectedItem.flow.id;
    }
  }

  private selectedFlowTreeItem(): VisibleFlowTreeItem | undefined {
    return this.visibleFlowItems.find((item) => item.key === this.state.selectedFlowItemKey);
  }

  private async openConfirm(): Promise<void> {
    if (this.state.busy || this.confirmSession) {
      return;
    }
    const selectedItem = this.selectedFlowTreeItem();
    if (!selectedItem || selectedItem.kind !== "flow") {
      return;
    }
    const confirmation = await this.options.getRunConfirmation(selectedItem.flow.id);
    if (this.state.busy || this.confirmSession) {
      return;
    }
    this.confirmSession = {
      kind: "run",
      flowId: selectedItem.flow.id,
      resumeAvailable: confirmation.resumeAvailable,
      hasExistingState: confirmation.hasExistingState,
      details: confirmation.details ?? null,
      selectedAction: confirmation.resumeAvailable ? "resume" : confirmation.hasExistingState ? "restart" : "ok",
    };
    this.emitChange();
  }

  private openInterruptConfirm(): void {
    const flowId = this.state.currentFlowId;
    if (!flowId || this.confirmSession) {
      return;
    }
    this.confirmSession = {
      kind: "interrupt",
      flowId,
      resumeAvailable: true,
      hasExistingState: true,
      details: "The current flow will be stopped. State will be saved and can be continued via Resume.",
      selectedAction: "stop",
    };
    this.emitChange();
  }

  private openExitConfirm(): void {
    if (this.confirmSession) {
      return;
    }
    const details = this.state.busy
      ? "A flow is currently running. Exiting will close the interactive UI."
      : "The interactive session will be closed.";
    this.confirmSession = {
      kind: "exit",
      flowId: null,
      resumeAvailable: false,
      hasExistingState: false,
      details,
      selectedAction: "ok",
    };
    this.emitChange();
  }

  private confirmActions(): string[] {
    if (!this.confirmSession) {
      return ["cancel"];
    }
    if (this.confirmSession.kind === "interrupt") {
      return ["stop", "cancel"];
    }
    if (this.confirmSession.kind === "exit") {
      return ["ok", "cancel"];
    }
    return this.confirmSession.resumeAvailable
      ? ["resume", "restart", "cancel"]
      : this.confirmSession.hasExistingState
        ? ["restart", "cancel"]
        : ["ok", "cancel"];
  }

  private moveConfirmSelection(delta: 1 | -1): void {
    if (!this.confirmSession) {
      return;
    }
    const actions = this.confirmActions();
    const currentIndex = actions.indexOf(this.confirmSession.selectedAction);
    const nextIndex = (currentIndex + delta + actions.length) % actions.length;
    this.confirmSession.selectedAction = (actions[nextIndex] ?? "cancel") as ConfirmSession["selectedAction"];
    this.emitChange();
  }

  private async acceptConfirm(): Promise<void> {
    const session = this.confirmSession;
    if (!session) {
      return;
    }
    if (session.selectedAction === "cancel") {
      this.confirmSession = null;
      this.emitChange();
      return;
    }
    if (session.kind === "interrupt") {
      const flowId = session.flowId;
      this.confirmSession = null;
      this.emitChange();
      if (flowId) {
        await this.options.onInterrupt(flowId);
      }
      return;
    }
    if (session.kind === "exit") {
      this.confirmSession = null;
      this.emitChange();
      this.options.onExit();
      return;
    }

    const flowId = session.flowId ?? this.state.selectedFlowId;
    const launchMode = session.selectedAction === "resume" ? "resume" : "restart";
    this.confirmSession = null;
    this.setBusy(true, flowId);
    this.clearFlowFailure(flowId);
    this.state.flowState = {
      flowId,
      executionState: null,
    };
    this.emitChange();
    try {
      await this.options.onRun(flowId, launchMode);
    } finally {
      this.setBusy(false);
      this.focusPane("flows");
      this.emitChange();
    }
  }

  private clearFlowFailure(flowId: string): void {
    if (this.state.failedFlowId === flowId) {
      this.state.failedFlowId = null;
    }
  }

  private setBusy(busy: boolean, flowId?: string): void {
    this.state.busy = busy;
    if (flowId !== undefined) {
      this.state.currentFlowId = flowId;
    }
    if (busy && this.state.runningStartedAt === null) {
      this.state.runningStartedAt = Date.now();
    }
    if (!busy && this.state.currentNode === null && this.state.currentExecutor === null) {
      this.state.runningStartedAt = null;
    }
    this.ensureSpinnerState();
  }

  private ensureSpinnerState(): void {
    const running = this.state.busy || this.state.currentNode !== null || this.state.currentExecutor !== null;
    if (running && this.spinnerTimer === null) {
      if (this.state.runningStartedAt === null) {
        this.state.runningStartedAt = Date.now();
      }
      this.spinnerTimer = setInterval(() => {
        this.state.spinnerFrame = (this.state.spinnerFrame + 1) % SPINNER_FRAMES.length;
        this.emitChange();
      }, SPINNER_INTERVAL_MS);
      return;
    }
    if (!running && this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
      this.state.spinnerFrame = 0;
      this.state.runningStartedAt = null;
    }
  }

  private activeFlowId(): string {
    return this.state.currentFlowId ?? this.state.selectedFlowId;
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
      if (this.state.failedFlowId === flowId && !this.state.busy) {
        return "×";
      }
      return SPINNER_FRAMES[this.state.spinnerFrame] ?? "▶";
    }
    return "○";
  }

  private formatElapsed(now: number | null): string {
    if (this.state.runningStartedAt === null || now === null) {
      return "00:00:00";
    }
    const totalSeconds = Math.max(0, Math.floor((now - this.state.runningStartedAt) / 1000));
    const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const minutes = String((totalSeconds % 3600) / 60 | 0).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
  }

  private scrollOffsetFor(panel: "progress" | "summary" | "log" | "help"): number {
    if (panel === "progress") {
      return this.state.progressScrollOffset;
    }
    if (panel === "summary") {
      return this.state.summaryScrollOffset;
    }
    if (panel === "help") {
      return this.state.helpScrollOffset;
    }
    return this.state.logScrollOffset;
  }

  private setScrollOffset(panel: "progress" | "summary" | "log" | "help", value: number, maxOffset: number): void {
    const next = clamp(value, 0, maxOffset);
    if (panel === "progress") {
      this.state.progressScrollOffset = next;
    } else if (panel === "summary") {
      this.state.summaryScrollOffset = next;
    } else if (panel === "help") {
      this.state.helpScrollOffset = next;
    } else {
      this.state.logScrollOffset = next;
    }
    this.emitChange();
  }

  private panelMaxScroll(panel: "progress" | "summary" | "log" | "help"): number {
    const content = panel === "progress"
      ? this.getViewModel().progressText
      : panel === "summary"
        ? this.getViewModel().summaryText
        : panel === "help"
          ? this.getViewModel().helpText
          : this.getViewModel().logText;
    return Math.max(0, content.split("\n").length - 1);
  }

  private moveActiveFormField(delta: 1 | -1): void {
    const session = this.activeFormSession;
    if (!session) {
      return;
    }
    this.syncActiveSelectFieldValue();
    const nextIndex = clamp(session.currentFieldIndex + delta, 0, Math.max(0, session.form.fields.length - 1));
    session.currentFieldIndex = nextIndex;
    const nextField = session.form.fields[nextIndex];
    if (nextField?.type === "text") {
      const current = String(session.values[nextField.id] ?? "");
      session.currentTextCursorIndex = current.length;
      session.currentOptionIndex = 0;
    } else if (nextField?.type === "single-select" || nextField?.type === "multi-select") {
      session.currentTextCursorIndex = 0;
      session.currentOptionIndex = this.selectedOptionIndexForField(nextField);
    } else {
      session.currentTextCursorIndex = 0;
      session.currentOptionIndex = 0;
    }
    session.previewScrollOffset = 0;
    this.emitChange();
  }

  private selectedOptionIndexForField(
    field: UserInputFieldDefinition & { type: "single-select" | "multi-select" },
  ): number {
    const session = this.activeFormSession;
    if (!session || field.options.length === 0) {
      return 0;
    }
    if (field.type === "single-select") {
      const selectedValue = String(session.values[field.id] ?? "");
      const selectedIndex = field.options.findIndex((option) => option.value === selectedValue);
      return selectedIndex >= 0 ? selectedIndex : 0;
    }
    const selectedValues = Array.isArray(session.values[field.id]) ? (session.values[field.id] as string[]) : [];
    const selectedIndex = field.options.findIndex((option) => selectedValues.includes(option.value));
    return selectedIndex >= 0 ? selectedIndex : 0;
  }

  private syncActiveSelectFieldValue(): void {
    const session = this.activeFormSession;
    const field = this.currentFormField();
    if (!session || !field || (field.type !== "single-select" && field.type !== "multi-select")) {
      return;
    }
    session.currentOptionIndex = clamp(session.currentOptionIndex, 0, Math.max(0, field.options.length - 1));
  }

  private toggleActiveFormValue(): void {
    const session = this.activeFormSession;
    const field = this.currentFormField();
    if (!session || !field) {
      return;
    }
    if (field.type === "boolean") {
      session.values[field.id] = session.values[field.id] !== true;
      this.emitChange();
      return;
    }
    if (field.type !== "single-select" && field.type !== "multi-select") {
      return;
    }
    this.syncActiveSelectFieldValue();
    const option = field.options[session.currentOptionIndex];
    if (!option) {
      return;
    }
    if (field.type === "single-select") {
      session.values[field.id] = option.value;
      this.emitChange();
      return;
    }
    const current = Array.isArray(session.values[field.id]) ? [...(session.values[field.id] as string[])] : [];
    session.values[field.id] = current.includes(option.value)
      ? current.filter((item) => item !== option.value)
      : [...current, option.value];
    this.emitChange();
  }

  private confirmActiveFormField(): void {
    const session = this.activeFormSession;
    if (!session) {
      return;
    }
    this.syncActiveSelectFieldValue();
    if (session.currentFieldIndex >= session.form.fields.length - 1) {
      this.submitActiveForm();
      return;
    }
    this.moveActiveFormField(1);
  }

  private submitActiveForm(): void {
    const session = this.activeFormSession;
    if (!session) {
      return;
    }
    this.syncActiveSelectFieldValue();
    try {
      validateUserInputValues(session.form, session.values);
      const result: UserInputResult = {
        formId: session.form.formId,
        submittedAt: new Date().toISOString(),
        values: session.values,
      };
      this.activeFormSession = null;
      this.focusPane("flows");
      session.resolve(result);
      this.emitChange();
    } catch (error) {
      this.appendLog((error as Error).message);
    }
  }

  private cancelActiveForm(): void {
    const session = this.activeFormSession;
    if (!session) {
      return;
    }
    this.activeFormSession = null;
    this.focusPane("flows");
    session.reject(new TaskRunnerError(`User cancelled form '${session.form.formId}'.`));
    this.emitChange();
  }

  private handleActiveFormKey(ch: string, key: Keypress): void {
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
    if (isReverseTabKey(key)) {
      this.moveActiveFormField(-1);
      return;
    }
    if (key.name === "tab") {
      this.moveActiveFormField(1);
      return;
    }

    if (field.type === "text") {
      this.handleTextFormKey(field, ch, key);
      return;
    }
    if (field.type === "boolean") {
      if (key.name === "space" || key.name === "left" || key.name === "right") {
        this.toggleActiveFormValue();
        return;
      }
      if (key.name === "enter") {
        this.confirmActiveFormField();
      }
      return;
    }
    this.handleSelectFormKey(key);
  }

  private handleTextFormKey(field: Extract<UserInputFieldDefinition, { type: "text" }>, ch: string, key: Keypress): void {
    const session = this.activeFormSession;
    if (!session) {
      return;
    }
    const current = String(session.values[field.id] ?? "");

    if (!field.multiline) {
      if (key.name === "enter") {
        this.confirmActiveFormField();
        return;
      }
      if (key.name === "left") {
        session.currentTextCursorIndex = Math.max(0, session.currentTextCursorIndex - 1);
        this.emitChange();
        return;
      }
      if (key.name === "right") {
        session.currentTextCursorIndex = Math.min(current.length, session.currentTextCursorIndex + 1);
        this.emitChange();
        return;
      }
      if (key.name === "home") {
        session.currentTextCursorIndex = 0;
        this.emitChange();
        return;
      }
      if (key.name === "end") {
        session.currentTextCursorIndex = current.length;
        this.emitChange();
        return;
      }
      if (key.name === "backspace" && session.currentTextCursorIndex > 0) {
        session.values[field.id] = `${current.slice(0, session.currentTextCursorIndex - 1)}${current.slice(session.currentTextCursorIndex)}`;
        session.currentTextCursorIndex -= 1;
        this.emitChange();
        return;
      }
      if (key.name === "delete" && session.currentTextCursorIndex < current.length) {
        session.values[field.id] = `${current.slice(0, session.currentTextCursorIndex)}${current.slice(session.currentTextCursorIndex + 1)}`;
        this.emitChange();
        return;
      }
      if (isPrintableCharacter(ch, key)) {
        session.values[field.id] = `${current.slice(0, session.currentTextCursorIndex)}${ch}${current.slice(session.currentTextCursorIndex)}`;
        session.currentTextCursorIndex += ch.length;
        this.emitChange();
      }
      return;
    }

    if (key.name === "enter") {
      session.values[field.id] = `${current.slice(0, session.currentTextCursorIndex)}\n${current.slice(session.currentTextCursorIndex)}`;
      session.currentTextCursorIndex += 1;
      this.emitChange();
      return;
    }
    if (key.name === "left") {
      session.currentTextCursorIndex = Math.max(0, session.currentTextCursorIndex - 1);
      this.emitChange();
      return;
    }
    if (key.name === "right") {
      session.currentTextCursorIndex = Math.min(current.length, session.currentTextCursorIndex + 1);
      this.emitChange();
      return;
    }
    if (key.name === "home") {
      const { line } = textIndexToLineColumn(current, session.currentTextCursorIndex);
      session.currentTextCursorIndex = textLineColumnToIndex(current, line, 0);
      this.emitChange();
      return;
    }
    if (key.name === "end") {
      const { line } = textIndexToLineColumn(current, session.currentTextCursorIndex);
      const lineText = current.split("\n")[line] ?? "";
      session.currentTextCursorIndex = textLineColumnToIndex(current, line, lineText.length);
      this.emitChange();
      return;
    }
    if (key.name === "up") {
      const { line, column } = textIndexToLineColumn(current, session.currentTextCursorIndex);
      session.currentTextCursorIndex = textLineColumnToIndex(current, Math.max(0, line - 1), column);
      this.emitChange();
      return;
    }
    if (key.name === "down") {
      const { line, column } = textIndexToLineColumn(current, session.currentTextCursorIndex);
      session.currentTextCursorIndex = textLineColumnToIndex(current, line + 1, column);
      this.emitChange();
      return;
    }
    if (key.name === "backspace" && session.currentTextCursorIndex > 0) {
      session.values[field.id] = `${current.slice(0, session.currentTextCursorIndex - 1)}${current.slice(session.currentTextCursorIndex)}`;
      session.currentTextCursorIndex -= 1;
      this.emitChange();
      return;
    }
    if (key.name === "delete" && session.currentTextCursorIndex < current.length) {
      session.values[field.id] = `${current.slice(0, session.currentTextCursorIndex)}${current.slice(session.currentTextCursorIndex + 1)}`;
      this.emitChange();
      return;
    }
    if (isPrintableCharacter(ch, key)) {
      session.values[field.id] = `${current.slice(0, session.currentTextCursorIndex)}${ch}${current.slice(session.currentTextCursorIndex)}`;
      session.currentTextCursorIndex += ch.length;
      this.emitChange();
    }
  }

  private handleSelectFormKey(key: Keypress): void {
    const session = this.activeFormSession;
    const field = this.currentFormField();
    if (!session || !field || (field.type !== "single-select" && field.type !== "multi-select")) {
      return;
    }
    if (key.name === "up") {
      session.currentOptionIndex = clamp(session.currentOptionIndex - 1, 0, Math.max(0, field.options.length - 1));
      this.emitChange();
      return;
    }
    if (key.name === "down") {
      session.currentOptionIndex = clamp(session.currentOptionIndex + 1, 0, Math.max(0, field.options.length - 1));
      this.emitChange();
      return;
    }
    if (key.name === "pageup" || key.name === "pagedown") {
      const previewLines = (session.form.preview?.trim() ?? "").split("\n").filter((line) => line.length > 0);
      if (previewLines.length > 10) {
        session.previewScrollOffset = clamp(
          session.previewScrollOffset + (key.name === "pageup" ? -10 : 10),
          0,
          Math.max(0, previewLines.length - 10),
        );
        this.emitChange();
      }
      return;
    }
    if (key.name === "space") {
      this.toggleActiveFormValue();
      return;
    }
    if (key.name === "enter") {
      if (field.type === "single-select" && field.options[session.currentOptionIndex]) {
        session.values[field.id] = field.options[session.currentOptionIndex]?.value ?? "";
      }
      this.confirmActiveFormField();
    }
  }

  private scheduleLogFlush(): void {
    if (this.logFlushTimer) {
      return;
    }
    this.logFlushTimer = setTimeout(() => {
      this.logFlushTimer = null;
      this.flushPendingLogLines();
    }, LOG_FLUSH_INTERVAL_MS);
  }

  private flushPendingLogLines(): void {
    if (this.pendingLogLines.length === 0) {
      return;
    }
    const appendedLines = this.pendingLogLines.splice(0, this.pendingLogLines.length);
    this.emitChange({
      type: "log",
      appendedLines,
    });
  }
}
