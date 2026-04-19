import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const treeModule = await import(
  pathToFileURL(path.join(distRoot, "interactive/tree.js")).href
);
const selectorsModule = await import(
  pathToFileURL(path.join(distRoot, "interactive/selectors.js")).href
);

const flows = [
  {
    id: "project-review",
    label: "Project Review",
    description: "Review a project-local flow.",
    source: "project-local",
    treePath: ["custom", "review", "project-review"],
    phases: [
      {
        id: "collect",
        repeatVars: {},
        steps: [{ id: "inspect" }],
      },
    ],
  },
  {
    id: "auto-common",
    label: "Auto Common",
    description: "Run the common auto flow.",
    source: "built-in",
    treePath: ["default", "auto-common"],
    phases: [
      {
        id: "plan_1",
        repeatVars: { target: "api" },
        steps: [{ id: "questions" }, { id: "answer" }],
      },
      {
        id: "plan_2",
        repeatVars: { target: "api" },
        steps: [{ id: "questions" }, { id: "answer" }],
      },
      {
        id: "implement",
        repeatVars: {},
        steps: [{ id: "code" }],
      },
    ],
  },
];

describe("interactive tree selectors", () => {
  it("orders custom roots ahead of default and only reveals expanded children", () => {
    const flowTree = treeModule.buildFlowTree(flows);

    const collapsed = treeModule.computeVisibleFlowItems(flowTree, new Set());
    assert.deepEqual(
      collapsed.map((item) => item.key),
      ["folder:custom", "folder:default"],
    );

    const expanded = treeModule.computeVisibleFlowItems(
      flowTree,
      new Set(["folder:custom", "folder:custom/review", "folder:default"]),
    );
    assert.deepEqual(
      expanded.map((item) => item.key),
      [
        "folder:custom",
        "folder:custom/review",
        "flow:project-review",
        "folder:default",
        "flow:auto-common",
      ],
    );
  });

  it("derives a stable header label for folders and flows", () => {
    assert.equal(selectorsModule.selectHeaderLabel(undefined, "auto-common"), "auto-common");
    assert.equal(
      selectorsModule.selectHeaderLabel(
        {
          kind: "folder",
          key: "folder:custom/review",
          name: "review",
          depth: 1,
          pathSegments: ["custom", "review"],
        },
        "auto-common",
      ),
      "custom/review",
    );
    assert.equal(
      selectorsModule.selectHeaderLabel(
        {
          kind: "flow",
          key: "flow:auto-common",
          name: "auto-common",
          depth: 1,
          pathSegments: ["default", "auto-common"],
          flow: flows[1],
        },
        "fallback",
      ),
      "Auto Common",
    );
  });
});

describe("interactive progress selectors", () => {
  it("groups repeated phases and anchors the current running section", () => {
    const progress = selectorsModule.selectProgressViewModel(flows[1], {
      flowKind: "declarative",
      flowVersion: 1,
      terminated: false,
      terminationOutcome: "success",
      phases: [
        {
          id: "plan_1",
          status: "done",
          steps: [
            { id: "questions", status: "done" },
            { id: "answer", status: "done" },
          ],
        },
        {
          id: "plan_2",
          status: "running",
          steps: [
            { id: "questions", status: "done" },
            { id: "answer", status: "running" },
          ],
        },
      ],
    });

    assert.equal(progress.flow.id, "auto-common");
    assert.deepEqual(
      progress.items.map((item) => [item.kind, item.label, item.status]),
      [
        ["group", "target api", "running"],
        ["phase", "plan_1", "done"],
        ["step", "questions", "done"],
        ["step", "answer", "done"],
        ["phase", "plan_2", "running"],
        ["step", "questions", "done"],
        ["step", "answer", "running"],
        ["phase", "implement", "pending"],
        ["step", "code", "pending"],
      ],
    );
    assert.equal(progress.anchorIndex, 6);
  });

  it("hides post-termination skipped phases and appends a termination summary", () => {
    const progress = selectorsModule.selectProgressViewModel(flows[1], {
      flowKind: "declarative",
      flowVersion: 1,
      terminated: true,
      terminationOutcome: "stopped",
      terminationReason: "Stopped by plan_1: operator interrupt",
      phases: [
        {
          id: "plan_1",
          status: "done",
          steps: [
            { id: "questions", status: "done" },
            { id: "answer", status: "done" },
          ],
        },
        {
          id: "plan_2",
          status: "skipped",
          steps: [
            { id: "questions", status: "skipped" },
            { id: "answer", status: "skipped" },
          ],
        },
      ],
    });

    assert.deepEqual(
      progress.items.map((item) => item.label),
      ["target api", "plan_1", "questions", "answer", "implement", "code", "Flow stopped before completion"],
    );
    assert.equal(progress.items.at(-1)?.kind, "termination");
  });
});
