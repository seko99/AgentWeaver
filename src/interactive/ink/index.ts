import { createRequire } from "node:module";
import process from "node:process";

import { TaskRunnerError } from "../../errors.js";
import { InteractiveSessionController } from "../controller.js";
import type { InteractiveSession, InteractiveSessionOptions } from "../session.js";

const require = createRequire(import.meta.url);

type InkModule = {
  Box: any;
  Text: any;
  render: (tree: unknown, options?: Record<string, unknown>) => {
    unmount(): void;
    clear?(): void;
    waitUntilExit?(): Promise<void>;
  };
  useInput: (handler: (input: string, key: Record<string, unknown>) => void) => void;
  useStdout: () => {
    stdout: NodeJS.WriteStream;
  };
};

type InkInputKey = {
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  pageDown: boolean;
  pageUp: boolean;
  return: boolean;
  escape: boolean;
  ctrl: boolean;
  shift: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  meta: boolean;
};

type ReactModule = {
  Fragment: unknown;
  createElement: (...args: unknown[]) => unknown;
  useEffect: (effect: () => void | (() => void), deps?: unknown[]) => void;
  useState: <T>(initialState: T | (() => T)) => [T, (value: T | ((previous: T) => T)) => void];
};

type InkPanelProps = {
  backgroundColor?: string;
  borderColor?: string;
  content: string;
  flexGrow?: number;
  height?: number;
  title: string;
  width?: number | string;
};

type StyledSegment = {
  backgroundColor?: string;
  bold?: boolean;
  color?: string;
  text: string;
};

type StyledLine = {
  backgroundColor?: string;
  bold?: boolean;
  color?: string;
  segments?: StyledSegment[];
  text: string;
};

function hasRuntimeModule(moduleName: string): boolean {
  try {
    require.resolve(moduleName);
    return true;
  } catch {
    return false;
  }
}

function clampScrollOffset(value: number, maxOffset: number): number {
  return Math.min(Math.max(0, value), maxOffset);
}

function buildSolidFill(width: number, height: number): string {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const line = " ".repeat(safeWidth);
  return Array.from({ length: safeHeight }, () => line).join("\n");
}

function parseActionSegments(line: string): StyledSegment[] {
  const matches = line.match(/\[[^\]]+\]/g);
  if (!matches) {
    return [{ text: line }];
  }

  const segments: StyledSegment[] = [];
  let cursor = 0;
  for (const match of matches) {
    const index = line.indexOf(match, cursor);
    if (index > cursor) {
      segments.push({ color: "gray", text: line.slice(cursor, index) });
    }
    segments.push({
      backgroundColor: "yellow",
      bold: true,
      color: "black",
      text: match,
    });
    cursor = index + match.length;
  }
  if (cursor < line.length) {
    segments.push({ color: "gray", text: line.slice(cursor) });
  }
  return segments;
}

function stylePanelLine(panelTitle: string, line: string): StyledLine {
  const trimmed = line.trim();

  if (panelTitle.includes("Flows") && line.startsWith("> ")) {
    return {
      backgroundColor: "cyan",
      bold: true,
      color: "black",
      text: line,
    };
  }

  if ((panelTitle === "User Input" || panelTitle === "Confirm") && line.startsWith("> ")) {
    return {
      backgroundColor: "cyan",
      bold: true,
      color: "black",
      text: line,
    };
  }

  if (panelTitle === "Confirm") {
    if (/^(Run|Interrupt) flow /.test(line)) {
      return { bold: true, color: "cyan", text: line };
    }
    if (line.includes("[") && line.includes("]")) {
      return {
        segments: parseActionSegments(line),
        text: line,
      };
    }
    if (trimmed.startsWith("Left/Right or Tab:")) {
      return { color: "gray", text: line };
    }
  }

  if (panelTitle === "User Input") {
    const checkboxMatch = line.match(/^(\s*[> ]\s*)(\[[x ]\])(.*)$/);
    if (checkboxMatch) {
      const prefix = checkboxMatch[1] ?? "";
      const marker = checkboxMatch[2] ?? "[ ]";
      const suffix = checkboxMatch[3] ?? "";
      const selected = prefix.includes(">");
      const lineBackgroundColor = selected ? "cyan" : undefined;
      const lineColor = selected ? "black" : "white";
      return {
        ...(lineBackgroundColor ? { backgroundColor: lineBackgroundColor } : {}),
        color: lineColor,
        segments: [
          { ...(lineBackgroundColor ? { backgroundColor: lineBackgroundColor } : {}), color: lineColor, text: prefix },
          {
            ...(lineBackgroundColor ? { backgroundColor: lineBackgroundColor } : {}),
            bold: marker === "[x]",
            color: selected ? "black" : marker === "[x]" ? "green" : "gray",
            text: marker,
          },
          { ...(lineBackgroundColor ? { backgroundColor: lineBackgroundColor } : {}), color: lineColor, text: suffix },
        ],
        text: line,
      };
    }
    if (/^Field \d+\/\d+/.test(trimmed)) {
      return { bold: true, color: "cyan", text: line };
    }
    if (trimmed === "Preview:" || trimmed === "Options:" || trimmed === "Text input:") {
      return { bold: true, color: "magenta", text: line };
    }
    if (/^[┌└][─]+[┐┘]$/.test(trimmed) || /^│ .* │$/.test(trimmed)) {
      return { color: "cyan", text: line };
    }
    if (/^Preview \d+-\d+ of \d+/.test(trimmed)) {
      return { color: "gray", text: line };
    }
    if (trimmed.startsWith("Hint:")) {
      return { color: "gray", text: line };
    }
  }

  if (panelTitle === "Help") {
    if (trimmed === "Keys:" || trimmed === "Available flows:") {
      return { bold: true, color: "magenta", text: line };
    }
    if (/^[A-Z][^:]+$/.test(trimmed) && !trimmed.includes(" ")) {
      return { bold: true, color: "cyan", text: line };
    }
  }

  return { text: line };
}

function renderStyledContent(react: ReactModule, ink: InkModule, panelTitle: string, content: string, backgroundColor?: string) {
  const { Fragment, createElement } = react;
  const { Box, Text } = ink;
  const lines = content.length > 0 ? content.split("\n") : [" "];
  const wrap = panelTitle.includes("Flows") ? "truncate-end" : undefined;

  return createElement(
    Box,
    {
      flexDirection: "column",
      flexGrow: 1,
      width: "100%",
      backgroundColor,
    },
    lines.map((line, index) => {
      const styledLine = stylePanelLine(panelTitle, line);
      const lineBackgroundColor = styledLine.backgroundColor ?? backgroundColor;
      const contentNode = styledLine.segments
        ? createElement(
            Text,
            {
              backgroundColor: lineBackgroundColor,
              bold: styledLine.bold,
              color: styledLine.color,
              ...(wrap ? { wrap } : {}),
            },
            styledLine.segments.map((segment, segmentIndex) =>
              createElement(
                Text,
                {
                  key: `segment-${index}-${segmentIndex}`,
                  backgroundColor: segment.backgroundColor ?? lineBackgroundColor,
                  bold: segment.bold,
                  color: segment.color,
                  ...(wrap ? { wrap } : {}),
                },
                segment.text,
              )),
          )
        : createElement(Text, {
          backgroundColor: lineBackgroundColor,
          bold: styledLine.bold,
          color: styledLine.color,
          ...(wrap ? { wrap } : {}),
        }, styledLine.text.length > 0 ? styledLine.text : " ");

      return createElement(
        Box,
        {
          key: `line-${index}`,
          width: "100%",
          backgroundColor: lineBackgroundColor,
        },
        createElement(Fragment, null, contentNode),
      );
    }),
  );
}

export function sliceFromScroll(text: string, offset: number, maxLines = 12): string {
  const lines = text.split("\n");
  const boundedOffset = clampScrollOffset(offset, Math.max(0, lines.length - 1));
  const start = Math.max(0, boundedOffset - maxLines + 1);
  const visible = lines.slice(start, start + maxLines);
  return visible.join("\n");
}

type ControllerKeypress = Parameters<InteractiveSessionController["handleKeypress"]>[1];

export function normalizeInkKeypress(input: string, key: InkInputKey): ControllerKeypress {
  let name: string | undefined;
  if (key.upArrow) {
    name = "up";
  } else if (key.downArrow) {
    name = "down";
  } else if (key.leftArrow) {
    name = "left";
  } else if (key.rightArrow) {
    name = "right";
  } else if (key.pageUp) {
    name = "pageup";
  } else if (key.pageDown) {
    name = "pagedown";
  } else if (key.return) {
    name = "enter";
  } else if (key.escape) {
    name = "escape";
  } else if (key.tab) {
    name = "tab";
  } else if (key.backspace || key.delete || input === "\b" || input === "\x7f") {
    name = "backspace";
  } else if (input === " ") {
    name = "space";
  } else if (input.length === 1) {
    name = input.toLowerCase();
  }

  return {
    ...(name ? { name } : {}),
    ctrl: key.ctrl,
    shift: key.shift,
    meta: key.meta,
  };
}

function buildFlowListText(
  viewModel: ReturnType<InteractiveSessionController["getViewModel"]>,
  maxLines: number,
): string {
  const totalItems = viewModel.flowItems.length;
  const safeMaxLines = Math.max(1, maxLines);
  const unclampedStart = viewModel.selectedFlowIndex - Math.floor(safeMaxLines / 2);
  const maxStart = Math.max(0, totalItems - safeMaxLines);
  const start = clampScrollOffset(unclampedStart, maxStart);
  const visibleItems = viewModel.flowItems.slice(start, start + safeMaxLines);

  return visibleItems
    .map((item, index) => {
      const absoluteIndex = start + index;
      return `${absoluteIndex === viewModel.selectedFlowIndex ? ">" : " "} ${item.label}`;
    })
    .join("\n");
}

function createPanelComponent(react: ReactModule, ink: InkModule) {
  const { createElement } = react;
  const { Box, Text } = ink;

  return function InkPanel({ backgroundColor, borderColor = "green", content, flexGrow, height, title, width }: InkPanelProps) {
    return createElement(
      Box,
      {
        borderStyle: "round",
        backgroundColor,
        borderColor,
        flexDirection: "column",
        flexGrow,
        height,
        width,
        paddingX: 1,
        paddingY: 0,
      },
      createElement(
        Box,
        {
          height: 1,
          width: "100%",
          backgroundColor,
        },
        createElement(Text, { bold: true, backgroundColor }, title),
      ),
      createElement(
        Box,
        {
          flexGrow: 1,
          width: "100%",
          backgroundColor,
        },
        renderStyledContent(react, ink, title, content, backgroundColor),
      ),
    );
  };
}

function createOverlayBox(
  react: ReactModule,
  ink: InkModule,
  panel: ReturnType<typeof createPanelComponent>,
  options: {
    borderColor: string;
    content: string;
    height: number;
    key: string;
    title: string;
    width: number;
  },
) {
  const { createElement } = react;
  const { Box, Text } = ink;
  return createElement(
    Box,
    {
      key: options.key,
      position: "absolute",
      top: 0,
      left: 0,
      width: "100%",
      height: "100%",
      alignItems: "center",
      justifyContent: "center",
    },
    createElement(
      Box,
      {
        position: "relative",
        width: options.width,
        height: options.height,
        backgroundColor: "black",
      },
      createElement(
          Box,
          {
            position: "absolute",
            top: 0,
            left: 0,
            width: options.width,
            height: options.height,
            backgroundColor: "black",
          },
          createElement(
            Text,
            { backgroundColor: "black" },
            buildSolidFill(options.width, options.height),
          ),
        ),
        createElement(panel, {
          backgroundColor: "black",
          borderColor: options.borderColor,
          content: options.content,
          height: options.height,
          title: options.title,
          width: options.width,
        }),
      ),
  );
}

function createInkApp(react: ReactModule, ink: InkModule, controller: InteractiveSessionController) {
  const { Fragment, createElement, useEffect, useState } = react;
  const { Box, Text, useInput, useStdout } = ink;
  const Panel = createPanelComponent(react, ink);

  const App = () => {
    const [, setVersion] = useState(0);

    useEffect(() => {
      const unsubscribe = controller.subscribe(() => {
        setVersion((previous) => previous + 1);
      });
      controller.mount();
      return () => {
        unsubscribe();
        controller.destroy();
      };
    }, []);

    useInput((input, key) => {
      void controller.handleKeypress(input, normalizeInkKeypress(input, key as InkInputKey));
    });

    const { stdout } = useStdout();
    const terminalRows = Math.max(stdout.rows ?? 24, 20);
    const terminalColumns = Math.max(stdout.columns ?? 80, 80);
    const bodyHeight = Math.max(terminalRows - 8, 12);
    const sideStatusHeight = 6;
    const sideDescriptionHeight = Math.max(8, Math.floor(bodyHeight * 0.22));
    const sideFlowListHeight = Math.max(8, bodyHeight - sideDescriptionHeight - sideStatusHeight);
    const formModalWidth = Math.max(56, Math.floor(terminalColumns * 0.72));
    const formContentWidth = Math.max(8, formModalWidth - 8);
    const viewModel = controller.getViewModel({ formContentWidth });
    const rightSummaryHeight = viewModel.summaryVisible ? Math.max(8, Math.floor(bodyHeight * 0.24)) : 0;
    const rightProgressHeight = Math.max(8, Math.floor(bodyHeight * 0.34));
    const rightLogHeight = Math.max(8, bodyHeight - rightProgressHeight - rightSummaryHeight);
    const overlayPanels: unknown[] = [];

    if (viewModel.helpVisible) {
      const modalHeight = Math.max(10, Math.floor(terminalRows * 0.6));
      const modalWidth = Math.max(48, Math.floor(terminalColumns * 0.64));
      overlayPanels.push(
        createOverlayBox(react, ink, Panel, {
          key: "help",
          borderColor: "magenta",
          height: modalHeight,
          width: modalWidth,
          title: "Help",
          content: sliceFromScroll(viewModel.helpText, viewModel.helpScrollOffset, Math.max(8, modalHeight - 4)),
        }),
      );
    }
    if (viewModel.confirmText) {
      overlayPanels.push(
        createOverlayBox(react, ink, Panel, {
          key: "confirm",
          borderColor: "yellow",
          height: 9,
          width: Math.max(48, Math.floor(terminalColumns * 0.44)),
          title: "Confirm",
          content: viewModel.confirmText,
        }),
      );
    }
    if (viewModel.form) {
      const modalHeight = Math.max(10, Math.floor(terminalRows * 0.68));
      overlayPanels.push(
        createOverlayBox(react, ink, Panel, {
          key: "form",
          borderColor: "magenta",
          height: modalHeight,
          width: formModalWidth,
          title: viewModel.form.title,
          content: viewModel.form.content,
        }),
      );
    }

    return createElement(
      Fragment,
      null,
      createElement(
        Box,
        { flexDirection: "column", width: terminalColumns, height: terminalRows },
        createElement(Panel, {
          title: viewModel.title,
          borderColor: "cyan",
          height: 4,
          content: viewModel.header,
        }),
        createElement(
          Box,
          { flexDirection: "row", alignItems: "flex-start", flexGrow: 1 },
          createElement(
            Box,
            { flexDirection: "column", width: "34%", marginRight: 1, height: bodyHeight },
            createElement(Panel, {
              title: viewModel.flowListTitle,
              borderColor: "cyan",
              height: sideFlowListHeight,
              content: buildFlowListText(viewModel, Math.max(4, sideFlowListHeight - 4)),
            }),
            createElement(Panel, {
              title: "Flow Description",
              borderColor: "magenta",
              height: sideDescriptionHeight,
              content: viewModel.descriptionText,
            }),
            createElement(Panel, {
              title: "Status",
              borderColor: "green",
              height: sideStatusHeight,
              content: viewModel.statusText,
            }),
          ),
          createElement(
            Box,
            { flexDirection: "column", width: "66%", height: bodyHeight },
            createElement(Panel, {
              title: viewModel.progressTitle,
              borderColor: "green",
              height: rightProgressHeight,
              content: sliceFromScroll(viewModel.progressText, viewModel.progressScrollOffset, Math.max(4, rightProgressHeight - 4)),
            }),
            viewModel.summaryVisible
              ? createElement(Panel, {
                  title: viewModel.summaryTitle,
                  borderColor: "green",
                  height: rightSummaryHeight,
                  content: sliceFromScroll(viewModel.summaryText, viewModel.summaryScrollOffset, Math.max(4, rightSummaryHeight - 4)),
                })
              : null,
            createElement(Panel, {
              title: viewModel.logTitle,
              borderColor: "yellow",
              height: rightLogHeight,
              content: sliceFromScroll(viewModel.logText, viewModel.logScrollOffset, Math.max(4, rightLogHeight - 4)),
            }),
          ),
        ),
        createElement(
          Box,
          {
            borderStyle: "round",
            borderColor: "gray",
            height: 3,
            paddingX: 1,
          },
          createElement(Text, null, viewModel.footer),
        ),
        ...overlayPanels,
      ),
    );
  };

  return createElement(App);
}

export function isInkRuntimeDependencyAvailable(): boolean {
  return hasRuntimeModule("ink") && hasRuntimeModule("react");
}

export function describeInkInteractiveSessionAvailability(): string | null {
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    return "Interactive mode requires a real TTY on both stdin and stdout.";
  }
  if (!isInkRuntimeDependencyAvailable()) {
    return "Interactive mode requires installed runtime dependencies: run `npm install` in the AgentWeaver checkout or reinstall the published package.";
  }
  return null;
}

async function loadInkModules(): Promise<{ ink: InkModule; react: ReactModule }> {
  const [inkModule, reactModule] = await Promise.all([import("ink"), import("react")]);
  const react = (reactModule.default ?? reactModule) as ReactModule;
  return {
    ink: inkModule as InkModule,
    react,
  };
}

class InkInteractiveSession implements InteractiveSession {
  private readonly controller: InteractiveSessionController;
  private inkInstance: ReturnType<InkModule["render"]> | null = null;
  private mountingPromise: Promise<void> | null = null;
  private destroyed = false;

  constructor(options: InteractiveSessionOptions) {
    this.controller = new InteractiveSessionController(options);
  }

  mount(): void {
    if (this.mountingPromise) {
      return;
    }
    this.mountingPromise = this.mountInk();
  }

  destroy(): void {
    this.destroyed = true;
    this.inkInstance?.unmount();
    this.inkInstance = null;
  }

  requestUserInput(form: Parameters<InteractiveSessionController["requestUserInput"]>[0]) {
    return this.controller.requestUserInput(form);
  }

  setSummary(markdown: string): void {
    this.controller.setSummary(markdown);
  }

  clearSummary(): void {
    this.controller.clearSummary();
  }

  setScope(scopeKey: string, jiraIssueKey?: string | null): void {
    this.controller.setScope(scopeKey, jiraIssueKey);
  }

  appendLog(text: string): void {
    this.controller.appendLog(text);
  }

  setFlowFailed(flowId: string): void {
    this.controller.setFlowFailed(flowId);
  }

  interruptActiveForm(message?: string): void {
    this.controller.interruptActiveForm(message);
  }

  private async mountInk(): Promise<void> {
    const { ink, react } = await loadInkModules();
    if (this.destroyed) {
      return;
    }
    this.inkInstance = ink.render(createInkApp(react, ink, this.controller), {
      exitOnCtrlC: false,
      patchConsole: false,
    });
  }
}

export function isInkInteractiveSessionAvailable(): boolean {
  return describeInkInteractiveSessionAvailability() === null;
}

export function createInkInteractiveSession(options: InteractiveSessionOptions): InteractiveSession {
  const unavailableReason = describeInkInteractiveSessionAvailability();
  if (unavailableReason) {
    throw new TaskRunnerError(unavailableReason);
  }
  return new InkInteractiveSession(options);
}
