import { existsSync, readFileSync } from "node:fs";

import { taskSummaryFile } from "../../artifacts.js";
import { runFlow } from "../flow-runner.js";
import type { FlowDefinition } from "../flow-types.js";
import { runNode } from "../node-runner.js";
import { commandCheckNode } from "../nodes/command-check-node.js";
import { jiraFetchNode } from "../nodes/jira-fetch-node.js";
import { taskSummaryNode } from "../nodes/task-summary-node.js";
import type { PipelineContext } from "../types.js";

export type PreflightFlowParams = {
  jiraApiUrl: string;
  jiraTaskFile: string;
  taskKey: string;
  forceRefresh: boolean;
};

export const preflightFlowDefinition: FlowDefinition<PreflightFlowParams> = {
  kind: "interactive-preflight-flow",
  version: 1,
  steps: [
    {
      id: "check_commands",
      async run(context) {
        const result = await runNode(commandCheckNode, context, {
          commands: [
            { commandName: "codex", envVarName: "CODEX_BIN" },
            { commandName: "claude", envVarName: "CLAUDE_BIN" },
          ],
        });
        return { completed: true, metadata: { resolved: result.value.resolved.length } };
      },
    },
    {
      id: "fetch_jira_if_needed",
      async run(context, params) {
        if (!params.forceRefresh && existsSync(params.jiraTaskFile)) {
          return { completed: true, metadata: { skipped: true } };
        }
        await runNode(jiraFetchNode, context, {
          jiraApiUrl: params.jiraApiUrl,
          outputFile: params.jiraTaskFile,
        });
        return { completed: true };
      },
    },
    {
      id: "load_or_generate_task_summary",
      async run(context, params) {
        const summaryPath = taskSummaryFile(params.taskKey);
        if (!params.forceRefresh && existsSync(params.jiraTaskFile) && existsSync(summaryPath)) {
          context.setSummary?.(readFileSync(summaryPath, "utf8").trim());
          return { completed: true, metadata: { source: "existing" } };
        }
        const claudeCmd = context.runtime.resolveCmd("claude", "CLAUDE_BIN");
        await runNode(taskSummaryNode, context, {
          jiraTaskFile: params.jiraTaskFile,
          taskKey: params.taskKey,
          claudeCmd,
          verbose: context.verbose,
        });
        return { completed: true, metadata: { source: "generated" } };
      },
    },
  ],
};

export async function runPreflightFlow(context: PipelineContext, params: PreflightFlowParams): Promise<void> {
  await runFlow(preflightFlowDefinition, context, params);
}
