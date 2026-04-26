import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";

const cliPath = path.resolve(process.cwd(), "dist/index.js");

function runCli(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function runBoundedWeb(args = [], env = {}) {
  const child = spawn(process.execPath, [cliPath, "web", ...args], {
    env: { ...process.env, AGENTWEAVER_WEB_NO_OPEN: "1", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  const urlPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for URL. stdout=${stdout} stderr=${stderr}`)), 10000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const match = stdout.match(/AgentWeaver Web UI: (http:\/\/(?:127\.0\.0\.1|0\.0\.0\.0):\d+\/)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      reject(Object.assign(new Error(`Web command exited before URL. stdout=${stdout} stderr=${stderr}`), { code, stdout, stderr }));
    });
  });
  const url = await urlPromise;
  const healthUrl = new URL("/__agentweaver/health", url);
  if (healthUrl.hostname === "0.0.0.0") {
    healthUrl.hostname = "127.0.0.1";
  }
  const health = await fetch(healthUrl);
  assert.equal(health.status, 200);
  const exitUrl = new URL("/__agentweaver/exit", healthUrl);
  await fetch(exitUrl, { method: "POST" });
  const code = await new Promise((resolve) => child.on("close", resolve));
  return { code, stdout, stderr, url };
}

describe("web CLI", () => {
  it("documents web usage and no-open automation", async () => {
    const result = await runCli(["--help"]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /agentweaver web \[--no-open\] \[--host <host>\|--listen-all\] \[<jira-browse-url\|jira-issue-key>\]/);
    assert.match(result.stdout, /--listen-all/);
    assert.match(result.stdout, /AGENTWEAVER_WEB_NO_OPEN/);
  });

  it("rejects unsupported web flag placement", async () => {
    const beforeWeb = await runCli(["--no-open", "web"]);
    assert.equal(beforeWeb.code, 1);
    assert.match(beforeWeb.stderr, /--no-open is only supported after the web command/);

    const nonWeb = await runCli(["plan", "--no-open"]);
    assert.equal(nonWeb.code, 1);
    assert.match(nonWeb.stderr, /--no-open is only supported after the web command/);

    const nonWebHost = await runCli(["plan", "--host", "0.0.0.0"]);
    assert.equal(nonWebHost.code, 1);
    assert.match(nonWebHost.stderr, /--host is only supported after the web command/);
  });

  it("starts a bounded web command with no-open and exits through HTTP", async (t) => {
    let result;
    try {
      result = await runBoundedWeb(["--no-open"]);
    } catch (error) {
      const combinedOutput = `${error.stdout ?? ""}\n${error.stderr ?? ""}\n${error.message ?? ""}`;
      if (combinedOutput.includes("listen EPERM")) {
        t.skip("local TCP listeners are not permitted in this sandbox");
        return;
      }
      throw error;
    }
    assert.equal(result.code, 0);
    assert.match(result.stdout, /AgentWeaver Web UI: http:\/\/127\.0\.0\.1:\d+\//);
  });

  it("starts a bounded web command on all interfaces", async (t) => {
    let result;
    try {
      result = await runBoundedWeb(["--no-open", "--listen-all"]);
    } catch (error) {
      const combinedOutput = `${error.stdout ?? ""}\n${error.stderr ?? ""}\n${error.message ?? ""}`;
      if (combinedOutput.includes("listen EPERM")) {
        t.skip("local TCP listeners are not permitted in this sandbox");
        return;
      }
      throw error;
    }
    assert.equal(result.code, 0);
    assert.match(result.stdout, /AgentWeaver Web UI: http:\/\/0\.0\.0\.0:\d+\//);
  });
});
