import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { ensureSummaryJsonNode } = await import(
  pathToFileURL(path.join(distRoot, "pipeline/nodes/ensure-summary-json-node.js")).href
);

let tempDir;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), "agentweaver-ensure-summary-json-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("ensureSummaryJsonNode", () => {
  it("creates a summary JSON artifact from markdown when the model skipped it", async () => {
    const markdownFile = path.join(tempDir, "jira-description-demo-1.md");
    const outputFile = path.join(tempDir, ".artifacts", "jira-description-demo-1.json");

    writeFileSync(
      markdownFile,
      "# Problem\n\n**Users** cannot filter archived items.\n\n## Acceptance criteria\n\n- Add a visible filter.\n",
      "utf8",
    );

    const result = await ensureSummaryJsonNode.run({}, { markdownFile, outputFile });
    const parsed = JSON.parse(readFileSync(outputFile, "utf8"));

    assert.equal(result.value.created, true);
    assert.equal(result.value.repaired, false);
    assert.equal(result.outputs?.[0]?.manifest?.logicalKey, "artifacts/jira-description-demo.json");
    assert.equal(parsed.summary.includes("Problem"), true);
    assert.equal(parsed.summary.includes("Users cannot filter archived items."), true);
    assert.equal(parsed.summary.includes("Acceptance criteria"), true);
  });

  it("repairs an invalid summary JSON artifact from the markdown companion", async () => {
    const markdownFile = path.join(tempDir, "jira-description-demo-2.md");
    const outputFile = path.join(tempDir, ".artifacts", "jira-description-demo-2.json");

    writeFileSync(markdownFile, "Problem\n\nExisting markdown summary.\n", "utf8");
    mkdirSync(path.dirname(outputFile), { recursive: true });
    writeFileSync(outputFile, "{\"summary\": \"\"}\n", "utf8");

    const result = await ensureSummaryJsonNode.run({}, { markdownFile, outputFile });
    const parsed = JSON.parse(readFileSync(outputFile, "utf8"));

    assert.equal(result.value.created, false);
    assert.equal(result.value.repaired, true);
    assert.equal(result.outputs?.[0]?.manifest?.logicalKey, "artifacts/jira-description-demo.json");
    assert.equal(parsed.summary, "Problem\n\nExisting markdown summary.");
  });
});
