import { designFile, planArtifacts, planFile, qaFile } from "../../artifacts.js";
import { PLAN_PROMPT_TEMPLATE, formatPrompt, formatTemplate } from "../../prompts.js";
import { runNode } from "../node-runner.js";
import { jiraFetchNode } from "../nodes/jira-fetch-node.js";
import { planCodexNode } from "../nodes/plan-codex-node.js";
import type { PipelineContext } from "../types.js";

export type PlanFlowParams = {
  jiraApiUrl: string;
  jiraTaskFile: string;
  taskKey: string;
  extraPrompt?: string | null;
  codexCmd: string;
};

export async function runPlanFlow(context: PipelineContext, params: PlanFlowParams): Promise<void> {
  await runNode(jiraFetchNode, context, {
    jiraApiUrl: params.jiraApiUrl,
    outputFile: params.jiraTaskFile,
  });

  const prompt = formatPrompt(
    formatTemplate(PLAN_PROMPT_TEMPLATE, {
      jira_task_file: params.jiraTaskFile,
      design_file: designFile(params.taskKey),
      plan_file: planFile(params.taskKey),
      qa_file: qaFile(params.taskKey),
    }),
    params.extraPrompt,
  );

  await runNode(planCodexNode, context, {
    prompt,
    command: params.codexCmd,
    requiredArtifacts: planArtifacts(params.taskKey),
  });
}
