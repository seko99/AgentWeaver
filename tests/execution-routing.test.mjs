import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const routingModule = await import(
  pathToFileURL(path.join(distRoot, "runtime/execution-routing.js")).href
);

describe("execution routing resolution", () => {
  it("maps the Balanced preset to Codex for planning and review, and OpenCode for implementation-style groups", () => {
    const routing = routingModule.resolveExecutionRouting({ presetId: "balanced" });

    assert.equal(routing.defaultRoute.executor, "opencode");
    assert.equal(routing.defaultRoute.model, "minimax-coding-plan/MiniMax-M2.7");
    assert.deepEqual(
      {
        planning: [routing.groups.planning.executor, routing.groups.planning.model],
        review: [routing.groups.review.executor, routing.groups.review.model],
        implementation: [routing.groups.implementation.executor, routing.groups.implementation.model],
        "repair-loop": [routing.groups["repair-loop"].executor, routing.groups["repair-loop"].model],
        "local-fix-loop": [routing.groups["local-fix-loop"].executor, routing.groups["local-fix-loop"].model],
      },
      {
        planning: ["codex", "gpt-5.4"],
        review: ["codex", "gpt-5.4"],
        implementation: ["opencode", "minimax-coding-plan/MiniMax-M2.7"],
        "repair-loop": ["opencode", "minimax-coding-plan/MiniMax-M2.7"],
        "local-fix-loop": ["opencode", "minimax-coding-plan/MiniMax-M2.7"],
      },
    );
  });

  it("produces a stable fingerprint for identical effective routing", () => {
    const fromPreset = routingModule.resolveExecutionRouting({ presetId: "balanced" });
    const fromExplicit = routingModule.resolveExecutionRouting({
      defaultRoute: { executor: "opencode", model: "minimax-coding-plan/MiniMax-M2.7" },
      currentRunOverrides: {
        planning: { executor: "codex", model: "gpt-5.4" },
        "design-review": { executor: "codex", model: "gpt-5.4" },
        review: { executor: "codex", model: "gpt-5.4" },
      },
    });

    assert.equal(fromPreset.fingerprint, fromExplicit.fingerprint);
  });

  it("rejects unsupported executor and model combinations", () => {
    assert.throws(
      () => routingModule.resolveExecutionRouting({
        defaultRoute: { executor: "codex", model: "gpt-5.4" },
        currentRunOverrides: {
          implementation: { executor: "codex", model: "minimax-coding-plan/MiniMax-M2.7" },
        },
      }),
      /not allowed for executor 'codex'/,
    );
  });

  it("derives required executors from the routing groups actually used by a flow", () => {
    const opencodeOnly = routingModule.resolveExecutionRouting({ presetId: "opencode-only" });
    const balanced = routingModule.resolveExecutionRouting({ presetId: "balanced" });

    assert.deepEqual(
      routingModule.executorsForRoutingGroups(opencodeOnly, ["planning", "review"]),
      ["opencode"],
    );
    assert.deepEqual(
      routingModule.executorsForRoutingGroups(balanced, ["planning", "implementation", "review"]),
      ["codex", "opencode"],
    );
  });

  it("normalizes invalid editor selections back to executor-specific defaults", () => {
    const normalized = routingModule.normalizeEditableExecutionRouting({
      planning: { executor: "codex", model: "minimax-coding-plan/MiniMax-M2.7" },
      "design-review": { executor: "codex", model: "gpt-5.4" },
      implementation: { executor: "opencode", model: "minimax-coding-plan/MiniMax-M2.7" },
      review: { executor: "opencode", model: "gpt-5.4" },
      "repair-loop": { executor: "opencode", model: "zhipuai-coding-plan/glm-5.1" },
      "local-fix-loop": { executor: "codex", model: "gpt-5.4-mini" },
    });

    assert.equal(normalized.routes.planning.model, "gpt-5.4");
    assert.equal(normalized.routes.review.model, "minimax-coding-plan/MiniMax-M2.7");
    assert.deepEqual(normalized.validationErrors, [
      "Planning model 'minimax-coding-plan/MiniMax-M2.7' is not allowed for executor 'codex'. Select a codex model.",
      "Review model 'gpt-5.4' is not allowed for executor 'opencode'. Select a opencode model.",
    ]);
  });
});
