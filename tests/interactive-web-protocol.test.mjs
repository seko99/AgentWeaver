import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { parseClientAction } = await import(
  pathToFileURL(path.join(distRoot, "interactive/web/protocol.js")).href
);

describe("interactive web protocol", () => {
  it("accepts every semantic client action", () => {
    const actions = [
      { type: "flow.select", index: 0 },
      { type: "flow.select", key: "flow:plan" },
      { type: "folder.toggle", key: "folder:default" },
      { type: "run.openConfirm", flowId: "plan" },
      { type: "confirm.select", action: "restart" },
      { type: "confirm.accept" },
      { type: "confirm.accept", action: "restart" },
      { type: "confirm.cancel" },
      { type: "form.update", values: { name: "Ada" } },
      { type: "form.fieldUpdate", fieldId: "name", value: "Ada" },
      { type: "form.submit", values: { name: "Ada" } },
      { type: "form.cancel" },
      { type: "interrupt.openConfirm" },
      { type: "flow.interrupt", flowId: "plan" },
      { type: "log.clear" },
      { type: "help.toggle", visible: true },
      { type: "scroll", pane: "log", delta: 1 },
      { type: "scroll", pane: "summary", offset: 0, actionId: "a-1" },
    ];

    for (const action of actions) {
      assert.deepEqual(parseClientAction(JSON.stringify(action)), action);
    }
  });

  it("rejects malformed messages and invalid payloads", () => {
    assert.throws(() => parseClientAction("{"), /valid JSON/);
    assert.throws(() => parseClientAction(JSON.stringify({})), /string type/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "submitInput" })), /Unknown protocol action/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "flow.select" })), /requires index or key/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "folder.toggle", key: "" })), /key must be a non-empty string/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "form.update", values: [] })), /values must be an object/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "form.fieldUpdate", fieldId: "name" })), /value is required/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "scroll", pane: "bad", delta: 1 })), /scroll pane/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "scroll", pane: "log" })), /requires delta or offset/);
  });
});
