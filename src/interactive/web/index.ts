import process from "node:process";
import { writeSync } from "node:fs";

import { FlowInterruptedError, TaskRunnerError } from "../../errors.js";
import type { FlowLaunchMode } from "../../flow-state.js";
import { setOutputAdapter, stripAnsi, type OutputAdapter } from "../../tui.js";
import {
  buildInitialUserInputValues,
  normalizeUserInputFieldValue,
  validateUserInputValues,
  type UserInputFormDefinition,
  type UserInputResult,
} from "../../user-input.js";
import type { InteractiveSession, InteractiveSessionOptions } from "../session.js";
import type { WebClientAction, WebPendingConfirmation, WebPendingInput, WebServerMessage, WebSessionSnapshot } from "./protocol.js";
import { startWebServer, type StartedWebServer, type WebServerOptions } from "./server.js";

type PendingInput = WebPendingInput & {
  resolve: (result: UserInputResult) => void;
  reject: (error: Error) => void;
};

type PendingConfirmation = WebPendingConfirmation & {
  running: boolean;
};

export type CreateWebInteractiveSessionOptions = {
  noOpen?: boolean;
  host?: string;
  onServerReady?: (server: StartedWebServer) => void;
  printInfo?: (message: string) => void;
  openBrowser?: WebServerOptions["openBrowser"];
};

let nextRequestNumber = 1;

function nextRequestId(prefix: string): string {
  const id = `${prefix}-${Date.now().toString(36)}-${nextRequestNumber.toString(36)}`;
  nextRequestNumber += 1;
  return id;
}

function normalizeLogText(text: string): string {
  return stripAnsi(text).replace(/\r/g, "").trimEnd();
}

export function createWebInteractiveSession(
  options: InteractiveSessionOptions,
  webOptions: CreateWebInteractiveSessionOptions = {},
): InteractiveSession {
  let server: StartedWebServer | null = null;
  let mounted = false;
  let scopeKey = options.scopeKey;
  let jiraIssueKey = options.jiraIssueKey ?? null;
  let summaryText = options.summaryText.trim();
  const logs: string[] = [];
  let failedFlowId: string | null = null;
  let pendingInput: PendingInput | null = null;
  let pendingConfirmation: PendingConfirmation | null = null;
  let shuttingDown = false;

  function snapshot(): WebSessionSnapshot {
    return {
      scopeKey,
      jiraIssueKey,
      summaryText,
      logs: [...logs],
      flows: options.flows.map((flow) => ({
        id: flow.id,
        label: flow.label,
        description: flow.description,
        treePath: flow.treePath,
      })),
      failedFlowId,
      pendingInput: pendingInput ? { requestId: pendingInput.requestId, form: pendingInput.form } : null,
      pendingConfirmation: pendingConfirmation
        ? {
            requestId: pendingConfirmation.requestId,
            flowId: pendingConfirmation.flowId,
            mode: pendingConfirmation.mode,
            details: pendingConfirmation.details,
          }
        : null,
      shuttingDown,
    };
  }

  function broadcast(message: WebServerMessage): void {
    server?.broadcast(message);
  }

  function appendLogLine(text: string): void {
    const normalized = normalizeLogText(text);
    if (!normalized) {
      return;
    }
    logs.push(normalized);
    broadcast({ type: "logAppended", text: normalized });
  }

  function rejectPendingInput(error: Error, message: string): void {
    if (!pendingInput) {
      return;
    }
    const requestId = pendingInput.requestId;
    const reject = pendingInput.reject;
    pendingInput = null;
    broadcast({ type: "formInterrupted", requestId, message });
    reject(error);
  }

  function clearPendingConfirmation(): void {
    pendingConfirmation = null;
  }

  function chooseConfirmationMode(availability: Awaited<ReturnType<InteractiveSessionOptions["getRunConfirmation"]>>): FlowLaunchMode {
    if (availability.resume.available) {
      return "resume";
    }
    if (availability.continue.available) {
      return "continue";
    }
    return "restart";
  }

  const outputAdapter: OutputAdapter = {
    writeStdout: appendLogLine,
    writeStderr: appendLogLine,
    supportsTransientStatus: false,
    supportsPassthrough: false,
    renderAuxiliaryOutput: true,
    renderPanelsAsPlainText: true,
    setExecutionState: (state) => {
      if (state.node || state.executor) {
        appendLogLine(`[state] node=${state.node ?? "-"} executor=${state.executor ?? "-"}`);
      }
    },
    setFlowState: (state) => {
      if (state.flowId) {
        appendLogLine(`[flow] ${state.flowId}`);
      }
    },
  };

  async function handleAction(action: WebClientAction): Promise<void> {
    if (action.type === "submitInput") {
      if (!pendingInput || pendingInput.requestId !== action.requestId) {
        broadcast({ type: "error", message: "No matching pending input request.", requestId: action.requestId });
        return;
      }
      const pending = pendingInput;
      const values = { ...buildInitialUserInputValues(pending.form.fields), ...action.values };
      for (const field of pending.form.fields) {
        normalizeUserInputFieldValue(field, values);
      }
      try {
        validateUserInputValues(pending.form, values);
      } catch (error) {
        broadcast({ type: "error", message: (error as Error).message, requestId: action.requestId });
        return;
      }
      pendingInput = null;
      pending.resolve({
        formId: pending.form.formId,
        submittedAt: new Date().toISOString(),
        values,
      });
      return;
    }
    if (action.type === "cancelInput") {
      if (!pendingInput || pendingInput.requestId !== action.requestId) {
        broadcast({ type: "error", message: "No matching pending input request.", requestId: action.requestId });
        return;
      }
      rejectPendingInput(new TaskRunnerError(`User cancelled form '${pendingInput.form.formId}'.`), "Input cancelled.");
      return;
    }
    if (action.type === "requestRun") {
      if (!options.flows.some((flow) => flow.id === action.flowId)) {
        broadcast({ type: "error", message: `Unknown flow: ${action.flowId}` });
        return;
      }
      try {
        const availability = await options.getRunConfirmation(action.flowId);
        const mode = chooseConfirmationMode(availability);
        pendingConfirmation = {
          requestId: nextRequestId("confirm"),
          flowId: action.flowId,
          mode,
          details: availability.details ?? null,
          running: false,
        };
        pendingInput = null;
        broadcast({
          type: "confirmationRequested",
          requestId: pendingConfirmation.requestId,
          flowId: pendingConfirmation.flowId,
          mode,
          details: pendingConfirmation.details,
        });
      } catch (error) {
        broadcast({ type: "error", message: (error as Error).message });
      }
      return;
    }
    if (action.type === "confirmRun" || action.type === "rejectRun") {
      if (!pendingConfirmation || pendingConfirmation.requestId !== action.requestId) {
        broadcast({ type: "error", message: "No matching pending confirmation request.", requestId: action.requestId });
        return;
      }
      const pending = pendingConfirmation;
      clearPendingConfirmation();
      if (action.type === "confirmRun" && !pending.running) {
        pending.running = true;
        void options.onRun(pending.flowId, pending.mode).catch((error) => {
          appendLogLine(`Flow failed: ${(error as Error).message}`);
        });
      }
      return;
    }
    if (action.type === "interrupt") {
      rejectPendingInput(new FlowInterruptedError("Flow interrupted by user."), "Flow interrupted by user.");
      if (action.flowId) {
        await options.onInterrupt(action.flowId);
      }
      return;
    }
    if (action.type === "exit") {
      options.onExit();
    }
  }

  return {
    mount(): void {
      if (mounted) {
        return;
      }
      mounted = true;
      setOutputAdapter(outputAdapter);
      void startWebServer({
        ...(webOptions.noOpen !== undefined ? { noOpen: webOptions.noOpen } : {}),
        ...(webOptions.host !== undefined ? { host: webOptions.host } : {}),
        printInfo: (message) => {
          webOptions.printInfo?.(message);
          appendLogLine(message);
        },
        ...(webOptions.openBrowser ? { openBrowser: webOptions.openBrowser } : {}),
        onClientAction: (action) => {
          void handleAction(action);
        },
        onClientConnected: (client) => {
          client.send({ type: "snapshot", state: snapshot() });
        },
        onExitRequested: () => {
          options.onExit();
        },
      }).then((started) => {
        if (shuttingDown) {
          void started.close().catch((error) => {
            process.stderr.write(`Failed to close Web UI server: ${(error as Error).message}\n`);
          });
          return;
        }
        server = started;
        webOptions.onServerReady?.(started);
      }).catch((error) => {
        const message = `Web UI startup failed: ${(error as Error).message}`;
        appendLogLine(message);
        writeSync(process.stderr.fd, `${message}\n`);
        options.onExit();
      });
    },

    destroy(): void {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      rejectPendingInput(new FlowInterruptedError("Web UI session closed."), "Web UI session closed.");
      clearPendingConfirmation();
      broadcast({ type: "shutdown" });
      const closePromise = server?.close();
      server = null;
      if (closePromise) {
        void closePromise.catch((error) => {
          process.stderr.write(`Failed to close Web UI server: ${(error as Error).message}\n`);
        });
      }
      setOutputAdapter(null);
    },

    requestUserInput(form: UserInputFormDefinition): Promise<UserInputResult> {
      if (pendingInput) {
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
        pendingInput = {
          requestId: nextRequestId("input"),
          form,
          resolve,
          reject,
        };
        pendingConfirmation = null;
        broadcast({ type: "inputRequested", requestId: pendingInput.requestId, form });
      });
    },

    setSummary(markdown: string): void {
      summaryText = markdown.trim();
      broadcast({ type: "summaryUpdated", markdown: summaryText });
    },

    clearSummary(): void {
      summaryText = "";
      broadcast({ type: "summaryCleared" });
    },

    setScope(nextScopeKey: string, nextJiraIssueKey?: string | null): void {
      scopeKey = nextScopeKey;
      jiraIssueKey = nextJiraIssueKey ?? null;
      broadcast({ type: "scopeUpdated", scopeKey, jiraIssueKey });
    },

    appendLog(text: string): void {
      appendLogLine(text);
    },

    setFlowFailed(flowId: string): void {
      failedFlowId = flowId;
      broadcast({ type: "flowFailed", flowId });
    },

    interruptActiveForm(message = "Flow interrupted by user."): void {
      rejectPendingInput(new FlowInterruptedError(message), message);
    },
  };
}
