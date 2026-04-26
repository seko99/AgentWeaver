import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import http, { type IncomingMessage } from "node:http";
import process from "node:process";
import type { Duplex } from "node:stream";

import type { WebClientAction, WebServerMessage } from "./protocol.js";
import { parseWebClientAction } from "./protocol.js";

type WebSocketClient = {
  socket: Duplex;
  send: (message: WebServerMessage) => void;
  close: () => void;
};

export type WebServerOptions = {
  noOpen?: boolean;
  host?: string;
  onClientAction: (action: WebClientAction) => void;
  onClientConnected: (client: WebSocketClient) => void;
  onExitRequested: () => void;
  printInfo?: (message: string) => void;
  openBrowser?: (url: string) => Promise<void>;
};

export type StartedWebServer = {
  url: string;
  host: string;
  broadcast(message: WebServerMessage): void;
  close(): Promise<void>;
};

function htmlShell(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AgentWeaver Web UI</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f6f7f9; color: #172026; }
    main { max-width: 1120px; margin: 0 auto; padding: 24px; display: grid; gap: 16px; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: center; border-bottom: 1px solid #d8dee6; padding-bottom: 12px; }
    h1 { margin: 0; font-size: 24px; font-weight: 650; letter-spacing: 0; }
    button { border: 1px solid #b8c2cc; background: #ffffff; color: #172026; border-radius: 6px; padding: 8px 12px; cursor: pointer; }
    section { display: grid; gap: 8px; }
    pre, textarea { border: 1px solid #d8dee6; border-radius: 6px; background: #ffffff; padding: 12px; white-space: pre-wrap; overflow: auto; }
    pre { min-height: 96px; }
    .grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, 0.45fr); gap: 16px; align-items: start; }
    .muted { color: #5d6875; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    label { display: grid; gap: 4px; font-size: 14px; }
    input, textarea, select { font: inherit; border: 1px solid #b8c2cc; border-radius: 6px; padding: 8px; background: #ffffff; color: #172026; }
    @media (prefers-color-scheme: dark) {
      body { background: #101418; color: #eef2f6; }
      header, pre, textarea, input, select, button { border-color: #34404c; }
      pre, textarea, input, select, button { background: #171d23; color: #eef2f6; }
      .muted { color: #9aa6b2; }
    }
    @media (max-width: 760px) { main { padding: 16px; } .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>AgentWeaver Web UI</h1>
        <div id="scope" class="muted">Connecting...</div>
      </div>
      <button id="exit">Exit</button>
    </header>
    <div class="grid">
      <section>
        <h2>Summary</h2>
        <pre id="summary">Task summary is not available yet.</pre>
        <h2>Activity</h2>
        <pre id="logs"></pre>
      </section>
      <section>
        <h2>Action</h2>
        <div id="flows" class="row"></div>
        <div id="action" class="muted">No action is pending.</div>
      </section>
    </div>
  </main>
  <script>
    const scope = document.getElementById("scope");
    const summary = document.getElementById("summary");
    const logs = document.getElementById("logs");
    const action = document.getElementById("action");
    const flows = document.getElementById("flows");
    const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/__agentweaver/ws");
    let pendingInput = null;
    let pendingConfirmation = null;
    function send(message) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); }
    function renderState(state) {
      scope.textContent = "Scope " + state.scopeKey + (state.jiraIssueKey ? " | Jira " + state.jiraIssueKey : "");
      summary.textContent = state.summaryText || "Task summary is not available yet.";
      logs.textContent = (state.logs || []).join("\\n");
      flows.innerHTML = "";
      for (const flow of state.flows || []) {
        const button = document.createElement("button");
        button.textContent = flow.label || flow.id;
        button.title = (flow.treePath || []).join(" / ");
        button.onclick = () => send({ type: "requestRun", flowId: flow.id });
        flows.append(button);
      }
      pendingInput = state.pendingInput;
      pendingConfirmation = state.pendingConfirmation;
      renderAction();
    }
    function renderAction() {
      action.innerHTML = "";
      if (pendingConfirmation) {
        const label = document.createElement("div");
        label.textContent = "Run " + pendingConfirmation.flowId + (pendingConfirmation.mode ? " (" + pendingConfirmation.mode + ")" : "") + "?";
        const row = document.createElement("div");
        row.className = "row";
        const yes = document.createElement("button");
        yes.textContent = "Run";
        yes.onclick = () => send({ type: "confirmRun", requestId: pendingConfirmation.requestId });
        const no = document.createElement("button");
        no.textContent = "Cancel";
        no.onclick = () => send({ type: "rejectRun", requestId: pendingConfirmation.requestId });
        row.append(yes, no);
        action.append(label, row);
        return;
      }
      if (pendingInput) {
        const form = document.createElement("form");
        const values = {};
        const title = document.createElement("strong");
        title.textContent = pendingInput.form.title;
        form.append(title);
        for (const field of pendingInput.form.fields) {
          const label = document.createElement("label");
          label.textContent = field.label;
          let input;
          if (field.type === "boolean") {
            input = document.createElement("input");
            input.type = "checkbox";
            input.checked = Boolean(field.default);
          } else if (field.type === "text") {
            input = document.createElement(field.multiline ? "textarea" : "input");
            input.value = field.default || "";
          } else {
            input = document.createElement("select");
            input.multiple = field.type === "multi-select";
            for (const option of field.options || []) {
              const opt = document.createElement("option");
              opt.value = option.value;
              opt.textContent = option.label;
              input.append(opt);
            }
          }
          input.dataset.fieldId = field.id;
          input.dataset.fieldType = field.type;
          label.append(input);
          form.append(label);
        }
        const row = document.createElement("div");
        row.className = "row";
        const submit = document.createElement("button");
        submit.textContent = pendingInput.form.submitLabel || "Submit";
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.textContent = "Cancel";
        cancel.onclick = () => send({ type: "cancelInput", requestId: pendingInput.requestId });
        row.append(submit, cancel);
        form.append(row);
        form.onsubmit = (event) => {
          event.preventDefault();
          for (const el of form.querySelectorAll("[data-field-id]")) {
            if (el.dataset.fieldType === "boolean") values[el.dataset.fieldId] = el.checked;
            else if (el.dataset.fieldType === "multi-select") values[el.dataset.fieldId] = Array.from(el.selectedOptions).map((option) => option.value);
            else values[el.dataset.fieldId] = el.value;
          }
          send({ type: "submitInput", requestId: pendingInput.requestId, values });
        };
        action.append(form);
        return;
      }
      action.textContent = "No action is pending.";
      action.className = "muted";
    }
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "snapshot") renderState(message.state);
      if (message.type === "summaryUpdated") summary.textContent = message.markdown;
      if (message.type === "summaryCleared") summary.textContent = "Task summary is not available yet.";
      if (message.type === "scopeUpdated") scope.textContent = "Scope " + message.scopeKey + (message.jiraIssueKey ? " | Jira " + message.jiraIssueKey : "");
      if (message.type === "logAppended") logs.textContent += (logs.textContent ? "\\n" : "") + message.text;
      if (message.type === "flowFailed") logs.textContent += (logs.textContent ? "\\n" : "") + "[failed] " + message.flowId;
      if (message.type === "inputRequested") { pendingInput = { requestId: message.requestId, form: message.form }; pendingConfirmation = null; renderAction(); }
      if (message.type === "confirmationRequested") { pendingConfirmation = { requestId: message.requestId, flowId: message.flowId, mode: message.mode, details: message.details }; pendingInput = null; renderAction(); }
      if (message.type === "formInterrupted" || message.type === "shutdown") { pendingInput = null; pendingConfirmation = null; renderAction(); }
      if (message.type === "error") logs.textContent += (logs.textContent ? "\\n" : "") + "[protocol] " + message.message;
    };
    document.getElementById("exit").onclick = () => send({ type: "exit" });
  </script>
</body>
</html>`;
}

function acceptKey(key: string): string {
  return createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
}

function encodeFrame(payload: string): Buffer {
  const data = Buffer.from(payload);
  if (data.length < 126) {
    return Buffer.concat([Buffer.from([0x81, data.length]), data]);
  }
  if (data.length <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
    return Buffer.concat([header, data]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(data.length), 2);
  return Buffer.concat([header, data]);
}

function decodeFrames(buffer: Buffer<ArrayBufferLike>): { messages: string[]; rest: Buffer<ArrayBufferLike>; close: boolean } {
  const messages: string[] = [];
  let offset = 0;
  let close = false;
  while (buffer.length - offset >= 2) {
    const first = buffer[offset] ?? 0;
    const second = buffer[offset + 1] ?? 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let headerLength = 2;
    if (length === 126) {
      if (buffer.length - offset < 4) {
        break;
      }
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (buffer.length - offset < 10) {
        break;
      }
      const longLength = buffer.readBigUInt64BE(offset + 2);
      if (longLength > BigInt(Number.MAX_SAFE_INTEGER)) {
        close = true;
        break;
      }
      length = Number(longLength);
      headerLength = 10;
    }
    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + length;
    if (buffer.length - offset < frameLength) {
      break;
    }
    if (opcode === 0x8) {
      close = true;
      offset += frameLength;
      continue;
    }
    if (opcode === 0x1) {
      const mask = masked ? buffer.subarray(offset + headerLength, offset + headerLength + 4) : null;
      const payload = Buffer.from(buffer.subarray(offset + headerLength + maskLength, offset + frameLength));
      if (mask) {
        for (let index = 0; index < payload.length; index += 1) {
          payload[index] = (payload[index] ?? 0) ^ (mask[index % 4] ?? 0);
        }
      }
      messages.push(payload.toString("utf8"));
    }
    offset += frameLength;
  }
  return { messages, rest: buffer.subarray(offset), close };
}

function defaultOpenBrowser(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const platform = process.platform;
    const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
    const args = platform === "win32" ? ["/c", "start", "", url] : [url];
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export async function startWebServer(options: WebServerOptions): Promise<StartedWebServer> {
  const clients = new Set<WebSocketClient>();
  const sockets = new Set<Duplex>();
  const host = options.host?.trim() || "127.0.0.1";
  let closed = false;
  const server = http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(htmlShell());
      return;
    }
    if (request.method === "GET" && request.url === "/__agentweaver/health") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (request.method === "POST" && request.url === "/__agentweaver/exit") {
      response.writeHead(202, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true }));
      options.onExitRequested();
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  });

  server.on("connection", (socket: Duplex) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => sockets.delete(socket));
  });

  server.on("upgrade", (request: IncomingMessage, socket: Duplex) => {
    if (request.url !== "/__agentweaver/ws") {
      socket.destroy();
      return;
    }
    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.destroy();
      return;
    }
    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptKey(key)}`,
      "",
      "",
    ].join("\r\n"));

    let buffered: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    const client: WebSocketClient = {
      socket,
      send: (message) => {
        if (!socket.destroyed) {
          socket.write(encodeFrame(JSON.stringify(message)));
        }
      },
      close: () => {
        if (!socket.destroyed) {
          socket.end(Buffer.from([0x88, 0x00]));
          socket.destroy();
        }
      },
    };
    clients.add(client);
    socket.on("data", (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      const decoded = decodeFrames(buffered);
      buffered = decoded.rest;
      if (decoded.close) {
        client.close();
        return;
      }
      for (const message of decoded.messages) {
        try {
          options.onClientAction(parseWebClientAction(message));
        } catch (error) {
          client.send({ type: "error", message: (error as Error).message });
        }
      }
    });
    socket.on("close", () => clients.delete(client));
    socket.on("error", () => clients.delete(client));
    options.onClientConnected(client);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string" || typeof address.port !== "number" || address.port <= 0) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Unable to determine assigned Web UI port.");
  }

  const url = `http://${host}:${address.port}/`;
  process.stdout.write(`AgentWeaver Web UI: ${url}\n`);
  if (!options.noOpen) {
    try {
      await (options.openBrowser ?? defaultOpenBrowser)(url);
    } catch (error) {
      options.printInfo?.(`Warning: failed to open browser: ${(error as Error).message}`);
    }
  }

  return {
    url,
    host,
    broadcast(message) {
      for (const client of clients) {
        client.send(message);
      }
    },
    close: async () => {
      if (closed) {
        return;
      }
      closed = true;
      for (const client of clients) {
        client.send({ type: "shutdown" });
        client.close();
      }
      clients.clear();
      for (const socket of sockets) {
        if (!socket.destroyed) {
          socket.destroy();
        }
      }
      sockets.clear();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
