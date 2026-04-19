import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const sessionFactoryModule = await import(
  pathToFileURL(path.join(distRoot, "interactive/create-interactive-session.js")).href
);

describe("interactive session renderer selection", () => {
  it("defaults the requested renderer to ink when AGENTWEAVER_TUI is unset or invalid", () => {
    assert.equal(sessionFactoryModule.resolveInteractiveRenderer({}), "ink");
    assert.equal(sessionFactoryModule.resolveInteractiveRenderer({ AGENTWEAVER_TUI: "INK" }), "ink");
    assert.equal(sessionFactoryModule.resolveInteractiveRenderer({ AGENTWEAVER_TUI: "unknown" }), "ink");
  });

  it("falls back to blessed when ink is unavailable", () => {
    assert.equal(
      sessionFactoryModule.resolveEffectiveInteractiveRenderer({}, false),
      "blessed",
    );
    assert.equal(
      sessionFactoryModule.resolveEffectiveInteractiveRenderer({ AGENTWEAVER_TUI: "ink" }, false),
      "blessed",
    );
  });

  it("keeps blessed as an explicit rollback path", () => {
    assert.equal(
      sessionFactoryModule.resolveEffectiveInteractiveRenderer({ AGENTWEAVER_TUI: "blessed" }, false),
      "blessed",
    );
    assert.equal(
      sessionFactoryModule.resolveEffectiveInteractiveRenderer({ AGENTWEAVER_TUI: "blessed" }, true),
      "blessed",
    );
  });
});
