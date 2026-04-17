import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { readyToMergeFile } = await import(pathToFileURL(path.join(distRoot, "artifacts.js")).href);
const { clearReadyToMergeFile } = await import(pathToFileURL(path.join(distRoot, "runtime/ready-to-merge.js")).href);

const originalCwd = process.cwd();
let tempDir;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), "agentweaver-ready-to-merge-"));
  process.chdir(tempDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tempDir, { recursive: true, force: true });
});

describe("clearReadyToMergeFile", () => {
  it("removes an existing ready-to-merge marker", () => {
    const taskKey = "ag-31@test";
    const markerPath = readyToMergeFile(taskKey);
    mkdirSync(path.dirname(markerPath), { recursive: true });
    writeFileSync(markerPath, "stale marker\n", "utf8");

    assert.equal(clearReadyToMergeFile(taskKey), true);
    assert.equal(existsSync(markerPath), false);
  });

  it("returns false when the marker is absent", () => {
    assert.equal(clearReadyToMergeFile("ag-31@test"), false);
  });
});
