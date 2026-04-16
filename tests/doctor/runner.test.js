import { describe, it } from "node:test";
import { ok, equal, notEqual } from "node:assert";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DIST_INDEX = path.resolve(process.cwd(), "dist/index.js");
const DOCTOR_MODULE_URL = pathToFileURL(path.resolve(process.cwd(), "dist/doctor/index.js")).href;

async function runDoctorInProcess(args) {
  const { runDoctorCommand } = await import(DOCTOR_MODULE_URL);
  const originalWrite = process.stdout.write.bind(process.stdout);
  let stdout = "";
  process.stdout.write = ((chunk, encoding, callback) => {
    stdout += typeof chunk === "string" ? chunk : chunk.toString(typeof encoding === "string" ? encoding : undefined);
    if (typeof encoding === "function") {
      encoding();
    }
    if (typeof callback === "function") {
      callback();
    }
    return true;
  });

  try {
    const exitCode = await runDoctorCommand(args);
    return { exitCode, stdout, stderr: "" };
  } finally {
    process.stdout.write = originalWrite;
  }
}

async function runDoctor(args) {
  const result = spawnSync("node", [DIST_INDEX, "doctor", ...args], {
    encoding: "utf8",
    timeout: 10000,
  });
  if (result.error?.code === "EPERM") {
    return runDoctorInProcess(args);
  }
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("doctor command", () => {
  it("runs and produces output", async () => {
    const result = await runDoctor([]);
    notEqual(result.exitCode, -1, "process should have exited");
    ok(result.stdout.length > 0, "should have output");
  });

  it("outputs grouped sections in text mode", async () => {
    const result = await runDoctor([]);
    const output = result.stdout;
    ok(output.includes("## System"), "should have System section");
    ok(output.includes("Overall:"), "should include overall readiness line");
  });

  it("outputs JSON structure with --json", async () => {
    const result = await runDoctor(["--json"]);
    let report;
    try {
      report = JSON.parse(result.stdout);
    } catch {
      throw new Error(`Failed to parse JSON: ${result.stdout}\nStderr: ${result.stderr}`);
    }
    ok(typeof report.overall === "string");
    ok(Array.isArray(report.checks));
    ok(typeof report.timestamp === "string");
  });

  it("JSON has stable structure with keys: overall, checks, timestamp", async () => {
    const result = await runDoctor(["--json"]);
    const report = JSON.parse(result.stdout);
    const keys = Object.keys(report).sort();
    equal(keys.join(","), "checks,overall,timestamp");
  });

  it("accepts category filter", async () => {
    const result = await runDoctor(["system"]);
    notEqual(result.exitCode, -1);
    ok(result.stdout.includes("System"));
  });

  it("exits 0 for ready_with_warnings", async () => {
    const result = await runDoctor(["--json"]);
    const report = JSON.parse(result.stdout);
    if (report.overall === "ready_with_warnings") {
      equal(result.exitCode, 0);
    }
  });

  it("uses an exit code that matches overall readiness", async () => {
    const result = await runDoctor(["--json"]);
    const report = JSON.parse(result.stdout);
    equal(result.exitCode, report.overall === "not_ready" ? 1 : 0);
  });
});
