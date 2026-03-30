export const BASE_PROMPT_HEADER = "Основная задача:";
export const EXTRA_PROMPT_HEADER = "Дополнительные указания:";

export const PLAN_PROMPT_TEMPLATE =
  "Посмотри и проанализируй задачу в {jira_task_file}. " +
  "Сначала создай структурированные JSON-артефакты, они являются source of truth для следующих flow. " +
  "Человекочитаемые markdown-файлы сделай как краткое производное представление этих JSON-артефактов для пользователя. " +
  "Разработай системный дизайн решения и запиши JSON в {design_json_file}, затем markdown в {design_file}. " +
  "Для {design_json_file} используй объект: { summary: string, goals: string[], non_goals: string[], components: string[], decisions: [{ component: string, decision: string, rationale: string }], risks: string[], open_questions: string[] }. " +
  "Разработай подробный план реализации и запиши JSON в {plan_json_file}, затем markdown в {plan_file}. " +
  "Для {plan_json_file} используй объект: { summary: string, prerequisites: string[], implementation_steps: [{ id: string, title: string, details: string }], tests: string[], rollout_notes: string[] }. " +
  "Разработай план тестирования для QA и запиши JSON в {qa_json_file}, затем markdown в {qa_file}. " +
  "Для {qa_json_file} используй объект: { summary: string, test_scenarios: [{ id: string, title: string, expected_result: string }], non_functional_checks: string[] }. " +
  "JSON-файлы должны быть валидными и содержать только JSON без markdown-обёртки. ";

export const BUG_ANALYZE_PROMPT_TEMPLATE =
  "Посмотри и проанализируй баг в {jira_task_file}. " +
  "Сначала создай структурированные JSON-артефакты, они являются source of truth для следующих flow. " +
  "Человекочитаемые markdown-файлы сделай как краткое производное представление этих JSON-артефактов для пользователя. " +
  "Запиши структурированный анализ бага в {bug_analyze_json_file}, затем краткую markdown-версию в {bug_analyze_file}. " +
  "Запиши структурированный дизайн исправления в {bug_fix_design_json_file}, затем краткую markdown-версию в {bug_fix_design_file}. " +
  "Запиши структурированный план реализации в {bug_fix_plan_json_file}, затем краткую markdown-версию в {bug_fix_plan_file}. " +
  "JSON-файлы должны быть валидными и содержать только JSON без markdown-обёртки. " +
  "Для {bug_analyze_json_file} используй объект: { summary: string, suspected_root_cause: { hypothesis: string, confidence: string }, reproduction_steps: string[], affected_components: string[], evidence: string[], risks: string[], open_questions: string[] }. " +
  "Для {bug_fix_design_json_file} используй объект: { summary: string, goals: string[], non_goals: string[], target_components: string[], proposed_changes: [{ component: string, change: string, rationale: string }], alternatives_considered: [{ option: string, decision: string, rationale: string }], risks: string[], validation_strategy: string[] }. " +
  "Для {bug_fix_plan_json_file} используй объект: { summary: string, prerequisites: string[], implementation_steps: [{ id: string, title: string, details: string }], tests: string[], rollout_notes: string[] }. ";

export const BUG_FIX_PROMPT_TEMPLATE =
  "Используй только структурированные артефакты как source of truth. " +
  "Проанализируй баг по {bug_analyze_json_file}. " +
  "Используй дизайн исправления из {bug_fix_design_json_file}. " +
  "Используй план реализации из {bug_fix_plan_json_file}. " +
  "Markdown-артефакты предназначены только для чтения человеком и не должны определять реализацию. " +
  "После этого приступай к реализации исправления в коде. ";

export const MR_DESCRIPTION_PROMPT_TEMPLATE =
  "Посмотри задачу в {jira_task_file} и текущие изменения в репозитории. " +
  "Подготовь очень краткое intent-описание для merge request без подробностей реализации, списков файлов и технических деталей. " +
  "Сначала запиши source-of-truth JSON в {mr_description_json_file} в виде объекта { summary: string }, затем производную markdown-версию в {mr_description_file}. ";

export const IMPLEMENT_PROMPT_TEMPLATE =
  "Используй только структурированные артефакты как source of truth. " +
  "Проанализируй системный дизайн {design_json_file}, план реализации {plan_json_file} и приступай к реализации по плану. " +
  "Markdown-артефакты предназначены только для чтения человеком и не должны определять реализацию. ";

export const REVIEW_PROMPT_TEMPLATE =
  "Проведи код-ревью текущих изменений. " +
  "Используй только структурированные артефакты как source of truth: задачу в {jira_task_file}, дизайн в {design_json_file} и план в {plan_json_file}. " +
  "Сначала запиши структурированный результат в {review_json_file} в виде объекта { summary: string, ready_to_merge: boolean, findings: [{ severity: string, title: string, description: string }] }. " +
  "Затем запиши производную markdown-версию в {review_file}. " +
  "Если ready_to_merge=true и нет блокеров, препятствующих merge - создай файл ready-to-merge.md.";

export const REVIEW_PROJECT_PROMPT_TEMPLATE =
  "Проведи код-ревью текущих изменений в проекте без Jira-контекста. " +
  "Оцени качество изменений по текущему коду, тестам, рискам регрессий и общему инженерному качеству. " +
  "Сначала запиши структурированный результат в {review_json_file} в виде объекта { summary: string, ready_to_merge: boolean, findings: [{ severity: string, title: string, description: string }] }. " +
  "Затем запиши производную markdown-версию в {review_file}. " +
  "Если ready_to_merge=true и нет блокеров, создай файл {ready_to_merge_file}.";

export const REVIEW_REPLY_PROMPT_TEMPLATE =
  "Твой коллега провёл код-ревью и записал структурированный результат в {review_json_file}. " +
  "Используй только структурированные артефакты как source of truth: задачу в {jira_task_file}, дизайн в {design_json_file}, план в {plan_json_file} и review в {review_json_file}. " +
  "Сначала запиши структурированный ответ в {review_reply_json_file} в виде объекта { summary: string, ready_to_merge: boolean, responses: [{ finding_title: string, disposition: string, action: string }] }. " +
  "Затем запиши производную markdown-версию в {review_reply_file}.";

export const REVIEW_REPLY_PROJECT_PROMPT_TEMPLATE =
  "Твой коллега провёл код-ревью и записал структурированный результат в {review_json_file}. " +
  "Используй review в {review_json_file} как source of truth, разберись в замечаниях и подготовь структурированный ответ. " +
  "Сначала запиши структурированный ответ в {review_reply_json_file} в виде объекта { summary: string, ready_to_merge: boolean, responses: [{ finding_title: string, disposition: string, action: string }] }. " +
  "Затем запиши производную markdown-версию в {review_reply_file}.";

export const REVIEW_SUMMARY_PROMPT_TEMPLATE =
  "Посмотри в {review_file}. " +
  "Сделай краткий список комментариев без подробностей, 3-7 пунктов. " +
  "Запиши результат в {review_summary_file}.";

export const REVIEW_REPLY_SUMMARY_PROMPT_TEMPLATE =
  "Посмотри в {review_reply_file}. " +
  "Сделай краткий список ответов и итоговых действий без подробностей, 3-7 пунктов. " +
  "Запиши результат в {review_reply_summary_file}.";

export const REVIEW_FIX_PROMPT_TEMPLATE =
  "Используй только структурированные артефакты как source of truth. " +
  "Проанализируй комментарии в {review_reply_json_file}. " +
  "Исправь то, что содержится в дополнительных указаниях, а если таковых нет - исправь все пункты. " +
  "По окончании обязательно прогони вне песочницы линтер, все тесты, сгенерируй make swagger. " +
  "Исправь ошибки линтера и тестов, если будут. " +
  "По завершении сначала запиши структурированный отчёт в {review_fix_json_file} в виде объекта { summary: string, completed_actions: string[], validation_steps: string[] }, затем производную markdown-версию в {review_fix_file}.";

export const TASK_SUMMARY_PROMPT_TEMPLATE =
  "Посмотри в {jira_task_file}. " +
  "Сделай краткое резюме задачи, на 1-2 абзаца. " +
  "Сначала запиши source-of-truth JSON в {task_summary_json_file} в виде объекта { summary: string }, затем markdown-версию в {task_summary_file}.";

export const JIRA_DESCRIPTION_PROMPT_TEMPLATE =
  "Посмотри задачу в {jira_task_file}. " +
  "Проанализируй код и оформи краткое описание для Jira, упомяни ключевые точки, модели данных, сервисы, REST-методы. " +
  "Сначала запиши source-of-truth JSON в {jira_description_json_file} в виде объекта { summary: string }, затем markdown-версию в {jira_description_file}.";

export const RUN_GO_TESTS_LOOP_FIX_PROMPT_TEMPLATE =
  "Запусти ./run_go_tests.sh, проанализируй последнюю ошибку проверки, исправь код и подготовь изменения так, чтобы следующий прогон run_go_tests.sh прошёл успешно.";
export const RUN_GO_LINTER_LOOP_FIX_PROMPT_TEMPLATE =
  "Используй структурированный результат последнего запуска run_go_linter.py из {linter_result_json_file} как source of truth. " +
  "Проанализируй последнюю ошибку линтера или генерации, исправь код и подготовь изменения так, чтобы следующий прогон run_go_linter.py прошёл успешно.";
export const AUTO_REVIEW_FIX_EXTRA_PROMPT = "Исправлять только блокеры, критикалы и важные";

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
