import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { createWebInteractiveSession } = await import(
  pathToFileURL(path.join(distRoot, "interactive/web/index.js")).href
);

function createOptions(overrides = {}) {
  return {
    scopeKey: "ag-107",
    jiraIssueKey: "AG-107",
    summaryText: "Initial summary",
    cwd: process.cwd(),
    gitBranchName: "feature/web",
    version: "0.1.17",
    flows: [
      {
        id: "plan",
        label: "Plan",
        description: "Plan work.",
        source: "built-in",
        treePath: ["default", "plan"],
        phases: [],
      },
    ],
    getRunConfirmation: async () => ({
      hasExistingState: false,
      resume: { available: false, reason: "No state." },
      continue: { available: false, reason: "No state." },
      restart: { available: true, reason: "Run." },
    }),
    onRun: async () => {},
    onInterrupt: async () => {},
    onExit: () => {},
    ...overrides,
  };
}

function encodeClientFrame(message) {
  const payload = Buffer.from(JSON.stringify(message));
  const mask = crypto.randomBytes(4);
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, 0x80 | payload.length]);
  } else {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  }
  const masked = Buffer.from(payload);
  for (let index = 0; index < masked.length; index += 1) {
    masked[index] = masked[index] ^ mask[index % 4];
  }
  return Buffer.concat([header, mask, masked]);
}

function decodeServerFrames(buffer) {
  const messages = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const second = buffer[offset + 1];
    let length = second & 0x7f;
    let headerLength = 2;
    if (length === 126) {
      if (buffer.length - offset < 4) break;
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    }
    if (buffer.length - offset < headerLength + length) break;
    const opcode = buffer[offset] & 0x0f;
    if (opcode === 1) {
      messages.push(JSON.parse(buffer.subarray(offset + headerLength, offset + headerLength + length).toString("utf8")));
    }
    offset += headerLength + length;
  }
  return { messages, rest: buffer.subarray(offset) };
}

async function connectWebSocket(url) {
  const parsed = new URL(url);
  const socket = net.createConnection({ host: parsed.hostname, port: Number(parsed.port) });
  await new Promise((resolve) => socket.once("connect", resolve));
  const key = crypto.randomBytes(16).toString("base64");
  socket.write([
    "GET /__agentweaver/ws HTTP/1.1",
    `Host: ${parsed.host}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${key}`,
    "Sec-WebSocket-Version: 13",
    "",
    "",
  ].join("\r\n"));

  let buffer = Buffer.alloc(0);
  const queue = [];
  let resolveNext;
  await new Promise((resolve) => {
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd !== -1) {
        buffer = buffer.subarray(headerEnd + 4);
        resolve();
      }
    });
  });
  socket.removeAllListeners("data");
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const decoded = decodeServerFrames(buffer);
    buffer = decoded.rest;
    queue.push(...decoded.messages);
    if (resolveNext && queue.length > 0) {
      const resolve = resolveNext;
      resolveNext = null;
      resolve(queue.shift());
    }
  });

  return {
    send: (message) => socket.write(encodeClientFrame(message)),
    nextMessage: async () => {
      if (queue.length > 0) return queue.shift();
      return await new Promise((resolve) => {
        resolveNext = resolve;
      });
    },
    close: () => socket.destroy(),
  };
}

describe("web interactive session", () => {
  it("streams state updates and resolves user input through WebSocket actions", async (t) => {
    let ready;
    let runResolve;
    const runPromise = new Promise((resolve) => {
      runResolve = resolve;
    });
    const readyPromise = new Promise((resolve) => {
      ready = resolve;
    });
    const session = createWebInteractiveSession(createOptions({
      onRun: async (flowId, mode) => runResolve({ flowId, mode }),
    }), {
      noOpen: true,
      onServerReady: ready,
    });
    session.mount();
    const server = await Promise.race([
      readyPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), 1000)),
    ]);
    if (!server) {
      t.skip("local TCP listeners are not permitted in this sandbox");
      session.destroy();
      return;
    }
    const client = await connectWebSocket(server.url);
    try {
      const snapshot = await client.nextMessage();
      assert.equal(snapshot.type, "snapshot");
      assert.equal(snapshot.state.scopeKey, "ag-107");
      assert.equal(snapshot.state.summaryText, "Initial summary");
      assert.equal(snapshot.state.flows[0].id, "plan");

      session.setScope("ag-108", "AG-108");
      assert.deepEqual(await client.nextMessage(), { type: "scopeUpdated", scopeKey: "ag-108", jiraIssueKey: "AG-108" });
      session.setSummary("Next summary");
      assert.deepEqual(await client.nextMessage(), { type: "summaryUpdated", markdown: "Next summary" });
      session.appendLog("hello");
      assert.deepEqual(await client.nextMessage(), { type: "logAppended", text: "hello" });
      session.setFlowFailed("plan");
      assert.deepEqual(await client.nextMessage(), { type: "flowFailed", flowId: "plan" });

      client.send({ type: "requestRun", flowId: "plan" });
      const confirmation = await client.nextMessage();
      assert.equal(confirmation.type, "confirmationRequested");
      assert.equal(confirmation.flowId, "plan");
      assert.equal(confirmation.mode, "restart");
      client.send({ type: "confirmRun", requestId: confirmation.requestId });
      assert.deepEqual(await runPromise, { flowId: "plan", mode: "restart" });

      const inputPromise = session.requestUserInput({
        formId: "demo",
        title: "Demo",
        fields: [{ id: "name", type: "text", label: "Name", required: true }],
      });
      const requested = await client.nextMessage();
      assert.equal(requested.type, "inputRequested");
      client.send({ type: "submitInput", requestId: requested.requestId, values: { name: "Ada" } });
      const result = await inputPromise;
      assert.equal(result.formId, "demo");
      assert.equal(result.values.name, "Ada");
    } finally {
      client.close();
      session.destroy();
    }
  });

  it("cancels pending input deterministically", async (t) => {
    let ready;
    const readyPromise = new Promise((resolve) => {
      ready = resolve;
    });
    const session = createWebInteractiveSession(createOptions(), {
      noOpen: true,
      onServerReady: (server) => ready(server),
    });
    session.mount();
    const server = await Promise.race([
      readyPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), 1000)),
    ]);
    if (!server) {
      t.skip("local TCP listeners are not permitted in this sandbox");
      session.destroy();
      return;
    }
    const client = await connectWebSocket(server.url);
    try {
      await client.nextMessage();
      const inputPromise = session.requestUserInput({
        formId: "demo",
        title: "Demo",
        fields: [{ id: "name", type: "text", label: "Name", required: true }],
      });
      const requested = await client.nextMessage();
      client.send({ type: "cancelInput", requestId: requested.requestId });
      await assert.rejects(inputPromise, /User cancelled form 'demo'/);
      const interrupted = await client.nextMessage();
      assert.equal(interrupted.type, "formInterrupted");
      assert.equal(interrupted.requestId, requested.requestId);
    } finally {
      client.close();
      session.destroy();
    }
  });

  it("closes startup server if the session is destroyed before opener resolves", async (t) => {
    let resolveOpen;
    let serverReady = false;
    const openPromise = new Promise((resolve) => {
      resolveOpen = resolve;
    });
    const session = createWebInteractiveSession(createOptions(), {
      noOpen: false,
      openBrowser: async () => {
        await openPromise;
      },
      onServerReady: () => {
        serverReady = true;
      },
    });
    session.mount();
    await new Promise((resolve) => setTimeout(resolve, 50));
    session.destroy();
    resolveOpen();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(serverReady, false);
  });
});
