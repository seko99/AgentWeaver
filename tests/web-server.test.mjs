import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { startWebServer } = await import(
  pathToFileURL(path.join(distRoot, "interactive/web/server.js")).href
);

async function startOrSkip(t, options) {
  try {
    return await startWebServer(options);
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("local TCP listeners are not permitted in this sandbox");
      return null;
    }
    throw error;
  }
}

function portFromUrl(url) {
  return Number(new URL(url).port);
}

async function connectWebSocket(url) {
  const parsed = new URL(url);
  const socket = net.createConnection({ host: parsed.hostname, port: Number(parsed.port) });
  await new Promise((resolve) => socket.once("connect", resolve));
  socket.write([
    "GET /__agentweaver/ws HTTP/1.1",
    `Host: ${parsed.host}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString("base64")}`,
    "Sec-WebSocket-Version: 13",
    "",
    "",
  ].join("\r\n"));
  await new Promise((resolve) => {
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.includes("\r\n\r\n")) {
        resolve();
      }
    });
  });
  return socket;
}

describe("web server", () => {
  it("starts on 127.0.0.1 with an assigned port and serves shell plus health", async (t) => {
    const server = await startOrSkip(t, {
      noOpen: true,
      onClientAction: () => {},
      onClientConnected: () => {},
      onExitRequested: () => {},
    });
    if (!server) return;
    try {
      assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
      assert.equal(server.host, "127.0.0.1");
      assert.ok(portFromUrl(server.url) > 0);

      const root = await fetch(server.url);
      assert.equal(root.status, 200);
      assert.match(await root.text(), /AgentWeaver Web UI/);

      const health = await fetch(new URL("/__agentweaver/health", server.url));
      assert.equal(health.status, 200);
      assert.deepEqual(await health.json(), { ok: true });
    } finally {
      await server.close();
    }
  });

  it("supports deterministic exit requests and concurrent assigned ports", async (t) => {
    let exitCount = 0;
    let first;
    let second;
    try {
      [first, second] = await Promise.all([
        startOrSkip(t, {
          noOpen: true,
          onClientAction: () => {},
          onClientConnected: () => {},
          onExitRequested: () => {
            exitCount += 1;
          },
        }),
        startOrSkip(t, {
          noOpen: true,
          onClientAction: () => {},
          onClientConnected: () => {},
          onExitRequested: () => {
            exitCount += 1;
          },
        }),
      ]);
    } catch (error) {
      if (first) await first.close();
      if (second) await second.close();
      throw error;
    }
    if (!first || !second) return;
    try {
      assert.notEqual(portFromUrl(first.url), portFromUrl(second.url));
      const response = await fetch(new URL("/__agentweaver/exit", first.url), { method: "POST" });
      assert.equal(response.status, 202);
      assert.equal(exitCount, 1);
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });

  it("reports browser opener failures without failing startup", async (t) => {
    const warnings = [];
    const server = await startOrSkip(t, {
      noOpen: false,
      openBrowser: async () => {
        throw new Error("open failed");
      },
      printInfo: (message) => warnings.push(message),
      onClientAction: () => {},
      onClientConnected: () => {},
      onExitRequested: () => {},
    });
    try {
      assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
      assert.match(warnings.join("\n"), /failed to open browser: open failed/);
    } finally {
      await server.close();
    }
  });

  it("closes promptly with a connected WebSocket client", async (t) => {
    const server = await startOrSkip(t, {
      noOpen: true,
      onClientAction: () => {},
      onClientConnected: () => {},
      onExitRequested: () => {},
    });
    if (!server) return;
    const socket = await connectWebSocket(server.url);
    try {
      await server.close();
      assert.equal(socket.destroyed, true);
    } finally {
      socket.destroy();
    }
  });

  it("can bind to all interfaces when explicitly requested", async (t) => {
    const server = await startOrSkip(t, {
      host: "0.0.0.0",
      noOpen: true,
      onClientAction: () => {},
      onClientConnected: () => {},
      onExitRequested: () => {},
    });
    if (!server) return;
    try {
      assert.match(server.url, /^http:\/\/0\.0\.0\.0:\d+\/$/);
      assert.equal(server.host, "0.0.0.0");
      const health = await fetch(`http://127.0.0.1:${portFromUrl(server.url)}/__agentweaver/health`);
      assert.equal(health.status, 200);
    } finally {
      await server.close();
    }
  });
});
