import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const stateModule = await import(
  pathToFileURL(path.join(distRoot, "interactive/state.js")).href
);

describe("interactive state bootstrap", () => {
  it("derives the initial selection and summary visibility from session options", () => {
    const state = stateModule.createInitialInteractiveState({
      scopeKey: "ag-86",
      jiraIssueKey: "AG-86",
      summaryText: "Existing summary",
      cwd: process.cwd(),
      gitBranchName: "feature/ink",
      version: "0.1.15",
      getRunConfirmation: async () => ({
        hasExistingState: false,
        requiresExplicitChoice: false,
        resume: { available: false, reason: "No saved state found." },
        continue: { available: false, reason: "No saved state found." },
        restart: { available: true, reason: "Start a fresh attempt." },
      }),
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
      ],
    });

    assert.equal(state.selectedFlowId, "auto-common");
    assert.equal(state.selectedFlowItemKey, "flow:auto-common");
    assert.equal(state.focusedPane, "flows");
    assert.equal(state.summaryVisible, true);
    assert.equal(state.flowTreeKeys[0], "folder:default");
    assert.equal(state.gitBranchName, "feature/ink");
  });

  it("keeps technical subfolders collapsed by default and selects the first visible flow", () => {
    const state = stateModule.createInitialInteractiveState({
      scopeKey: "ag-86",
      jiraIssueKey: "AG-86",
      summaryText: "",
      cwd: process.cwd(),
      gitBranchName: "feature/ink",
      version: "0.1.15",
      getRunConfirmation: async () => ({
        hasExistingState: false,
        requiresExplicitChoice: false,
        resume: { available: false, reason: "No saved state found." },
        continue: { available: false, reason: "No saved state found." },
        restart: { available: true, reason: "Start a fresh attempt." },
      }),
      onRun: async () => {},
      onInterrupt: async () => {},
      onExit: () => {},
      flows: [
        {
          id: "custom-review",
          label: "Custom Review",
          description: "Run the custom review flow.",
          source: "project-local",
          treePath: ["custom", "review", "custom-review"],
          phases: [],
        },
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

    assert.equal(state.selectedFlowId, "auto-common");
    assert.equal(state.selectedFlowItemKey, "flow:auto-common");
  });
});
