import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { userInputNode } = await import(
  pathToFileURL(path.join(distRoot, "pipeline/nodes/user-input-node.js")).href
);
const { buildInitialUserInputValues } = await import(
  pathToFileURL(path.join(distRoot, "user-input.js")).href
);

let tempDir;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), "agentweaver-user-input-node-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("userInputNode", () => {
  it("prefills form defaults from initialValues", async () => {
    const outputFile = path.join(tempDir, "instant-task-input-demo.json");
    let capturedForm = null;

    const result = await userInputNode.run(
      {
        issueKey: "demo",
        requestUserInput: async (form) => {
          capturedForm = form;
          return {
            formId: form.formId,
            submittedAt: "2026-04-19T16:00:00.000Z",
            values: buildInitialUserInputValues(form.fields),
          };
        },
      },
      {
        formId: "instant-task-input",
        title: "Instant Task Input",
        fields: [
          {
            id: "task_description",
            type: "text",
            label: "Task description",
            required: true,
            multiline: true,
          },
          {
            id: "additional_instructions",
            type: "text",
            label: "Additional instructions",
            multiline: true,
          },
        ],
        initialValues: {
          task_description: "Saved task",
          additional_instructions: "Saved notes",
        },
        outputFile,
      },
    );

    assert.ok(capturedForm, "requestUserInput should receive a form");
    assert.equal(capturedForm.fields[0].default, "Saved task");
    assert.equal(capturedForm.fields[1].default, "Saved notes");
    assert.equal(result.value.values.task_description, "Saved task");
    assert.equal(result.value.values.additional_instructions, "Saved notes");

    const persisted = JSON.parse(readFileSync(outputFile, "utf8"));
    assert.equal(persisted.values.task_description, "Saved task");
    assert.equal(persisted.values.additional_instructions, "Saved notes");
  });
});
