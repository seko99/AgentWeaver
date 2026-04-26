import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";

const cliPath = path.resolve(process.cwd(), "dist/index.js");
const WEB_AUTH_ENV = {
  AGENTWEAVER_WEB_USERNAME: "operator",
  AGENTWEAVER_WEB_PASSWORD: "secret-pass",
};

function cliEnv(overrides = {}) {
  const env = { ...process.env };
  delete env.AGENTWEAVER_WEB_USERNAME;
  delete env.AGENTWEAVER_WEB_PASSWORD;
  return { ...env, ...overrides };
}

function basicAuthHeader() {
  return `Basic ${Buffer.from(`${WEB_AUTH_ENV.AGENTWEAVER_WEB_USERNAME}:${WEB_AUTH_ENV.AGENTWEAVER_WEB_PASSWORD}`).toString("base64")}`;
}

function runCli(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      env: cliEnv(options.env ?? {}),
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
    env: cliEnv({ AGENTWEAVER_WEB_NO_OPEN: "1", ...env }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  const urlPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for URL. stdout=${stdout} stderr=${stderr}`)), 10000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const match = stdout.match(/AgentWeaver Web UI: (http:\/\/(?:127\.0\.0\.1|0\.0\.0\.0|localhost|\[::1\]):\d+\/)/);
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
  const exitHeaders = env.AGENTWEAVER_WEB_USERNAME && env.AGENTWEAVER_WEB_PASSWORD ? { authorization: basicAuthHeader() } : {};
  await fetch(exitUrl, { method: "POST", headers: exitHeaders });
  const code = await new Promise((resolve) => child.on("close", resolve));
  return { code, stdout, stderr, url };
}

async function assertWebFailsWithoutAuth(args) {
  const result = await runCli(["web", "--no-open", ...args]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /External Web UI binding requires AGENTWEAVER_WEB_USERNAME and AGENTWEAVER_WEB_PASSWORD/);
  assert.doesNotMatch(result.stdout, /AgentWeaver Web UI:/);
}

describe("web CLI", () => {
  it("documents web usage and no-open automation", async () => {
    const result = await runCli(["--help"]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /agentweaver web \[--no-open\] \[--host <host>\|--listen-all\] \[<jira-browse-url\|jira-issue-key>\]/);
    assert.match(result.stdout, /--listen-all/);
    assert.match(result.stdout, /AGENTWEAVER_WEB_NO_OPEN/);
    assert.match(result.stdout, /AGENTWEAVER_WEB_USERNAME/);
    assert.match(result.stdout, /AGENTWEAVER_WEB_PASSWORD/);
    assert.match(result.stdout, /Basic auth over plain HTTP is suitable only on trusted networks/);
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

    const nonWebListenAll = await runCli(["plan", "--listen-all"]);
    assert.equal(nonWebListenAll.code, 1);
    assert.match(nonWebListenAll.stderr, /--listen-all is only supported after the web command/);
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

  it("keeps explicit loopback hosts no-auth compatible", async (t) => {
    for (const host of ["127.0.0.1", "localhost", "::1"]) {
      let result;
      try {
        result = await runBoundedWeb(["--no-open", "--host", host]);
      } catch (error) {
        const combinedOutput = `${error.stdout ?? ""}\n${error.stderr ?? ""}\n${error.message ?? ""}`;
        if (combinedOutput.includes("listen EPERM") || combinedOutput.includes("EADDRNOTAVAIL")) {
          t.skip(`local TCP listener for ${host} is not available in this sandbox`);
          return;
        }
        throw error;
      }
      assert.equal(result.code, 0);
      if (host === "::1") {
        assert.match(result.stdout, /AgentWeaver Web UI: http:\/\/\[::1\]:\d+\//);
      } else {
        assert.match(result.stdout, new RegExp(`AgentWeaver Web UI: http://${host.replaceAll(".", "\\.")}:\\d+/`));
      }
    }
  });

  it("requires Web UI credentials for external host bindings", async () => {
    await assertWebFailsWithoutAuth(["--listen-all"]);
    await assertWebFailsWithoutAuth(["--host", "0.0.0.0"]);
    await assertWebFailsWithoutAuth(["--host", "::"]);
    await assertWebFailsWithoutAuth(["--host", "192.168.1.10"]);
    await assertWebFailsWithoutAuth(["--host", "2001:db8::1"]);
    await assertWebFailsWithoutAuth(["--host", "example.internal"]);
  });

  it("rejects partial Web UI credential configuration", async () => {
    const usernameOnly = await runCli(["web", "--no-open"], { env: { AGENTWEAVER_WEB_USERNAME: "operator" } });
    assert.equal(usernameOnly.code, 1);
    assert.match(usernameOnly.stderr, /Web UI auth requires both AGENTWEAVER_WEB_USERNAME and AGENTWEAVER_WEB_PASSWORD/);
    assert.doesNotMatch(usernameOnly.stderr, /operator/);

    const passwordOnly = await runCli(["web", "--no-open"], { env: { AGENTWEAVER_WEB_PASSWORD: "secret-pass" } });
    assert.equal(passwordOnly.code, 1);
    assert.match(passwordOnly.stderr, /Web UI auth requires both AGENTWEAVER_WEB_USERNAME and AGENTWEAVER_WEB_PASSWORD/);
    assert.doesNotMatch(passwordOnly.stderr, /secret-pass/);
  });

  it("starts a bounded authenticated web command on all interfaces", async (t) => {
    let result;
    try {
      result = await runBoundedWeb(["--no-open", "--listen-all"], WEB_AUTH_ENV);
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
