import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { validateArtifactManifest } = await import(
  pathToFileURL(path.join(distRoot, "artifact-manifest.js")).href
);
const { validateStructuredArtifactValue } = await import(
  pathToFileURL(path.join(distRoot, "structured-artifacts.js")).href
);

function makeManifest(overrides = {}) {
  return {
    artifact_id: "ag-77@test:artifacts/plan.json:v1",
    logical_key: "artifacts/plan.json",
    scope: "ag-77@test",
    run_id: "run-1",
    flow_id: "plan-flow",
    phase_id: "publish",
    step_id: "write_plan",
    kind: "artifact",
    version: 1,
    payload_family: "structured-json",
    schema_id: "implementation-plan/v1",
    schema_version: 1,
    created_at: "2026-04-18T12:00:00.000Z",
    producer: {
      node: "codex-prompt",
      executor: "codex",
      model: "gpt-5.4",
      summary: "codex-prompt via codex model gpt-5.4",
    },
    inputs: [
      {
        source: "manifest",
        path: "/tmp/input.json",
        artifact_id: "ag-77@test:artifacts/design.json:v1",
        logical_key: "artifacts/design.json",
        schema_id: "implementation-design/v1",
        schema_version: 1,
      },
    ],
    content_hash: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    status: "ready",
    payload_path: "/tmp/output.json",
    manifest_path: "/tmp/output.json.manifest.json",
    publication_key: "run-1:plan-flow:publish:write_plan:artifacts/plan.json",
    ...overrides,
  };
}

describe("artifact-manifest/v1", () => {
  it("accepts valid manifests across the initial payload-family catalog", () => {
    const structuredJson = makeManifest();
    const markdown = makeManifest({
      artifact_id: "ag-77@test:design.md:v1",
      logical_key: "design.md",
      payload_family: "markdown",
      schema_id: "markdown/v1",
      payload_path: "/tmp/design.md",
      manifest_path: "/tmp/design.md.manifest.json",
      publication_key: "run-1:plan-flow:publish:write_plan:design.md",
    });
    const plainText = makeManifest({
      artifact_id: "ag-77@test:git-diff.txt:v1",
      logical_key: "git-diff.txt",
      payload_family: "plain-text",
      schema_id: "plain-text/v1",
      payload_path: "/tmp/git-diff.txt",
      manifest_path: "/tmp/git-diff.txt.manifest.json",
      publication_key: "run-1:plan-flow:publish:write_plan:git-diff.txt",
    });
    const helperJson = makeManifest({
      artifact_id: "ag-77@test:artifacts/jira-task.json:v1",
      logical_key: "artifacts/jira-task.json",
      payload_family: "helper-json",
      schema_id: "helper-json/v1",
      payload_path: "/tmp/jira.json",
      manifest_path: "/tmp/jira.json.manifest.json",
      publication_key: "run-1:plan-flow:publish:write_plan:artifacts/jira-task.json",
    });
    const opaqueFile = makeManifest({
      artifact_id: "ag-77@test:blob.bin:v1",
      logical_key: "blob.bin",
      payload_family: "opaque-file",
      schema_id: "opaque-file/v1",
      payload_path: "/tmp/blob.bin",
      manifest_path: "/tmp/blob.bin.manifest.json",
      publication_key: "run-1:plan-flow:publish:write_plan:blob.bin",
    });

    assert.doesNotThrow(() => validateArtifactManifest(structuredJson, "$.structured_json"));
    assert.doesNotThrow(() => validateArtifactManifest(markdown, "$.markdown"));
    assert.doesNotThrow(() => validateArtifactManifest(plainText, "$.plain_text"));
    assert.doesNotThrow(() => validateArtifactManifest(helperJson, "$.helper_json"));
    assert.doesNotThrow(() => validateArtifactManifest(opaqueFile, "$.opaque_file"));
  });

  it("rejects missing required fields and unsupported enum values", () => {
    assert.throws(
      () => validateStructuredArtifactValue({ logical_key: "artifacts/plan.json" }, "artifact-manifest/v1", "$"),
      /artifact_id/,
    );

    assert.throws(
      () => validateStructuredArtifactValue(makeManifest({ status: "broken" }), "artifact-manifest/v1", "$"),
      /status/,
    );

    assert.throws(
      () =>
        validateStructuredArtifactValue(
          makeManifest({
            producer: {
              executor: "codex",
            },
          }),
          "artifact-manifest/v1",
          "$",
        ),
      /producer\.node/,
    );
  });

  it("rejects malformed logical keys and malformed nested objects", () => {
    assert.throws(
      () => validateArtifactManifest(makeManifest({ logical_key: "Bad Key" }), "$"),
      /logical_key/,
    );

    assert.throws(
      () => validateStructuredArtifactValue(
        makeManifest({
          inputs: [{ path: "/tmp/file.txt" }],
        }),
        "artifact-manifest/v1",
        "$",
      ),
      /inputs\[0\]\.source/,
    );
  });
});
