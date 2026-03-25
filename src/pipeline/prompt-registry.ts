import {
  IMPLEMENT_PROMPT_TEMPLATE,
  PLAN_PROMPT_TEMPLATE,
  REVIEW_FIX_PROMPT_TEMPLATE,
  REVIEW_PROMPT_TEMPLATE,
  REVIEW_REPLY_PROMPT_TEMPLATE,
  REVIEW_REPLY_SUMMARY_PROMPT_TEMPLATE,
  REVIEW_SUMMARY_PROMPT_TEMPLATE,
  RUN_LINTER_LOOP_FIX_PROMPT_TEMPLATE,
  RUN_TESTS_LOOP_FIX_PROMPT_TEMPLATE,
  TASK_SUMMARY_PROMPT_TEMPLATE,
  TEST_FIX_PROMPT_TEMPLATE,
  TEST_LINTER_FIX_PROMPT_TEMPLATE,
} from "../prompts.js";

export type PromptTemplateRef =
  | "implement"
  | "plan"
  | "review"
  | "review-fix"
  | "review-reply"
  | "review-reply-summary"
  | "review-summary"
  | "run-linter-loop-fix"
  | "run-tests-loop-fix"
  | "task-summary"
  | "test-fix"
  | "test-linter-fix";

const promptTemplates: Record<PromptTemplateRef, string> = {
  implement: IMPLEMENT_PROMPT_TEMPLATE,
  plan: PLAN_PROMPT_TEMPLATE,
  review: REVIEW_PROMPT_TEMPLATE,
  "review-fix": REVIEW_FIX_PROMPT_TEMPLATE,
  "review-reply": REVIEW_REPLY_PROMPT_TEMPLATE,
  "review-reply-summary": REVIEW_REPLY_SUMMARY_PROMPT_TEMPLATE,
  "review-summary": REVIEW_SUMMARY_PROMPT_TEMPLATE,
  "run-linter-loop-fix": RUN_LINTER_LOOP_FIX_PROMPT_TEMPLATE,
  "run-tests-loop-fix": RUN_TESTS_LOOP_FIX_PROMPT_TEMPLATE,
  "task-summary": TASK_SUMMARY_PROMPT_TEMPLATE,
  "test-fix": TEST_FIX_PROMPT_TEMPLATE,
  "test-linter-fix": TEST_LINTER_FIX_PROMPT_TEMPLATE,
};

export function isPromptTemplateRef(value: string): value is PromptTemplateRef {
  return value in promptTemplates;
}

export function getPromptTemplate(ref: PromptTemplateRef): string {
  return promptTemplates[ref];
}

export function promptTemplateRefs(): PromptTemplateRef[] {
  return Object.keys(promptTemplates) as PromptTemplateRef[];
}
