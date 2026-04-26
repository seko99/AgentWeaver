import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const controllerModule = await import(
  pathToFileURL(path.join(distRoot, "interactive/controller.js")).href
);
const sessionFactoryModule = await import(
  pathToFileURL(path.join(distRoot, "interactive/create-interactive-session.js")).href
);
const inkSessionModule = await import(
  pathToFileURL(path.join(distRoot, "interactive/ink/index.js")).href
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readyToRunConfirmation() {
  return {
    hasExistingState: false,
    requiresExplicitChoice: false,
    resume: { available: false, reason: "No saved state found." },
    continue: { available: false, reason: "No saved state found." },
    restart: { available: true, reason: "Start a fresh attempt." },
    details: "Ready to run.",
  };
}

function createController() {
  return new controllerModule.InteractiveSessionController({
    scopeKey: "ag-86",
    jiraIssueKey: "AG-86",
    summaryText: "Existing summary",
    cwd: process.cwd(),
    gitBranchName: "feature/ink-model",
    version: "0.1.15",
    getRunConfirmation: async () => readyToRunConfirmation(),
    onRun: async () => {},
    onInterrupt: async () => {},
    onExit: () => {},
    flows: [
      {
        id: "auto-common",
        label: "Auto Common",
        description: "Run the common auto flow.",
        source: "built-in",
        treePath: ["default", "auto-common"],
        phases: [],
      },
      {
        id: "custom-review",
        label: "Custom Review",
        description: "Run the custom review flow.",
        source: "project-local",
        treePath: ["custom", "review", "custom-review"],
        sourcePath: "flows/custom-review.json",
        phases: [],
      },
    ],
  });
}

function createBusyController(overrides = {}) {
  return new controllerModule.InteractiveSessionController({
    scopeKey: "ag-86",
    jiraIssueKey: "AG-86",
    summaryText: "Existing summary",
    cwd: process.cwd(),
    gitBranchName: "feature/ink-model",
    version: "0.1.15",
    getRunConfirmation: async () => readyToRunConfirmation(),
    onRun: async () => {},
    onInterrupt: async () => {},
    onExit: () => {},
    flows: [
      {
        id: "first-flow",
        label: "First Flow",
        description: "First flow.",
        source: "built-in",
        treePath: ["default", "first-flow"],
        phases: [],
      },
      {
        id: "second-flow",
        label: "Second Flow",
        description: "Second flow.",
        source: "built-in",
        treePath: ["default", "second-flow"],
        phases: [],
      },
    ],
    ...overrides,
  });
}

describe("interactive controller", () => {
  it("drives flow tree expansion and pane focus through the shared model", async () => {
    const controller = createController();
    controller.mount();

    let view = controller.getViewModel();
    assert.ok(view.flowItems.length > 2);
    assert.equal(view.flowItems[0]?.label, "▸ custom");
    assert.equal(view.flowItems[0]?.kind, "folder");
    assert.equal(view.flowItems[0]?.depth, 0);
    assert.equal(view.flowItems[0]?.expanded, false);
    assert.equal(view.flowItems[1]?.label, "▾ default");
    assert.equal(view.flowItems.some((item) => item.label.includes("custom-review")), false);

    controller.selectFlowIndex(0);
    await controller.handleKeypress("", { name: "right" });
    view = controller.getViewModel();
    assert.equal(view.flowItems[0]?.label, "▾ custom");
    assert.equal(view.flowItems[0]?.expanded, true);
    assert.equal(view.flowItems[1]?.label, "  ▸ review");
    assert.equal(view.flowItems[1]?.depth, 1);

    controller.selectFlowIndex(1);
    await controller.handleKeypress("", { name: "right" });
    view = controller.getViewModel();
    assert.ok(view.flowItems.some((item) => item.label.includes("custom-review")));

    await controller.handleKeypress("", { name: "tab" });
    view = controller.getViewModel();
    assert.equal(view.progressTitle, "▶ Current Flow");

    controller.destroy();
  });

  it("renders shared form state independently from blessed widgets", async () => {
    const controller = createController();
    const request = controller.requestUserInput({
      formId: "demo-form",
      title: "Demo Form",
      fields: [
        {
          id: "name",
          type: "text",
          label: "Name",
          required: true,
        },
      ],
    });

    let view = controller.getViewModel();
    assert.equal(view.form?.title, "User Input");
    assert.match(view.form?.content ?? "", /Demo Form/);
    assert.match(view.form?.content ?? "", /Text input:/);
    assert.match(view.form?.content ?? "", /┌/);
    assert.match(view.form?.content ?? "", /│ │/);
    assert.match(view.form?.content ?? "", /└/);

    await controller.handleKeypress("A", { name: "a" });
    await controller.handleKeypress("", { name: "enter" });

    const result = await request;
    assert.equal(result.values.name, "A");

    view = controller.getViewModel();
    assert.equal(view.form, null);
  });

  it("shows text input placeholders separately from the editable field", () => {
    const controller = createController();
    controller.requestUserInput({
      formId: "placeholder-form",
      title: "Placeholder Form",
      fields: [
        {
          id: "jira",
          type: "text",
          label: "Jira issue key",
          required: true,
          placeholder: "DEMO-1234",
        },
      ],
    });

    const view = controller.getViewModel();
    assert.match(view.form?.content ?? "", /Text input:/);
    assert.match(view.form?.content ?? "", /┌/);
    assert.match(view.form?.content ?? "", /│ │/);
    assert.match(view.form?.content ?? "", /Hint: DEMO-1234/);
  });

  it("updates the scope and branch label together", () => {
    const controller = createController();

    controller.setScope("ag-112@abcd1234", null, "AG-112");

    const view = controller.getViewModel();
    assert.match(view.header, /Scope ag-112@abcd1234/);
    assert.match(view.header, /AG-112$/);
  });

  it("renders text input box at the provided modal width before typing", () => {
    const controller = createController();
    controller.requestUserInput({
      formId: "wide-form",
      title: "Wide Form",
      fields: [
        {
          id: "summary",
          type: "text",
          label: "Summary",
          required: true,
        },
      ],
    });

    const view = controller.getViewModel({ formContentWidth: 30 });
    const boxTopLine = (view.form?.content ?? "").split("\n").find((line) => line.startsWith("┌"));

    assert.equal(boxTopLine, `┌${"─".repeat(32)}┐`);
  });

  it("maps Ink key events into the controller key format", () => {
    assert.deepEqual(
      inkSessionModule.normalizeInkKeypress("", {
        upArrow: false,
        downArrow: false,
        leftArrow: true,
        rightArrow: false,
        pageDown: false,
        pageUp: false,
        return: false,
        escape: false,
        ctrl: false,
        shift: false,
        tab: false,
        backspace: false,
        delete: false,
        meta: false,
      }),
      { name: "left", ctrl: false, shift: false, meta: false },
    );
    assert.deepEqual(
      inkSessionModule.normalizeInkKeypress("q", {
        upArrow: false,
        downArrow: false,
        leftArrow: false,
        rightArrow: false,
        pageDown: false,
        pageUp: false,
        return: false,
        escape: false,
        ctrl: false,
        shift: false,
        tab: false,
        backspace: false,
        delete: false,
        meta: false,
      }),
      { name: "q", ctrl: false, shift: false, meta: false },
    );
    assert.deepEqual(
      inkSessionModule.normalizeInkKeypress(" ", {
        upArrow: false,
        downArrow: false,
        leftArrow: false,
        rightArrow: false,
        pageDown: false,
        pageUp: false,
        return: false,
        escape: false,
        ctrl: false,
        shift: false,
        tab: false,
        backspace: false,
        delete: false,
        meta: false,
      }),
      { name: "space", ctrl: false, shift: false, meta: false },
    );
    assert.deepEqual(
      inkSessionModule.normalizeInkKeypress("\x7f", {
        upArrow: false,
        downArrow: false,
        leftArrow: false,
        rightArrow: false,
        pageDown: false,
        pageUp: false,
        return: false,
        escape: false,
        ctrl: false,
        shift: false,
        tab: false,
        backspace: false,
        delete: true,
        meta: false,
      }),
      { name: "backspace", ctrl: false, shift: false, meta: false },
    );
  });

  it("deletes text with backspace inside form inputs", async () => {
    const controller = createController();
    const request = controller.requestUserInput({
      formId: "backspace-form",
      title: "Backspace Form",
      fields: [
        {
          id: "name",
          type: "text",
          label: "Name",
          required: true,
        },
      ],
    });

    await controller.handleKeypress("A", { name: "a" });
    await controller.handleKeypress("B", { name: "b" });
    await controller.handleKeypress("", { name: "backspace" });
    await controller.handleKeypress("", { name: "enter" });

    const result = await request;
    assert.equal(result.values.name, "A");
  });

  it("asks for confirmation before exiting the application", async () => {
    let exitCalls = 0;
    const controller = new controllerModule.InteractiveSessionController({
      scopeKey: "ag-86",
      jiraIssueKey: "AG-86",
      summaryText: "Existing summary",
      cwd: process.cwd(),
      gitBranchName: "feature/ink-model",
      version: "0.1.15",
      getRunConfirmation: async () => readyToRunConfirmation(),
      onRun: async () => {},
      onInterrupt: async () => {},
      onExit: () => {
        exitCalls += 1;
      },
      flows: [
        {
          id: "auto-common",
          label: "Auto Common",
          description: "Run the common auto flow.",
          source: "built-in",
          treePath: ["default", "auto-common"],
          phases: [],
        },
      ],
    });
    controller.mount();

    await controller.handleKeypress("q", { name: "q" });
    let view = controller.getViewModel();
    assert.match(view.confirmText ?? "", /Exit AgentWeaver\?/);
    assert.equal(exitCalls, 0);

    await controller.handleKeypress("", { name: "escape" });
    assert.equal(controller.getViewModel().confirmText, null);
    assert.equal(exitCalls, 0);

    await controller.handleKeypress("", { name: "c", ctrl: true });
    view = controller.getViewModel();
    assert.match(view.confirmText ?? "", /Exit AgentWeaver\?/);

    await controller.handleKeypress("", { name: "enter" });
    assert.equal(exitCalls, 1);
  });

  it("toggles checkbox-style form fields on space", async () => {
    const controller = createController();
    const request = controller.requestUserInput({
      formId: "checkbox-form",
      title: "Checkbox Form",
      fields: [
        {
          id: "flags",
          type: "multi-select",
          label: "Flags",
          required: true,
          options: [
            { label: "Alpha", value: "alpha" },
            { label: "Beta", value: "beta" },
          ],
        },
      ],
    });

    await controller.handleKeypress(" ", { name: "space" });
    let view = controller.getViewModel();
    assert.match(view.form?.content ?? "", /\[x\] Alpha/);

    await controller.handleKeypress("", { name: "down" });
    await controller.handleKeypress(" ", { name: "space" });
    view = controller.getViewModel();
    assert.match(view.form?.content ?? "", /\[x\] Beta/);

    await controller.handleKeypress("", { name: "enter" });
    const result = await request;
    assert.deepEqual(result.values.flags, ["alpha", "beta"]);
  });

  it("does not open a second flow confirmation while another flow is busy", async () => {
    let confirmationCalls = 0;
    let releaseRun;
    const runStarted = new Promise((resolve) => {
      releaseRun = resolve;
    });
    const controller = createBusyController({
      getRunConfirmation: async () => {
        confirmationCalls += 1;
        return readyToRunConfirmation();
      },
      onRun: async () => {
        await runStarted;
      },
    });
    controller.mount();

    controller.selectFlowIndex(1);

    await controller.handleKeypress("", { name: "enter" });
    assert.match(controller.getViewModel().confirmText ?? "", /Run flow "First Flow"\?/);

    const runningTask = controller.handleKeypress("", { name: "enter" });
    await Promise.resolve();

    controller.selectFlowIndex(2);
    await controller.handleKeypress("", { name: "enter" });

    assert.equal(confirmationCalls, 1);
    assert.equal(controller.getViewModel().confirmText, null);
    assert.match(controller.getViewModel().header, /\[running\]/);

    releaseRun();
    await runningTask;
    controller.destroy();
  });

  it("treats Shift+Tab as reverse navigation across panes, confirms, and forms", async () => {
    const controller = createController();
    controller.mount();

    await controller.handleKeypress("", { name: "tab" });
    let view = controller.getViewModel();
    assert.equal(view.progressTitle, "▶ Current Flow");

    await controller.handleKeypress("", { name: "tab", shift: true });
    view = controller.getViewModel();
    assert.equal(view.flowListTitle, "▶ Flows");

    controller.selectFlowIndex(2);
    await controller.handleKeypress("", { name: "enter" });
    view = controller.getViewModel();
    assert.match(view.confirmText ?? "", /\[ Restart \]/);

    await controller.handleKeypress("", { name: "tab" });
    view = controller.getViewModel();
    assert.match(view.confirmText ?? "", /\[ Cancel \]/);

    await controller.handleKeypress("", { name: "tab", shift: true });
    view = controller.getViewModel();
    assert.match(view.confirmText ?? "", /\[ Restart \]/);

    await controller.handleKeypress("", { name: "escape" });

    const request = controller.requestUserInput({
      formId: "reverse-nav-form",
      title: "Reverse Navigation Form",
      fields: [
        {
          id: "first",
          type: "text",
          label: "First field",
          required: true,
        },
        {
          id: "second",
          type: "text",
          label: "Second field",
          required: true,
        },
      ],
    });

    view = controller.getViewModel();
    assert.match(view.form?.content ?? "", /Field 1\/2/);

    await controller.handleKeypress("", { name: "tab" });
    view = controller.getViewModel();
    assert.match(view.form?.content ?? "", /Field 2\/2/);

    await controller.handleKeypress("", { name: "tab", shift: true });
    view = controller.getViewModel();
    assert.match(view.form?.content ?? "", /Field 1\/2/);

    controller.interruptActiveForm();
    await assert.rejects(request);
    controller.destroy();
  });

  it("buffers log appends and emits incremental log updates instead of render events per chunk", async () => {
    const controller = createController();
    const events = [];
    const unsubscribe = controller.subscribe((event) => {
      events.push(event);
    });

    controller.appendLog("first chunk");
    controller.appendLog("second chunk");

    assert.equal(controller.getViewModel().logText, "first chunk\nsecond chunk");
    assert.deepEqual(events, []);

    await sleep(160);

    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, "log");
    assert.deepEqual(events[0]?.appendedLines, ["first chunk", "second chunk"]);

    unsubscribe();
    controller.destroy();
  });

  it("renders the last full Ink page when log scroll follows the end of a long buffer", () => {
    const lines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);
    const logText = lines.join("\n");

    assert.equal(
      inkSessionModule.sliceFromScroll(logText, lines.length - 1, 5),
      lines.slice(-5).join("\n"),
    );
    assert.equal(
      inkSessionModule.sliceFromScroll(logText, 8, 5),
      lines.slice(8, 13).join("\n"),
    );
  });

  it("shows continue as an explicit interactive action when continue and restart are both valid", async () => {
    const controller = createBusyController({
      getRunConfirmation: async () => ({
        hasExistingState: true,
        requiresExplicitChoice: true,
        resume: { available: false, reason: "The saved run already terminated and cannot be resumed." },
        continue: { available: true, reason: "Start the next iteration from the latest active artifacts." },
        restart: { available: true, reason: "Archive the active attempt and start a fresh run." },
        details: "Continuable loop boundary found.",
      }),
    });
    controller.mount();

    await controller.handleKeypress("", { name: "enter" });
    let view = controller.getViewModel();
    assert.match(view.confirmText ?? "", /\[ Continue \]/);
    assert.match(view.confirmText ?? "", /Restart/);

    await controller.handleKeypress("", { name: "right" });
    view = controller.getViewModel();
    assert.match(view.confirmText ?? "", /\[ Restart \]/);

    controller.destroy();
  });

  it("exposes semantic run confirmation metadata and preserves invalid action state", async () => {
    const runs = [];
    const controller = createBusyController({
      getRunConfirmation: async () => ({
        hasExistingState: true,
        requiresExplicitChoice: true,
        resume: { available: true, reason: "Saved state is resumable." },
        continue: { available: true, reason: "Continue from current artifacts." },
        restart: { available: true, reason: "Start again." },
        details: "Choose launch mode.",
      }),
      onRun: async (flowId, mode) => {
        runs.push({ flowId, mode });
      },
    });
    controller.mount();

    await controller.openRunConfirm("first-flow");
    let view = controller.getViewModel();
    assert.equal(view.confirmation.kind, "run");
    assert.equal(view.confirmation.flowId, "first-flow");
    assert.deepEqual(view.confirmation.actions, ["resume", "continue", "restart", "cancel"]);
    assert.equal(view.confirmation.selectedAction, "resume");
    assert.match(view.confirmText, /Run flow "First Flow"\?/);

    controller.selectConfirmAction("restart");
    assert.equal(controller.getViewModel().confirmation.selectedAction, "restart");
    assert.throws(() => controller.selectConfirmAction("stop"), /Invalid confirmation action/);
    assert.equal(controller.getViewModel().confirmation.selectedAction, "restart");
    controller.cancelConfirm();
    assert.equal(controller.getViewModel().confirmation, null);

    await controller.openRunConfirm("first-flow");
    controller.selectConfirmAction("continue");
    await controller.acceptConfirm();
    assert.deepEqual(runs, [{ flowId: "first-flow", mode: "continue" }]);
    controller.destroy();
  });

  it("opens interrupt confirmation and invokes the interrupt callback through acceptConfirm", async () => {
    let releaseRun;
    const interrupted = [];
    const controller = createBusyController({
      onRun: async () => {
        await new Promise((resolve) => {
          releaseRun = resolve;
        });
      },
      onInterrupt: async (flowId) => {
        interrupted.push(flowId);
      },
    });
    controller.mount();
    controller.selectFlowIndex(1);
    await controller.openRunConfirm("first-flow");
    const runningTask = controller.acceptConfirm();
    await Promise.resolve();

    controller.openInterruptConfirm();
    let view = controller.getViewModel();
    assert.equal(view.confirmation.kind, "interrupt");
    assert.deepEqual(view.confirmation.actions, ["stop", "cancel"]);
    controller.selectConfirmAction("cancel");
    await controller.acceptConfirm();
    assert.deepEqual(interrupted, []);

    controller.openInterruptConfirm();
    controller.selectConfirmAction("stop");
    await controller.acceptConfirm();
    assert.deepEqual(interrupted, ["first-flow"]);

    releaseRun();
    await runningTask;
    controller.destroy();
  });

  it("updates all form field types directly and exposes validation errors without closing the form", async () => {
    const controller = createController();
    const request = controller.requestUserInput({
      formId: "direct-form",
      title: "Direct Form",
      fields: [
        { id: "name", type: "text", label: "Name", required: true },
        { id: "notes", type: "text", label: "Notes", multiline: true },
        { id: "enabled", type: "boolean", label: "Enabled" },
        {
          id: "mode",
          type: "single-select",
          label: "Mode",
          required: true,
          options: [
            { value: "fast", label: "Fast" },
            { value: "safe", label: "Safe" },
          ],
        },
        {
          id: "tags",
          type: "multi-select",
          label: "Tags",
          required: true,
          options: [
            { value: "api", label: "API" },
            { value: "ui", label: "UI" },
          ],
        },
      ],
    });

    let view = controller.getViewModel();
    assert.equal(view.form.formId, "direct-form");
    assert.equal(view.form.currentFieldId, "name");
    assert.equal(view.form.fields.length, 5);

    assert.throws(() => controller.submitForm(), /Form validation failed/);
    view = controller.getViewModel();
    assert.equal(view.form.formId, "direct-form");
    assert.match(view.form.error, /Field 'Name' is required/);
    assert.match(view.logText, /Field 'Name' is required/);

    assert.throws(() => controller.updateFormField("missing", "value"), /Unknown form field/);
    assert.equal(controller.getViewModel().form.currentFieldId, "name");

    controller.updateFormField("name", "Ada");
    controller.updateFormField("notes", "Line 1\nLine 2");
    controller.updateFormField("enabled", true);
    controller.updateFormField("mode", "safe");
    controller.updateFormField("tags", ["api", "ui"]);
    assert.equal(controller.getViewModel().form.error, null);
    controller.submitForm();

    const result = await request;
    assert.deepEqual(result.values, {
      name: "Ada",
      notes: "Line 1\nLine 2",
      enabled: true,
      mode: "safe",
      tags: ["api", "ui"],
    });
    assert.equal(controller.getViewModel().form, null);
  });

  it("handles help, scroll, folder toggle, invalid selection, and log clearing through direct methods", () => {
    const controller = createController();
    controller.mount();

    const initial = controller.getViewModel();
    assert.throws(() => controller.selectFlowIndex(999), /Invalid flow index/);
    assert.equal(controller.getViewModel().selectedFlowIndex, initial.selectedFlowIndex);
    controller.selectFlowKey("flow:auto-common");
    assert.equal(controller.getViewModel().flowItems[controller.getViewModel().selectedFlowIndex].key, "flow:auto-common");
    controller.selectFlowId("auto-common");
    assert.equal(controller.getViewModel().flowItems[controller.getViewModel().selectedFlowIndex].key, "flow:auto-common");

    controller.toggleFolder("folder:custom");
    assert.equal(controller.getViewModel().flowItems[0].label, "▾ custom");
    assert.throws(() => controller.toggleFolder("folder:missing"), /Unknown visible folder key/);
    assert.equal(controller.getViewModel().flowItems[0].label, "▾ custom");

    controller.showHelp(true);
    assert.equal(controller.getViewModel().helpVisible, true);
    controller.setScrollOffset("help", 999);
    assert.ok(controller.getViewModel().helpScrollOffset > 0);
    controller.scrollPane("help", { delta: -999 });
    assert.equal(controller.getViewModel().helpScrollOffset, 0);

    controller.appendLog("before clear");
    controller.clearLog();
    assert.equal(controller.getViewModel().logText, "Log cleared.");
    controller.destroy();
  });
});
