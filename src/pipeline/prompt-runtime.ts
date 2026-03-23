import { TaskRunnerError } from "../errors.js";
import { formatPrompt, formatTemplate } from "../prompts.js";
import { getPromptTemplate } from "./prompt-registry.js";
import type { PromptBindingSpec } from "./spec-types.js";
import { resolveValue, type DeclarativeResolverContext } from "./value-resolver.js";

export function renderPrompt(binding: PromptBindingSpec, context: DeclarativeResolverContext): string {
  const baseTemplate = binding.inlineTemplate ?? (binding.templateRef ? getPromptTemplate(binding.templateRef) : null);
  if (!baseTemplate) {
    throw new TaskRunnerError("Prompt binding must define templateRef or inlineTemplate");
  }
  const vars = Object.fromEntries(
    Object.entries(binding.vars ?? {}).map(([key, value]) => [key, String(resolveValue(value, context))]),
  );
  const basePrompt = formatTemplate(baseTemplate, vars);
  const resolvedExtraPrompt = binding.extraPrompt ? resolveValue(binding.extraPrompt, context) : null;
  const extraPrompt =
    resolvedExtraPrompt === null || resolvedExtraPrompt === undefined ? null : String(resolvedExtraPrompt);
  if ((binding.format ?? "task-prompt") === "plain") {
    return basePrompt;
  }
  return formatPrompt(basePrompt, extraPrompt);
}
