import { describe, it } from "node:test";
import { ok, equal, notEqual } from "node:assert";
import { spawnSync } from "node:child_process";
import path from "node:path";

const DIST_INDEX = path.resolve(process.cwd(), "dist/index.js");

function runDoctor(args) {
  const result = spawnSync("node", [DIST_INDEX, "doctor", ...args], {
    encoding: "utf8",
    timeout: 10000,
  });
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("doctor command", () => {
  it("runs and produces output", () => {
    const result = runDoctor([]);
    notEqual(result.exitCode, -1, "process should have exited");
    ok(result.stdout.length > 0, "should have output");
  });

  it("outputs grouped sections in text mode", () => {
    const result = runDoctor([]);
    const output = result.stdout;
    ok(output.includes("## System"), "should have System section");
    ok(output.includes("## Executors"), "should have Executors section");
  });

  it("outputs JSON structure with --json", () => {
    const result = runDoctor(["--json"]);
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

  it("JSON has stable structure with keys: overall, checks, timestamp", () => {
    const result = runDoctor(["--json"]);
    const report = JSON.parse(result.stdout);
    const keys = Object.keys(report).sort();
    equal(keys.join(","), "checks,overall,timestamp");
  });

  it("accepts category filter", () => {
    const result = runDoctor(["system"]);
    notEqual(result.exitCode, -1);
    ok(result.stdout.includes("System"));
  });

  it("exits 0 for ready_with_warnings", () => {
    const result = runDoctor(["--json"]);
    const report = JSON.parse(result.stdout);
    if (report.overall === "ready_with_warnings") {
      equal(result.exitCode, 0);
    }
  });
});