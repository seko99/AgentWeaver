import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");

let originalHome;
let tempHome;
let storeModule;
let routingModule;

beforeEach(async () => {
  originalHome = process.env.HOME;
  tempHome = mkdtempSync(path.join(os.tmpdir(), "agentweaver-routing-home-"));
  process.env.HOME = tempHome;
  routingModule = await import(
    `${pathToFileURL(path.join(distRoot, "runtime/execution-routing.js")).href}?home=${Date.now()}`
  );
  storeModule = await import(
    `${pathToFileURL(path.join(distRoot, "runtime/execution-routing-store.js")).href}?home=${Date.now()}`
  );
});

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  rmSync(tempHome, { recursive: true, force: true });
});

describe("execution routing store", () => {
  it("saves and reloads named presets, flow defaults, and last-used snapshots", () => {
    const routing = routingModule.resolveExecutionRouting({ presetId: "balanced" });
    const namedPreset = { kind: "named", presetId: "balanced-local", label: "Named preset: balanced-local" };
    const flowDefault = { kind: "flow-default", label: "Flow default" };
    const lastUsed = { kind: "last-used", label: "Last used" };

    storeModule.saveNamedExecutionPreset("balanced-local", routing, namedPreset);
    storeModule.saveFlowDefaultExecutionRouting("built-in:auto-golang", routing, flowDefault);
    storeModule.saveLastUsedExecutionRouting("built-in:auto-golang", routing, lastUsed);

    const storeFile = storeModule.executionRoutingStoreFile();
    assert.equal(existsSync(storeFile), true);

    const raw = JSON.parse(readFileSync(storeFile, "utf8"));
    assert.equal(raw.version, 1);
    assert.equal(raw.namedPresets["balanced-local"].routing.fingerprint, routing.fingerprint);
    assert.equal(raw.flowDefaults["built-in:auto-golang"].selectedPreset.label, "Flow default");
    assert.equal(raw.lastUsedByFlow["built-in:auto-golang"].selectedPreset.label, "Last used");

    const reloadedPreset = storeModule.getNamedExecutionPresets()["balanced-local"];
    const reloadedDefault = storeModule.getFlowDefaultExecutionRouting("built-in:auto-golang");
    const reloadedLastUsed = storeModule.getLastUsedExecutionRouting("built-in:auto-golang");

    assert.equal(reloadedPreset.routing.fingerprint, routing.fingerprint);
    assert.equal(reloadedDefault.routing.fingerprint, routing.fingerprint);
    assert.equal(reloadedLastUsed.routing.fingerprint, routing.fingerprint);
  });

  it("fails with a recovery message when the store is corrupted", () => {
    const storeFile = storeModule.executionRoutingStoreFile();
    mkdirSync(path.dirname(storeFile), { recursive: true });
    writeFileSync(storeFile, "{not-json\n", "utf8");

    assert.throws(
      () => storeModule.loadExecutionRoutingStore(),
      /Delete or repair the file and try again/,
    );
  });
});
