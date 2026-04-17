import {
  renderStructuredArtifactSchema,
  type StructuredArtifactSchemaId,
} from "./structured-artifact-schema-registry.js";

export const BASE_PROMPT_HEADER = "Primary task:";
export const EXTRA_PROMPT_HEADER = "Additional instructions:";
export const STRUCTURED_JSON_LANGUAGE_INSTRUCTION =
  "All structured JSON artifacts are machine-readable and must use English for all generated semantic string values. " +
  "If a JSON artifact needs to preserve verbatim user-provided or external source text, keep that quoted source text unchanged, but write all generated summaries, titles, descriptions, decisions, and explanations in English. ";

function strictSchemaInstruction(outputFileVar: string, schemaId: StructuredArtifactSchemaId): string {
  return (
    `The artifact format for ${outputFileVar} must fully conform to schema ${schemaId} from the registry. ` +
    "Do not skip required fields, do not rename fields, do not change types, do not replace arrays with objects or strings, and do not leave required strings empty. " +
    "The final JSON must pass validation against this schema without manual corrections. " +
    STRUCTURED_JSON_LANGUAGE_INSTRUCTION +
    `Canonical schema:\n${renderStructuredArtifactSchema(schemaId)}\n`
  );
}

export const PLAN_PROMPT_TEMPLATE =
  "Review and analyze the task in {jira_task_file}. " +
  "Be sure to analyze additional materials from Jira attachments manifest {jira_attachments_manifest_file} and text context {jira_attachments_context_file}; if an attachment contains more detailed requirements, constraints, file lists, migration strategy, or invariants, treat the attachment as source of truth for planning alongside the Jira issue. " +
  "First create structured JSON artifacts - they are the source of truth for subsequent flows. " +
  "Create human-readable markdown files as detailed derivative representations of these JSON artifacts for the user, not as brief summaries. " +
  "Markdown should not influence JSON structure: first determine the correct JSON types, then build markdown as a derivative representation. " +
  "Do not collapse specifics from the task and attachments: preserve explicit files, methods, APIs, invariants, migration steps, DB constraints, business rules, and acceptance criteria. " +
  "Develop a system design for the solution and write JSON to {design_json_file}, then markdown to {design_file}. " +
  strictSchemaInstruction("{design_json_file}", "implementation-design/v1") +
  "Develop a detailed implementation plan and write JSON to {plan_json_file}, then markdown to {plan_file}. " +
  strictSchemaInstruction("{plan_json_file}", "implementation-plan/v1") +
  "Develop a QA test plan and write JSON to {qa_json_file}, then markdown to {qa_file}. " +
  strictSchemaInstruction("{qa_json_file}", "qa-plan/v1") +
  "Format markdown for design and plan comprehensively, with separate sections for Summary, Current State, Target State, Affected Code, Decisions, Migration/DB Changes, Risks, Implementation Steps, Tests, Rollout. " +
  "JSON files must be valid and contain only JSON without markdown wrapping. ";

export const PLAN_QUESTIONS_PROMPT_TEMPLATE =
  "Review and analyze the task in {jira_task_file}. " +
  "Be sure to analyze additional materials from Jira attachments manifest {jira_attachments_manifest_file} and text context {jira_attachments_context_file}; if an attachment contains more detailed requirements, constraints, file lists, migration strategy, or invariants, treat the attachment as source of truth for planning alongside the Jira issue. " +
  "Before final planning, determine if any clarifications are needed from the user. " +
  strictSchemaInstruction("{planning_questions_json_file}", "planning-questions/v1") +
  "Ask only questions without which the design/plan could be incorrect or too speculative. " +
  "Do not ask obvious, decorative, or duplicate questions. " +
  "Usually 1-5 questions are sufficient. " +
  "The JSON file must be valid and contain only JSON without markdown wrapping. ";

export const BUG_ANALYZE_PROMPT_TEMPLATE =
  "Review and analyze the bug in {jira_task_file}. " +
  "First create structured JSON artifacts - they are the source of truth for subsequent flows. " +
  "Create human-readable markdown files as brief derivative representations of these JSON artifacts for the user. " +
  "Write structured bug analysis to {bug_analyze_json_file}, then a brief markdown version to {bug_analyze_file}. " +
  "Write structured fix design to {bug_fix_design_json_file}, then a brief markdown version to {bug_fix_design_file}. " +
  "Write structured implementation plan to {bug_fix_plan_json_file}, then a brief markdown version to {bug_fix_plan_file}. " +
  "JSON files must be valid and contain only JSON without markdown wrapping. " +
  strictSchemaInstruction("{bug_analyze_json_file}", "bug-analysis/v1") +
  strictSchemaInstruction("{bug_fix_design_json_file}", "bug-fix-design/v1") +
  strictSchemaInstruction("{bug_fix_plan_json_file}", "bug-fix-plan/v1");

export const BUG_FIX_PROMPT_TEMPLATE =
  "Use only structured artifacts as source of truth. " +
  "Analyze the bug from {bug_analyze_json_file}. " +
  "Use the fix design from {bug_fix_design_json_file}. " +
  "Use the implementation plan from {bug_fix_plan_json_file}. " +
  "Markdown artifacts are intended only for human reading and should not define the implementation. " +
  "After that, proceed to implement the fix in code. ";

export const MR_DESCRIPTION_PROMPT_TEMPLATE =
  "Review the task in {jira_task_file} and the current changes in the repository. " +
  "Prepare a very brief intent description for the merge request without implementation details, file lists, or technical details. " +
  `First write the source-of-truth JSON to {mr_description_json_file}. ${strictSchemaInstruction("{mr_description_json_file}", "mr-description/v1")}Then write the derivative markdown version to {mr_description_file}. `;

export const IMPLEMENT_PROMPT_TEMPLATE =
  "Use only structured artifacts as source of truth. " +
  "Analyze the system design {design_json_file}, implementation plan {plan_json_file}, and proceed with implementation according to the plan. " +
  "Markdown artifacts are intended only for human reading and should not define the implementation. ";

export const REVIEW_PROMPT_TEMPLATE =
  "Conduct a code review of the current changes. " +
  "Use only structured artifacts as source of truth: the task in {jira_task_file}, design in {design_json_file}, and plan in {plan_json_file}. " +
  `First write the structured result to {review_json_file}. ${strictSchemaInstruction("{review_json_file}", "review-findings/v1")}` +
  "Then write the derivative markdown version to {review_file}. " +
  "If ready_to_merge=true and there are no blockers preventing merge - create the ready-to-merge.md file.";

export const DESIGN_REVIEW_PROMPT_TEMPLATE =
  "Conduct a structured planning critique as a specification critic, not as an implementer. " +
  "Use structured JSON artifacts as the source of truth for semantics. " +
  "Required planning inputs: design markdown {design_file}, design JSON {design_json_file}, implementation plan markdown {plan_file}, implementation plan JSON {plan_json_file}. " +
  "Review the markdown files as derivative human-readable renderings of the same planning run, but do not let markdown override the structured JSON. " +
  "Optional supplemental context is provided through these variables and may contain the literal value 'not provided' when absent: QA markdown {qa_file}, QA JSON {qa_json_file}, Jira task JSON {jira_task_file}, Jira attachments manifest {jira_attachments_manifest_file}, Jira attachments context {jira_attachments_context_file}, planning answers JSON {planning_answers_json_file}. " +
  "When an optional variable is 'not provided', treat that source as unavailable and do not invent details from it. " +
  "Evaluate completeness, consistency, implementation readiness, risk coverage, QA coverage, and scope discipline across the available planning artifacts and optional context. " +
  "Identify blocking findings, major non-blocking findings, warnings, missing information, consistency check results, QA coverage gaps, and concise recommended actions. " +
  "Use exactly one status value: approved, approved_with_warnings, or needs_revision. " +
  "Set status to needs_revision when any blocking finding exists or when required information is missing in a way that blocks safe implementation start. " +
  "Set status to approved_with_warnings when there are no blocking findings, but there are major findings, warnings, non-blocking missing information items, QA coverage gaps, or non-blocking consistency issues. " +
  "Set status to approved only when there are no unresolved blocking findings, major findings, warnings, missing information items, or QA coverage gaps. " +
  `First write the structured design review to {review_json_file}. ${strictSchemaInstruction("{review_json_file}", "design-review/v1")}` +
  "Then write the derivative markdown version to {review_file}. " +
  "Create ready-to-merge.md only when status is approved or approved_with_warnings. " +
  "Do not create ready-to-merge.md when status is needs_revision.";

export const REVIEW_PROJECT_PROMPT_TEMPLATE =
  "Conduct a code review of current changes in the project without Jira context. " +
  "Evaluate the quality of changes based on current code, tests, regression risks, and overall engineering quality. " +
  `First write the structured result to {review_json_file}. ${strictSchemaInstruction("{review_json_file}", "review-findings/v1")}` +
  "Then write the derivative markdown version to {review_file}. " +
  "If ready_to_merge=true and there are no blockers, create the {ready_to_merge_file} file.";

export const GITLAB_DIFF_REVIEW_PROMPT_TEMPLATE =
  "Conduct a code review of the GitLab merge request diff. " +
  "Use the structured diff artifact {gitlab_diff_json_file} as source of truth, and markdown {gitlab_diff_file} only as a convenient human-readable representation. " +
  "Evaluate only the changes from the diff: correctness, regression risks, missing tests, dangerous edge cases, contract violations, and maintainability. " +
  `First write the structured result to {review_json_file}. ${strictSchemaInstruction("{review_json_file}", "review-findings/v1")}` +
  "Then write the derivative markdown version to {review_file}. " +
  "If ready_to_merge=true and there are no blockers, create the {ready_to_merge_file} file.";

export const GITLAB_REVIEW_PROMPT_TEMPLATE =
  "Validate GitLab merge request review comments. " +
  "Use the structured GitLab review artifact {gitlab_review_json_file} as source of truth, and markdown {gitlab_review_file} only as a convenient human-readable representation. " +
  "Determine which comments are valid actionable findings that should be addressed in the current code. " +
  "Ignore comments that are obsolete, already resolved, duplicates, purely conversational, or not actionable. " +
  "Normalize the remaining actionable findings into the review findings schema with accurate severities, concise titles, and concrete descriptions. " +
  "For each remaining finding, assess whether the complaint is fair in the current code and propose a concrete fix. " +
  `First write the structured result to {review_json_file}. ${strictSchemaInstruction("{review_json_file}", "review-findings/v1")}` +
  `Then write the structured assessment result to {review_assessment_json_file}. ${strictSchemaInstruction("{review_assessment_json_file}", "review-assessment/v1")}` +
  "Then write the derivative markdown version to {review_file} and the derivative markdown assessment to {review_assessment_file}.";

export const REVIEW_SUMMARY_PROMPT_TEMPLATE =
  "Look at {review_file}. " +
  "Create a brief list of comments without details, 3-7 items. " +
  "Write the result to {review_summary_file}.";

export const REVIEW_FIX_PROMPT_TEMPLATE =
  "Use only structured artifacts as source of truth. " +
  "Analyze the findings in {review_json_file}. " +
  "Fix what is contained in the additional instructions, and if there are none - fix all items. " +
  "After completion, be sure to run the linter outside the sandbox, all tests, generate make swagger. " +
  "Fix any linter and test errors if they occur. " +
  `Upon completion, first write the structured report to {review_fix_json_file}. ${strictSchemaInstruction("{review_fix_json_file}", "review-fix-report/v1")}Then write the derivative markdown version to {review_fix_file}.`;

export const TASK_SUMMARY_PROMPT_TEMPLATE =
  "Look at {jira_task_file}. " +
  "Create a brief summary of the task, 1-2 paragraphs. " +
  `First write the source-of-truth JSON to {task_summary_json_file}. ${strictSchemaInstruction("{task_summary_json_file}", "task-summary/v1")}Then write the markdown version to {task_summary_file}.`;

export const JIRA_DESCRIPTION_PROMPT_TEMPLATE =
  "Review the task in {jira_task_file}. " +
  "Be sure to use the original issue description and all useful issue comments from the Jira payload as source material; if comments clarify scope, expected behavior, edge cases, or acceptance criteria, reflect that context in the result. " +
  "Analyze additional materials from Jira attachments manifest {jira_attachments_manifest_file} and text context {jira_attachments_context_file}; if attachments contain more detailed requirements or constraints, treat them as source of truth alongside the Jira issue. " +
  "Study the repository code relevant to the task before writing the description. Verify whether the mentioned APIs, routes, handlers, modules, entities, or screens already exist and how they currently behave. For example, if the task mentions a route such as GET v1/task-templates, inspect the code that implements or should implement that route and use that understanding to add concise but useful context. " +
  "The result must be richer than a paraphrase of the title: include context from the task description, comments, attachments, and relevant code, but do not invent requirements that are not supported by those sources. " +
  "Formulate a typical Jira task description in simple product language, without overloading with technical details. " +
  "Description structure: Problem, Context, What needs to be done, Acceptance criteria. " +
  "Add concrete implementation context when it is supported by the task and the code: mention where changes are likely needed, including specific routes, handlers, services, DTOs, API contracts, validation rules, repository methods, events, or UI screens. " +
  "If the code already defines a relevant request/response contract or DTO, reflect that in the description at a high level so the task is actionable. " +
  "Write only what helps understand the essence of the task and expected result; technical details, internal service names, data models, file names, REST methods, DTO names, contracts, and implementation steps should be mentioned when they add necessary context or make the task materially clearer. " +
  `First write the source-of-truth JSON to {jira_description_json_file}. ${strictSchemaInstruction("{jira_description_json_file}", "jira-description/v1")}Then write the markdown version to {jira_description_file}.`;

export const RUN_GO_TESTS_LOOP_FIX_PROMPT_TEMPLATE =
  "Use the structured result of the last run of run_go_tests.py from {tests_result_json_file} as source of truth. " +
  "Analyze the last test error, fix the code, and prepare changes so that the next run of run_go_tests.py succeeds.";
export const RUN_GO_LINTER_LOOP_FIX_PROMPT_TEMPLATE =
  "Use the structured result of the last run of run_go_linter.py from {linter_result_json_file} as source of truth. " +
  "Analyze the last linter or generation error, fix the code, and prepare changes so that the next run of run_go_linter.py succeeds.";
export const COMMIT_MESSAGE_PROMPT_TEMPLATE =
  "Generate a commit message for the current changes. " +
  "Task context (Jira): {jira_task_file}. " +
  "Current changes (git diff): {git_diff_file}. " +
  "List of changed files: {git_status_json_file}. " +
  "Rules: " +
  "1) Subject line ≤72 characters. " +
  "2) Format: {taskKey}: {taskDescription} (e.g., DEMO-1234: Add user authentication). " +
  "3) Include task key from Jira task. " +
  "4) Commit message language: English. " +
  "5) Write JSON to {commit_message_json_file}: {\"subject\": \"...\"}.";
export const AUTO_REVIEW_FIX_EXTRA_PROMPT = "Fix only blockers, criticals, and important issues";

export function formatTemplate(template: string, values: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    result = result.replaceAll(`{${key}}`, value);
  }
  return result;
}

export function formatPrompt(basePrompt: string, extraPrompt?: string | null): string {
  const sections = [`${BASE_PROMPT_HEADER}\n${basePrompt.trim()}`];
  if (extraPrompt?.trim()) {
    sections.push(`${EXTRA_PROMPT_HEADER}\n${extraPrompt.trim()}`);
  }
  return sections.join("\n\n");
}
