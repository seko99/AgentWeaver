import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { instantTaskInputJsonFile } = await import(
  pathToFileURL(path.join(distRoot, "artifacts.js")).href
);
const { buildLogicalKeyForPayload, inferPayloadContract } = await import(
  pathToFileURL(path.join(distRoot, "artifact-manifest.js")).href
);
const { resolveValue } = await import(
  pathToFileURL(path.join(distRoot, "pipeline/value-resolver.js")).href
);

describe("instant-task input artifact", () => {
  it("resolves the built-in artifact ref kind to the expected path", () => {
    const taskKey = "instant-task-branch@12345678";
    const resolved = resolveValue({
      artifact: {
        kind: "instant-task-input-json-file",
        taskKey: { const: taskKey },
      },
    }, {
      flowParams: {},
      flowConstants: {},
      pipelineContext: {},
      repeatVars: {},
    });

    assert.equal(resolved, instantTaskInputJsonFile(taskKey));
    assert.match(String(resolved), /instant-task-input-instant-task-branch@12345678\.json$/);
  });

  it("publishes deterministic logical keys and user-input schema metadata", () => {
    const taskKey = "instant-task-branch@12345678";
    const payloadPath = instantTaskInputJsonFile(taskKey);

    assert.equal(buildLogicalKeyForPayload(taskKey, payloadPath), "artifacts/instant-task-input.json");
    assert.deepEqual(
      inferPayloadContract(taskKey, payloadPath),
      {
        payloadFamily: "structured-json",
        schemaId: "user-input/v1",
        schemaVersion: 1,
      },
    );
  });
});
