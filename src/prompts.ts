export const BASE_PROMPT_HEADER = "Основная задача:";
export const EXTRA_PROMPT_HEADER = "Дополнительные указания:";

export const PLAN_PROMPT_TEMPLATE =
  "Посмотри и проанализируй задачу в {jira_task_file}. " +
  "Разработай системный дизайн решения, запиши в {design_file}. " +
  "Разработай подробный план реализации и запиши его в {plan_file}. " +
  "Разработай план тестирования для QA и запиши в {qa_file}. ";

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
  "Сфокусируйся на том, что меняется и зачем. Запиши результат в {mr_description_file}. ";

export const IMPLEMENT_PROMPT_TEMPLATE =
  "Проанализируй системный дизайн {design_file}, план реализации {plan_file} и приступай к реализации по плану. ";

export const REVIEW_PROMPT_TEMPLATE =
  "Проведи код-ревью текущих изменений. " +
  "Сверься с задачей в {jira_task_file}, дизайном {design_file} и планом {plan_file}. " +
  "Замечания и комментарии запиши в {review_file}. " +
  "Если больше нет блокеров, препятствующих merge - создай файл ready-to-merge.md.";

export const REVIEW_REPLY_PROMPT_TEMPLATE =
  "Твой коллега провёл код-ревью и записал комментарии в {review_file}. " +
  "Проанализируй комментарии к код-ревью, сверься с задачей в {jira_task_file}, " +
  "дизайном {design_file}, планом {plan_file} и запиши свои комментарии в {review_reply_file}.";

export const REVIEW_SUMMARY_PROMPT_TEMPLATE =
  "Посмотри в {review_file}. " +
  "Сделай краткий список комментариев без подробностей, 3-7 пунктов. " +
  "Запиши результат в {review_summary_file}.";

export const REVIEW_REPLY_SUMMARY_PROMPT_TEMPLATE =
  "Посмотри в {review_reply_file}. " +
  "Сделай краткий список ответов и итоговых действий без подробностей, 3-7 пунктов. " +
  "Запиши результат в {review_reply_summary_file}.";

export const REVIEW_FIX_PROMPT_TEMPLATE =
  "Проанализируй комментарии в {review_reply_file}. " +
  "Исправь то, что содержится в дополнительных указаниях, а если таковых нет - исправь все пункты. " +
  "По окончании обязательно прогони вне песочницы линтер, все тесты, сгенерируй make swagger. " +
  "Исправь ошибки линтера и тестов, если будут. " +
  "По завершении резюме запиши в {review_fix_file}.";

export const TASK_SUMMARY_PROMPT_TEMPLATE =
  "Посмотри в {jira_task_file}. " +
  "Сделай краткое резюме задачи, на 1-2 абзаца, " +
  "запиши в {task_summary_file}.";

export const TEST_FIX_PROMPT_TEMPLATE = "Прогони тесты, исправь ошибки.";
export const TEST_LINTER_FIX_PROMPT_TEMPLATE = "Прогони линтер, исправь замечания.";
export const RUN_TESTS_LOOP_FIX_PROMPT_TEMPLATE =
  "Запусти ./run_tests.sh, проанализируй последнюю ошибку проверки, исправь код и подготовь изменения так, чтобы следующий прогон run_tests.sh прошёл успешно.";
export const RUN_LINTER_LOOP_FIX_PROMPT_TEMPLATE =
  "Запусти ./run_linter.sh, проанализируй последнюю ошибку линтера или генерации, исправь код и подготовь изменения так, чтобы следующий прогон run_linter.sh прошёл успешно.";
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
