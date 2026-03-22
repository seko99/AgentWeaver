import process from "node:process";

const RESET = "\u001b[0m";
const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";
const RED = "\u001b[31m";
const GREEN = "\u001b[32m";
const YELLOW = "\u001b[33m";
const BLUE = "\u001b[34m";
const MAGENTA = "\u001b[35m";
const CYAN = "\u001b[36m";

export type OutputAdapter = {
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
  supportsTransientStatus: boolean;
  supportsPassthrough: boolean;
  renderAuxiliaryOutput?: boolean;
  setExecutionState?: (state: { node: string | null; executor: string | null }) => void;
};

const defaultAdapter: OutputAdapter = {
  writeStdout: (text) => {
    process.stdout.write(text);
  },
  writeStderr: (text) => {
    process.stderr.write(text);
  },
  supportsTransientStatus: true,
  supportsPassthrough: true,
  renderAuxiliaryOutput: true,
};

let outputAdapter: OutputAdapter = defaultAdapter;
let executionState: { node: string | null; executor: string | null } = {
  node: null,
  executor: null,
};

function color(text: string, ansi: string): string {
  return `${ansi}${text}${RESET}`;
}

export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

export function setOutputAdapter(adapter: OutputAdapter | null): void {
  outputAdapter = adapter ?? defaultAdapter;
  outputAdapter.setExecutionState?.(executionState);
}

export function getOutputAdapter(): OutputAdapter {
  return outputAdapter;
}

export function renderPanel(title: string, body: string, borderColor?: string): string {
  const lines = body.split("\n");
  const width = Math.max(visibleLength(title) + 2, ...lines.map((line) => visibleLength(line)), 10);
  const top = `┌${"─".repeat(width + 2)}┐`;
  const middle = lines
    .map((line) => {
      const pad = width - visibleLength(line);
      return `│ ${line}${" ".repeat(Math.max(0, pad))} │`;
    })
    .join("\n");
  const bottom = `└${"─".repeat(width + 2)}┘`;
  if (!borderColor) {
    return `${top}\n│ ${title.padEnd(width)} │\n├${"─".repeat(width + 2)}┤\n${middle}\n${bottom}`;
  }
  return `${color(top, borderColor)}\n${color(`│ ${title.padEnd(width)} │`, borderColor)}\n${color(
    `├${"─".repeat(width + 2)}┤`,
    borderColor,
  )}\n${middle}\n${color(bottom, borderColor)}`;
}

export function printInfo(message: string): void {
  if (outputAdapter.renderAuxiliaryOutput === false) {
    return;
  }
  outputAdapter.writeStdout(`${color(message, `${BOLD}${CYAN}`)}\n`);
}

export function printError(message: string): void {
  outputAdapter.writeStderr(`${color(message, `${BOLD}${RED}`)}\n`);
}

export function printPrompt(toolName: string, prompt: string): void {
  if (outputAdapter.renderAuxiliaryOutput === false) {
    return;
  }
  outputAdapter.writeStdout(`${renderPanel(`${toolName} Prompt`, prompt, BLUE)}\n`);
}

export function printSummary(title: string, text: string): void {
  if (outputAdapter.renderAuxiliaryOutput === false) {
    return;
  }
  outputAdapter.writeStdout(`${renderPanel(title, text.trim() || "Empty summary", YELLOW)}\n`);
}

export function printPanel(title: string, text: string, tone: "green" | "yellow" | "magenta" | "cyan"): void {
  if (outputAdapter.renderAuxiliaryOutput === false) {
    return;
  }
  const borderColor = tone === "green" ? GREEN : tone === "yellow" ? YELLOW : tone === "magenta" ? MAGENTA : CYAN;
  outputAdapter.writeStdout(`${renderPanel(title, text, borderColor)}\n`);
}

export function formatDone(elapsed: string): string {
  return `${color("Done", GREEN)} ${elapsed}`;
}

export function dim(text: string): string {
  return color(text, DIM);
}

export function bold(text: string): string {
  return color(text, BOLD);
}

export function bye(): void {
  outputAdapter.writeStdout(`${color("Bye", CYAN)}\n`);
}

function updateExecutionState(next: { node: string | null; executor: string | null }): void {
  executionState = next;
  outputAdapter.setExecutionState?.(executionState);
}

export function setCurrentNode(node: string | null): void {
  updateExecutionState({
    ...executionState,
    node,
  });
}

export function setCurrentExecutor(executor: string | null): void {
  updateExecutionState({
    ...executionState,
    executor,
  });
}
