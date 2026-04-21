import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");
const guide = readFileSync(path.join(repoRoot, "docs", "plugin-sdk.md"), "utf8");

describe("plugin sdk docs", () => {
  it("documents the supported public import boundary in README", () => {
    assert.match(readme, /## Plugin SDK/);
    assert.match(readme, /agentweaver\/plugin-sdk/);
    assert.match(readme, /\.agentweaver\/\.plugins\/<plugin-id>\/plugin\.json/);
    assert.match(readme, /agentweaver\/dist\/\*/);
    assert.match(readme, /agentweaver\/src\/\*/);
    assert.match(readme, /\[docs\/plugin-sdk\.md\]\(docs\/plugin-sdk\.md\)/);
  });

  it("covers the key public SDK contracts in the guide", () => {
    assert.match(guide, /# AgentWeaver Plugin SDK/);
    assert.match(guide, /## Architecture Overview/);
    assert.match(guide, /## Manifest Contract/);
    assert.match(guide, /## Entrypoint Rules/);
    assert.match(guide, /## Executor Contract/);
    assert.match(guide, /## Node Contract/);
    assert.match(guide, /## Wiring a Project-Local Flow/);
    assert.match(guide, /## Compatibility and Versioning/);
    assert.match(guide, /## Testing Workflow for Plugin Authors/);
    assert.match(guide, /## Troubleshooting/);
    assert.match(guide, /agentweaver\/plugin-sdk/);
    assert.match(guide, /named `executors` and\/or `nodes` arrays/);
    assert.match(guide, /`required`, `allowed`, or `forbidden`/);
    assert.match(guide, /\.agentweaver\/\.flows\/\*\*\/\*\.json/);
  });
});
