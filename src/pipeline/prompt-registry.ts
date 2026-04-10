import {
  BUG_ANALYZE_PROMPT_TEMPLATE,
  COMMIT_MESSAGE_PROMPT_TEMPLATE,
  GITLAB_DIFF_REVIEW_PROMPT_TEMPLATE,
  BUG_FIX_PROMPT_TEMPLATE,
  IMPLEMENT_PROMPT_TEMPLATE,
  JIRA_DESCRIPTION_PROMPT_TEMPLATE,
  MR_DESCRIPTION_PROMPT_TEMPLATE,
  PLAN_QUESTIONS_PROMPT_TEMPLATE,
  PLAN_PROMPT_TEMPLATE,
  REVIEW_FIX_PROMPT_TEMPLATE,
  REVIEW_PROJECT_PROMPT_TEMPLATE,
  REVIEW_PROMPT_TEMPLATE,
  REVIEW_REPLY_PROJECT_PROMPT_TEMPLATE,
  REVIEW_REPLY_PROMPT_TEMPLATE,
  REVIEW_REPLY_SUMMARY_PROMPT_TEMPLATE,
  REVIEW_SUMMARY_PROMPT_TEMPLATE,
  RUN_GO_LINTER_LOOP_FIX_PROMPT_TEMPLATE,
  RUN_GO_TESTS_LOOP_FIX_PROMPT_TEMPLATE,
  TASK_SUMMARY_PROMPT_TEMPLATE,
} from "../prompts.js";

export type PromptTemplateRef =
  | "bug-analyze"
  | "bug-fix"
  | "commit-message"
  | "gitlab-diff-review"
  | "implement"
  | "task-describe"
  | "mr-description"
  | "plan-questions"
  | "plan"
  | "review"
  | "review-fix"
  | "review-project"
  | "review-reply"
  | "review-reply-project"
  | "review-reply-summary"
  | "review-summary"
  | "run-go-linter-loop-fix"
  | "run-go-tests-loop-fix"
  | "task-summary";

const promptTemplates: Record<PromptTemplateRef, string> = {
  "bug-analyze": BUG_ANALYZE_PROMPT_TEMPLATE,
  "bug-fix": BUG_FIX_PROMPT_TEMPLATE,
  "commit-message": COMMIT_MESSAGE_PROMPT_TEMPLATE,
  "gitlab-diff-review": GITLAB_DIFF_REVIEW_PROMPT_TEMPLATE,
  implement: IMPLEMENT_PROMPT_TEMPLATE,
  "task-describe": JIRA_DESCRIPTION_PROMPT_TEMPLATE,
  "mr-description": MR_DESCRIPTION_PROMPT_TEMPLATE,
  "plan-questions": PLAN_QUESTIONS_PROMPT_TEMPLATE,
  plan: PLAN_PROMPT_TEMPLATE,
  review: REVIEW_PROMPT_TEMPLATE,
  "review-project": REVIEW_PROJECT_PROMPT_TEMPLATE,
  "review-fix": REVIEW_FIX_PROMPT_TEMPLATE,
  "review-reply": REVIEW_REPLY_PROMPT_TEMPLATE,
  "review-reply-project": REVIEW_REPLY_PROJECT_PROMPT_TEMPLATE,
  "review-reply-summary": REVIEW_REPLY_SUMMARY_PROMPT_TEMPLATE,
  "review-summary": REVIEW_SUMMARY_PROMPT_TEMPLATE,
  "run-go-linter-loop-fix": RUN_GO_LINTER_LOOP_FIX_PROMPT_TEMPLATE,
  "run-go-tests-loop-fix": RUN_GO_TESTS_LOOP_FIX_PROMPT_TEMPLATE,
  "task-summary": TASK_SUMMARY_PROMPT_TEMPLATE,
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
