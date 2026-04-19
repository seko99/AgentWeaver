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

function createController() {
  return new controllerModule.InteractiveSessionController({
    scopeKey: "ag-86",
    jiraIssueKey: "AG-86",
    summaryText: "Existing summary",
    cwd: process.cwd(),
    gitBranchName: "feature/ink-model",
    version: "0.1.15",
    getRunConfirmation: async () => ({ resumeAvailable: false, hasExistingState: false, details: "Ready to run." }),
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
    getRunConfirmation: async () => ({ resumeAvailable: false, hasExistingState: false, details: "Ready to run." }),
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
    assert.equal(view.flowItems[0]?.label, "▾ custom");
    assert.ok(view.flowItems.some((item) => item.label.includes("custom-review")));

    controller.selectFlowIndex(0);
    await controller.handleKeypress("", { name: "left" });
    view = controller.getViewModel();
    assert.equal(view.flowItems[0]?.label, "▸ custom");

    await controller.handleKeypress("", { name: "right" });
    view = controller.getViewModel();
    assert.equal(view.flowItems[0]?.label, "▾ custom");

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
      getRunConfirmation: async () => ({ resumeAvailable: false, hasExistingState: false, details: "Ready to run." }),
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
        return { resumeAvailable: false, hasExistingState: false, details: "Ready to run." };
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
    assert.match(view.confirmText ?? "", /\[ OK \]/);

    await controller.handleKeypress("", { name: "tab" });
    view = controller.getViewModel();
    assert.match(view.confirmText ?? "", /\[ Cancel \]/);

    await controller.handleKeypress("", { name: "tab", shift: true });
    view = controller.getViewModel();
    assert.match(view.confirmText ?? "", /\[ OK \]/);

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

    await sleep(80);

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
      lines.slice(4, 9).join("\n"),
    );
  });
});
