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
    assert.match(readme, /claude-example-plugin/);
    assert.match(readme, /docs\/examples\/\.flows\/claude-example\.json/);
  });

  it("covers the key public SDK contracts in the guide", () => {
    assert.match(guide, /# AgentWeaver Plugin SDK/);
    assert.match(guide, /## Architecture Overview/);
    assert.match(guide, /## Manifest Contract/);
    assert.match(guide, /## Entrypoint Rules/);
    assert.match(guide, /## Executor Contract/);
    assert.match(guide, /## Node Contract/);
    assert.match(guide, /## Wiring a Custom Flow/);
    assert.match(guide, /## Claude Example Plugin/);
    assert.match(guide, /## Compatibility and Versioning/);
    assert.match(guide, /## Testing Workflow for Plugin Authors/);
    assert.match(guide, /## Troubleshooting/);
    assert.match(guide, /agentweaver\/plugin-sdk/);
    assert.match(guide, /named `executors` and\/or `nodes` arrays/);
    assert.match(guide, /`required`, `allowed`, or `forbidden`/);
    assert.match(guide, /\.agentweaver\/\.flows\/\*\*\/\*\.json/);
    assert.match(guide, /claude -p <prompt> --output-format json/);
    assert.match(guide, /CLAUDE_BIN/);
    assert.match(guide, /CLAUDE_MODEL/);
    assert.match(guide, /CLAUDE_MAX_TURNS/);
    assert.match(guide, /message\.content\[\*\]\.text/);
    assert.match(guide, /content\[\*\]\.text/);
    assert.match(guide, /llm-prompt/);
    assert.match(guide, /artifacts\/examples\/claude-example-proof\.json/);
    assert.match(guide, /claude auth status/);
  });
});
