import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");

let tempRoot;
let flowCatalogModule;

function writeProjectFlow(repoDir, relativeFilePath) {
  const filePath = path.join(repoDir, ".agentweaver", ".flows", relativeFilePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify({
    kind: "custom-flow",
    version: 1,
    phases: [],
  }, null, 2)}\n`, "utf8");
}

beforeEach(async () => {
  tempRoot = mkdtempSync(path.join(os.tmpdir(), "agentweaver-flow-catalog-"));
  flowCatalogModule = await import(
    `${pathToFileURL(path.join(distRoot, "pipeline/flow-catalog.js")).href}?catalog=${Date.now()}`
  );
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("flow routing keys", () => {
  it("keeps project-local flow defaults distinct across repositories with the same repo-local id", async () => {
    const firstRepo = path.join(tempRoot, "repo-a");
    const secondRepo = path.join(tempRoot, "repo-b");
    writeProjectFlow(firstRepo, "review/fix.json");
    writeProjectFlow(secondRepo, "review/fix.json");

    const firstEntry = (await flowCatalogModule.loadInteractiveFlowCatalog(firstRepo)).find((entry) => entry.source === "project-local");
    const secondEntry = (await flowCatalogModule.loadInteractiveFlowCatalog(secondRepo)).find((entry) => entry.source === "project-local");

    assert.ok(firstEntry, "first project-local flow should exist");
    assert.ok(secondEntry, "second project-local flow should exist");
    assert.equal(firstEntry.id, secondEntry.id);
    assert.notEqual(
      flowCatalogModule.flowRoutingKey(firstEntry),
      flowCatalogModule.flowRoutingKey(secondEntry),
    );
  });
});
