import blessed from "neo-blessed";

import { renderMarkdownToTerminal } from "./markdown.js";
import { setOutputAdapter, stripAnsi, type OutputAdapter } from "./tui.js";

type InteractiveUiOptions = {
  issueKey: string;
  summaryText: string;
  cwd: string;
  commands: string[];
  onSubmit: (line: string) => Promise<void>;
  onExit: () => void;
};

export class InteractiveUi {
  private readonly screen: any;
  private readonly header: any;
  private readonly summary: any;
  private readonly status: any;
  private readonly sidebar: any;
  private readonly log: any;
  private readonly input: any;
  private readonly footer: any;
  private readonly help: any;
  private readonly history: string[];
  private historyIndex: number;
  private busy = false;
  private currentCommand = "idle";
  private summaryText = "";
  private focusedPane: "input" | "log" | "summary" | "sidebar" = "input";
  private currentNode: string | null = null;
  private currentExecutor: string | null = null;
  private spinnerFrame = 0;
  private spinnerTimer: NodeJS.Timeout | null = null;
  private runningStartedAt: number | null = null;

  constructor(private readonly options: InteractiveUiOptions, history: string[]) {
    this.history = history;
    this.historyIndex = history.length;

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

    this.sidebar = blessed.box({
      parent: this.screen,
      top: 3,
      left: 0,
      width: "28%",
      bottom: 10,
      tags: true,
      label: " Commands ",
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
        border: { fg: "cyan" },
        fg: "white",
      },
    });

    this.summary = blessed.box({
      parent: this.screen,
      top: 3,
      left: "28%",
      width: "72%",
      height: 8,
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

    this.status = blessed.box({
      parent: this.screen,
      bottom: 4,
      left: 0,
      width: "28%",
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

    this.log = blessed.log({
      parent: this.screen,
      top: 11,
      bottom: 4,
      left: "28%",
      width: "72%",
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

    this.input = blessed.textbox({
      parent: this.screen,
      bottom: 1,
      left: 0,
      width: "100%",
      height: 3,
      keys: true,
      inputOnFocus: true,
      mouse: true,
      label: " command ",
      padding: {
        left: 1,
      },
      border: "line",
      style: {
        border: { fg: "magenta" },
        fg: "white",
        focus: {
          border: { fg: "magenta" },
        },
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
      width: "70%",
      height: "65%",
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

    this.screen.key(["f1", "?"], () => {
      this.help.hidden = !this.help.hidden;
      if (!this.help.hidden) {
        this.help.focus();
      } else {
        this.input.focus();
      }
      this.screen.render();
    });

    this.screen.key(["escape"], () => {
      this.help.hide();
      this.focusPane("input");
      this.screen.render();
    });

    this.screen.key(["C-l"], () => {
      this.log.setContent("");
      this.appendLog("Log cleared.");
    });

    this.screen.key(["S-tab"], () => {
      this.cycleFocus(-1);
    });

    this.screen.key(["tab"], () => {
      if (this.focusedPane !== "input") {
        this.cycleFocus(1);
      }
    });

    this.screen.key(["C-j"], () => {
      this.focusPane("log");
    });

    this.screen.key(["C-k"], () => {
      this.focusPane("input");
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

    this.sidebar.key(["pageup"], () => {
      this.sidebar.scroll(-(this.sidebar.height - 2));
      this.screen.render();
    });

    this.sidebar.key(["pagedown"], () => {
      this.sidebar.scroll(this.sidebar.height - 2);
      this.screen.render();
    });

    this.input.key(["up"], () => {
      if (this.history.length === 0) {
        return;
      }
      this.historyIndex = Math.max(0, this.historyIndex - 1);
      this.input.setValue(this.history[this.historyIndex] ?? "");
      this.screen.render();
    });

    this.input.key(["down"], () => {
      if (this.history.length === 0) {
        return;
      }
      this.historyIndex = Math.min(this.history.length, this.historyIndex + 1);
      this.input.setValue(this.history[this.historyIndex] ?? "");
      this.screen.render();
    });

    this.input.key(["tab"], () => {
      const current = String(this.input.getValue() ?? "");
      const hit = this.options.commands.find((item) => item.startsWith(current.trim()));
      if (hit) {
        this.input.setValue(hit);
        this.screen.render();
      }
    });

    this.input.key(["C-j"], () => {
      this.focusPane("log");
    });

    this.input.key(["C-u"], () => {
      this.focusPane("summary");
    });

    this.input.key(["C-h"], () => {
      this.focusPane("sidebar");
    });

    this.input.key(["S-tab"], () => {
      this.cycleFocus(-1);
    });

    this.log.key(["tab"], () => {
      this.cycleFocus(1);
    });

    this.log.key(["S-tab"], () => {
      this.cycleFocus(-1);
    });

    this.summary.key(["tab"], () => {
      this.cycleFocus(1);
    });

    this.summary.key(["S-tab"], () => {
      this.cycleFocus(-1);
    });

    this.sidebar.key(["tab"], () => {
      this.cycleFocus(1);
    });

    this.sidebar.key(["S-tab"], () => {
      this.cycleFocus(-1);
    });

    this.input.on("submit", async (value: string) => {
      const line = value.trim();
      this.input.clearValue();
      this.screen.render();
      if (!line || this.busy) {
        return;
      }
      this.history.push(line);
      this.historyIndex = this.history.length;
      this.appendLog(`> ${line}`);
      await this.options.onSubmit(line);
      this.focusPane("input");
    });
  }

  private cycleFocus(direction: 1 | -1): void {
    const panes: Array<"input" | "log" | "summary" | "sidebar"> = ["input", "log", "summary", "sidebar"];
    const currentIndex = panes.indexOf(this.focusedPane);
    const nextIndex = (currentIndex + direction + panes.length) % panes.length;
    this.focusPane(panes[nextIndex] ?? "input");
  }

  private focusPane(pane: "input" | "log" | "summary" | "sidebar"): void {
    this.focusedPane = pane;
    this.header.style.border.fg = "green";
    this.log.style.border.fg = pane === "log" ? "brightYellow" : "yellow";
    this.summary.style.border.fg = pane === "summary" ? "brightGreen" : "green";
    this.sidebar.style.border.fg = pane === "sidebar" ? "brightCyan" : "cyan";
    this.input.style.border.fg = pane === "input" ? "brightMagenta" : "magenta";

    if (pane === "input") {
      this.input.focus();
    } else if (pane === "log") {
      this.log.focus();
    } else if (pane === "summary") {
      this.summary.focus();
    } else {
      this.sidebar.focus();
    }

    this.footer.setContent(
      ` Focus: ${pane} | Enter: run command | Tab/Shift+Tab: switch pane | Ctrl+J: log | Ctrl+K: input | PgUp/PgDn: scroll | ?: help | q: exit `,
    );
    this.screen.render();
  }

  private renderStaticContent(): void {
    this.summaryText = this.options.summaryText.trim();
    this.updateHeader();
    this.renderSummary();

    this.sidebar.setContent(
      [
        this.options.commands.join("\n"),
        "",
        "Keys:",
        "? / F1      help",
        "Ctrl+L      clear log",
        "Tab         complete",
        "q / Ctrl+C  exit",
      ].join("\n"),
    );

    this.help.setContent(
      renderMarkdownToTerminal(
        [
        "AgentWeaver interactive mode",
        "",
        "Use slash commands in the input box:",
        this.options.commands.join("\n"),
        "",
        "Keys:",
        "Tab           autocomplete command",
        "Up/Down       history",
        "Ctrl+L        clear log",
        "? or F1       toggle help",
        "Esc           close help",
        "q / Ctrl+C    exit",
      ].join("\n"),
      ),
    );

    this.footer.setContent(
      " Enter: run command | Tab: complete | Up/Down: history | ?: help | Ctrl+L: clear log | q: exit ",
    );
  }

  private updateHeader(): void {
    this.header.setContent(
      `{bold}AgentWeaver{/bold}  {green-fg}${this.options.issueKey}{/green-fg}\n` +
        `cwd: ${this.options.cwd}   current: ${this.currentCommand}`,
    );
  }

  private renderSummary(): void {
    const summaryBody = this.summaryText
      ? this.summaryText
      : "Task summary is not available yet.";
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
    };
  }

  mount(): void {
    setOutputAdapter(this.createAdapter());
    this.focusPane("input");
  }

  destroy(): void {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
    }
    setOutputAdapter(null);
    this.screen.destroy();
  }

  setBusy(busy: boolean, command?: string): void {
    this.busy = busy;
    this.currentCommand = command ?? (busy ? this.currentCommand : "idle");
    if (busy && this.runningStartedAt === null) {
      this.runningStartedAt = Date.now();
    } else if (!busy && this.currentNode === null && this.currentExecutor === null) {
      this.runningStartedAt = null;
    }
    this.updateHeader();
    this.header.setContent(
      `{bold}AgentWeaver{/bold}  {green-fg}${this.options.issueKey}{/green-fg}\n` +
        `cwd: ${this.options.cwd}   current: ${this.currentCommand}${busy ? " {yellow-fg}[running]{/yellow-fg}" : ""}`,
    );
    this.updateRunningPanel();
    this.input.setLabel(busy ? " command [busy] " : " command ");
    this.screen.render();
  }

  setStatus(status: string): void {
    this.currentCommand = status;
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
    const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
  }
}
