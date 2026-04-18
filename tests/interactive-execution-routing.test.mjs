import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");

let originalHome;
let tempHome;
let flowCatalogModule;
let interactiveRoutingModule;
let routingModule;
let storeModule;

beforeEach(async () => {
  originalHome = process.env.HOME;
  tempHome = mkdtempSync(path.join(os.tmpdir(), "agentweaver-interactive-routing-"));
  process.env.HOME = tempHome;
  flowCatalogModule = await import(
    `${pathToFileURL(path.join(distRoot, "pipeline/flow-catalog.js")).href}?flow=${Date.now()}`
  );
  interactiveRoutingModule = await import(
    `${pathToFileURL(path.join(distRoot, "runtime/interactive-execution-routing.js")).href}?interactive=${Date.now()}`
  );
  routingModule = await import(
    `${pathToFileURL(path.join(distRoot, "runtime/execution-routing.js")).href}?routing=${Date.now()}`
  );
  storeModule = await import(
    `${pathToFileURL(path.join(distRoot, "runtime/execution-routing-store.js")).href}?store=${Date.now()}`
  );
});

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  rmSync(tempHome, { recursive: true, force: true });
});

describe("interactive execution routing", () => {
  it("lets operators edit the fallback route for flows without routing groups", async () => {
    const flowEntry = flowCatalogModule.loadInteractiveFlowCatalog(process.cwd()).find((entry) => entry.id === "git-commit");
    assert.ok(flowEntry, "git-commit flow should exist");

    const seenForms = [];
    const responses = [
      { values: { preset: "custom" } },
      { values: { action: "edit" } },
      {
        values: {
          default_route_executor: "codex",
          default_route_model: "gpt-5.4-mini",
        },
      },
      { values: { persistence: "current-run" } },
      { values: { action: "start" } },
    ];

    const result = await interactiveRoutingModule.requestInteractiveExecutionRouting(flowEntry, async (form) => {
      seenForms.push(form);
      const response = responses.shift();
      assert.ok(response, `unexpected form ${form.formId}`);
      return response;
    });

    const routingEditor = seenForms.find((form) => form.formId === "flow-routing-editor");
    assert.ok(routingEditor, "routing editor form should be shown");
    assert.equal(
      routingEditor.fields.some((field) => field.id === "default_route_executor"),
      true,
    );
    assert.equal(
      routingEditor.fields.some((field) => field.id.endsWith("_inherit_default")),
      false,
    );
    assert.equal(result.selectedPreset.label, "Custom");
    assert.equal(result.routing.defaultRoute.executor, "codex");
    assert.equal(result.routing.defaultRoute.model, "gpt-5.4-mini");

    assert.equal(existsSync(storeModule.executionRoutingStoreFile()), true);
  });

  it("lets operators edit the fallback default route before starting a routed flow", async () => {
    const flowEntry = flowCatalogModule.loadInteractiveFlowCatalog(process.cwd()).find((entry) => entry.id === "auto-golang");
    assert.ok(flowEntry, "auto-golang flow should exist");

    const seenForms = [];
    const responses = [
      { values: { preset: "custom" } },
      { values: { action: "edit" } },
      {
        values: {
          default_route_executor: "codex",
          default_route_model: "gpt-5.4",
        },
      },
      { values: { persistence: "current-run" } },
      { values: { action: "start" } },
    ];

    const result = await interactiveRoutingModule.requestInteractiveExecutionRouting(flowEntry, async (form) => {
      seenForms.push(form);
      const response = responses.shift();
      assert.ok(response, `unexpected form ${form.formId}`);
      return response;
    });

    const routingEditor = seenForms.find((form) => form.formId === "flow-routing-editor");
    assert.ok(routingEditor, "routing editor form should be shown");
    assert.equal(
      routingEditor.fields.some((field) => field.id === "default_route_executor"),
      true,
    );
    assert.equal(
      routingEditor.fields.some((field) => field.id === "default_route_model"),
      true,
    );
    assert.equal(
      routingEditor.fields.some((field) => field.id.endsWith("_inherit_default")),
      false,
    );
    assert.equal(
      routingEditor.fields.some((field) => field.id === "planning_executor"),
      true,
    );
    assert.equal(
      routingEditor.fields.some((field) => field.id === "planning_model"),
      true,
    );
    assert.equal(result.routing.defaultRoute.executor, "codex");
    assert.equal(result.routing.defaultRoute.model, "gpt-5.4");
    assert.equal(result.routing.groups.planning.executor, "codex");
    assert.equal(result.routing.groups.planning.model, "gpt-5.4");
    assert.equal(result.routing.groups.implementation.executor, "codex");
    assert.equal(result.routing.groups.implementation.model, "gpt-5.4");

    const rawStore = JSON.parse(readFileSync(storeModule.executionRoutingStoreFile(), "utf8"));
    const lastUsedKeys = Object.keys(rawStore.lastUsedByFlow);
    assert.deepEqual(lastUsedKeys, [flowCatalogModule.flowRoutingKey(flowEntry)]);
    assert.equal(rawStore.lastUsedByFlow[lastUsedKeys[0]].routing.defaultRoute.executor, "codex");
    assert.equal(rawStore.lastUsedByFlow[lastUsedKeys[0]].routing.defaultRoute.model, "gpt-5.4");
  });

  it("rebuilds model options from the selected executor in the routing editor", async () => {
    const flowEntry = flowCatalogModule.loadInteractiveFlowCatalog(process.cwd()).find((entry) => entry.id === "auto-common");
    assert.ok(flowEntry, "auto-common flow should exist");

    const seenForms = [];
    const responses = [
      { values: { preset: "built-in:balanced" } },
      { values: { action: "edit" } },
      {
        values: {
          default_route_executor: "codex",
          default_route_model: "gpt-5.4",
          planning_executor: "codex",
          planning_model: "gpt-5.4",
          implementation_executor: "opencode",
          implementation_model: "minimax-coding-plan/MiniMax-M2.7",
        },
      },
      { values: { persistence: "current-run" } },
      { values: { action: "start" } },
    ];

    const result = await interactiveRoutingModule.requestInteractiveExecutionRouting(flowEntry, async (form) => {
      seenForms.push(form);
      const response = responses.shift();
      assert.ok(response, `unexpected form ${form.formId}`);
      return response;
    });

    const routingEditor = seenForms.find((form) => form.formId === "flow-routing-editor");
    assert.ok(routingEditor, "routing editor form should be shown");
    assert.equal(
      routingEditor.fields.some((field) => field.id.endsWith("_inherit_default")),
      false,
    );

    const defaultModelField = routingEditor.fields.find((field) => field.id === "default_route_model");
    assert.ok(defaultModelField, "default route model field should be present");
    assert.equal(typeof defaultModelField.optionsFromValues, "function");
    const codexModelValues = defaultModelField.optionsFromValues({ default_route_executor: "codex" });
    assert.equal(codexModelValues.some((option) => option.value === "gpt-5.4"), true);
    assert.equal(codexModelValues.some((option) => option.value === "opencode/minimax-m2.5-free"), false);

    const implementationModelField = routingEditor.fields.find((field) => field.id === "implementation_model");
    assert.ok(implementationModelField, "implementation model field should be present");
    assert.equal(typeof implementationModelField.optionsFromValues, "function");
    const implementationModelValues = implementationModelField.optionsFromValues({ implementation_executor: "codex" });
    assert.equal(implementationModelValues.some((option) => option.value === "gpt-5.4"), true);
    assert.equal(implementationModelValues.some((option) => option.value === "default"), false);

    assert.equal(result.routing.defaultRoute.executor, "codex");
    assert.equal(result.routing.groups.planning.executor, "codex");
  });

  it("describes effective routed steps in the preview before launch", () => {
    const flowEntry = flowCatalogModule.loadInteractiveFlowCatalog(process.cwd()).find((entry) => entry.id === "auto-common");
    assert.ok(flowEntry, "auto-common flow should exist");

    const routing = routingModule.resolveExecutionRouting({ presetId: "balanced" });
    const preview = interactiveRoutingModule.describeEffectiveRoutingPreview(flowEntry, routing, process.cwd());

    assert.match(preview, /\| Default\s+\| opencode \| minimax-coding-plan\/MiniMax-M2\.7 \|/);
    assert.match(preview, /\| plan\.run_plan_flow > plan > plan\.generate_planning_questions\s+\| Planning\s+\| codex\s+\| gpt-5\.4\s+\|/);
    assert.match(preview, /\| plan\.run_plan_flow > plan > plan\.run_plan\s+\| Planning\s+\| codex\s+\| gpt-5\.4\s+\|/);
    assert.match(preview, /\| implement\.run_implement\s+\| Implementation \| opencode \| minimax-coding-plan\/MiniMax-M… \|/);
    assert.match(
      preview,
      /\| review-loop\.run_review_loop > review-loop > review_iteration_1\.… \| Review\s+\| codex\s+\| gpt-5\.4\s+\|/,
    );
    assert.doesNotMatch(preview, /review_iteration_2/);
  });

  it("shows the effective routing table in the routing preview form", async () => {
    const flowEntry = flowCatalogModule.loadInteractiveFlowCatalog(process.cwd()).find((entry) => entry.id === "auto-common");
    assert.ok(flowEntry, "auto-common flow should exist");

    const seenForms = [];
    const responses = [
      { values: { preset: "built-in:balanced" } },
      { values: { action: "cancel" } },
    ];

    await assert.rejects(
      async () => interactiveRoutingModule.requestInteractiveExecutionRouting(flowEntry, async (form) => {
        seenForms.push(form);
        const response = responses.shift();
        assert.ok(response, `unexpected form ${form.formId}`);
        return response;
      }),
      /cancelled/i,
    );

    const routingPreviewForm = seenForms.find((form) => form.formId === "flow-routing-action");
    assert.ok(routingPreviewForm, "routing preview form should be shown");
    assert.match(routingPreviewForm.description, /Review the effective routing and choose the next action\./);
    assert.match(routingPreviewForm.preview, /^Preset: Balanced$/m);
    assert.match(
      routingPreviewForm.preview,
      /\| plan\.run_plan_flow > plan > plan\.generate_planning_questions\s+\| Planning\s+\| codex\s+\| gpt-5\.4\s+\|/,
    );
    assert.match(
      routingPreviewForm.preview,
      /\| implement\.run_implement\s+\| Implementation \| opencode \| minimax-coding-plan\/MiniMax-M… \|/,
    );
  });
});
