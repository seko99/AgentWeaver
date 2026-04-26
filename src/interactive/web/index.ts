import process from "node:process";
import { writeSync } from "node:fs";

import { FlowInterruptedError } from "../../errors.js";
import { InteractiveSessionController } from "../controller.js";
import type { InteractiveSession, InteractiveSessionOptions } from "../session.js";
import type { ClientAction, ServerEvent } from "./protocol.js";
import { startWebServer, type StartedWebServer, type WebServerOptions, type WebSocketClient } from "./server.js";

export type CreateWebInteractiveSessionOptions = {
  noOpen?: boolean;
  host?: string;
  onServerReady?: (server: StartedWebServer) => void;
  printInfo?: (message: string) => void;
  openBrowser?: WebServerOptions["openBrowser"];
};

function actionId(action: ClientAction): string | undefined {
  return "actionId" in action ? action.actionId : undefined;
}

export function createWebInteractiveSession(
  options: InteractiveSessionOptions,
  webOptions: CreateWebInteractiveSessionOptions = {},
): InteractiveSession {
  const controller = new InteractiveSessionController(options);
  let server: StartedWebServer | null = null;
  let unsubscribe: (() => void) | null = null;
  let mounted = false;
  let shuttingDown = false;

  function snapshot(): ServerEvent {
    return { type: "snapshot", viewModel: controller.getViewModel() };
  }

  function sendError(client: WebSocketClient | null, message: string, id?: string): void {
    const event: ServerEvent = { type: "error", message, ...(id ? { actionId: id } : {}) };
    if (client) {
      client.send(event);
    } else {
      server?.broadcast(event);
    }
  }

  async function dispatch(action: ClientAction, client: WebSocketClient): Promise<void> {
    try {
      if (action.type === "flow.select") {
        if (action.key) {
          controller.selectFlowKey(action.key);
        } else {
          controller.selectFlowIndex(action.index ?? 0);
        }
        return;
      }
      if (action.type === "folder.toggle") {
        controller.toggleFolderKey(action.key);
        return;
      }
      if (action.type === "run.openConfirm") {
        await controller.openRunConfirm(action.flowId, action.key);
        return;
      }
      if (action.type === "confirm.select") {
        controller.selectConfirmAction(action.action);
        return;
      }
      if (action.type === "confirm.accept") {
        await controller.acceptConfirmation();
        return;
      }
      if (action.type === "confirm.cancel") {
        controller.cancelConfirmation();
        return;
      }
      if (action.type === "form.update") {
        controller.updateActiveFormValues(action.values);
        return;
      }
      if (action.type === "form.fieldUpdate") {
        controller.updateFormField(action.fieldId, action.value);
        return;
      }
      if (action.type === "form.submit") {
        controller.submitForm(action.values);
        return;
      }
      if (action.type === "form.cancel") {
        controller.cancelForm();
        return;
      }
      if (action.type === "flow.interrupt") {
        await controller.interruptCurrentFlow(action.flowId);
        return;
      }
      if (action.type === "interrupt.openConfirm") {
        controller.openInterruptConfirm();
        return;
      }
      if (action.type === "log.clear") {
        controller.clearLog();
        return;
      }
      if (action.type === "help.toggle") {
        controller.showHelp(action.visible ?? !controller.getViewModel().helpVisible);
        return;
      }
      controller.scrollPane(action.pane, { ...(action.delta !== undefined ? { delta: action.delta } : {}), ...(action.offset !== undefined ? { offset: action.offset } : {}) });
    } catch (error) {
      const message = (error as Error).message;
      controller.appendLog(`Web action failed: ${message}`);
      sendError(client, message, actionId(action));
    }
  }

  return {
    mount(): void {
      if (mounted) {
        return;
      }
      mounted = true;
      controller.mount();
      unsubscribe = controller.subscribe((event) => {
        if (event.type === "log") {
          server?.broadcast({ type: "log.append", appendedLines: event.appendedLines });
          return;
        }
        server?.broadcast(snapshot());
      });
      void startWebServer({
        ...(webOptions.noOpen !== undefined ? { noOpen: webOptions.noOpen } : {}),
        ...(webOptions.host !== undefined ? { host: webOptions.host } : {}),
        printInfo: (message) => {
          webOptions.printInfo?.(message);
          controller.appendLog(message);
        },
        ...(webOptions.openBrowser ? { openBrowser: webOptions.openBrowser } : {}),
        onClientAction: (action, client) => {
          void dispatch(action, client);
        },
        onClientConnected: (client) => {
          client.send(snapshot());
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
        controller.appendLog(message);
        writeSync(process.stderr.fd, `${message}\n`);
        options.onExit();
      });
    },

    destroy(): void {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      controller.interruptActiveForm("Web UI session closed.");
      unsubscribe?.();
      unsubscribe = null;
      const closePromise = server?.close();
      server = null;
      if (closePromise) {
        void closePromise.catch((error) => {
          process.stderr.write(`Failed to close Web UI server: ${(error as Error).message}\n`);
        });
      }
      controller.destroy();
    },

    requestUserInput: (form) => controller.requestUserInput(form),
    setSummary: (markdown) => controller.setSummary(markdown),
    clearSummary: () => controller.clearSummary(),
    setScope: (scopeKey, jiraIssueKey) => controller.setScope(scopeKey, jiraIssueKey),
    appendLog: (text) => controller.appendLog(text),
    setFlowFailed: (flowId) => controller.setFlowFailed(flowId),
    interruptActiveForm: (message = "Flow interrupted by user.") => {
      controller.interruptActiveForm(message);
      if (message) {
        controller.appendLog(new FlowInterruptedError(message).message);
      }
    },
  };
}
