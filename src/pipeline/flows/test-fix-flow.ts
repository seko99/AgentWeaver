import { planArtifacts, requireArtifacts } from "../../artifacts.js";
import { TEST_FIX_PROMPT_TEMPLATE, TEST_LINTER_FIX_PROMPT_TEMPLATE, formatPrompt } from "../../prompts.js";
import { runNode } from "../node-runner.js";
import { codexDockerPromptNode } from "../nodes/codex-docker-prompt-node.js";
import type { PipelineContext } from "../types.js";

export type TestFixFlowParams = {
  command: "test-fix" | "test-linter-fix";
  taskKey: string;
  dockerComposeFile: string;
  extraPrompt?: string | null;
};

export async function runTestFixFlow(context: PipelineContext, params: TestFixFlowParams): Promise<void> {
  requireArtifacts(planArtifacts(params.taskKey), `${params.command} mode requires plan artifacts from the planning phase.`);
  const prompt = formatPrompt(
    params.command === "test-fix" ? TEST_FIX_PROMPT_TEMPLATE : TEST_LINTER_FIX_PROMPT_TEMPLATE,
    params.extraPrompt,
  );
  await runNode(codexDockerPromptNode, context, {
    dockerComposeFile: params.dockerComposeFile,
    prompt,
    labelText: `Running Codex ${params.command} mode in isolated Docker`,
  });
}
