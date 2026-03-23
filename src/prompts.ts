export const BASE_PROMPT_HEADER = "Основная задача:";
export const EXTRA_PROMPT_HEADER = "Дополнительные указания:";

export const PLAN_PROMPT_TEMPLATE =
  "Посмотри и проанализируй задачу в {jira_task_file}. " +
  "Разработай системный дизайн решения, запиши в {design_file}. " +
  "Разработай подробный план реализации и запиши его в {plan_file}. " +
  "Разработай план тестирования для QA и запиши в {qa_file}. ";

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
