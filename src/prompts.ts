import {
  renderStructuredArtifactSchema,
  type StructuredArtifactSchemaId,
} from "./structured-artifact-schema-registry.js";

export const BASE_PROMPT_HEADER = "Основная задача:";
export const EXTRA_PROMPT_HEADER = "Дополнительные указания:";

function strictSchemaInstruction(outputFileVar: string, schemaId: StructuredArtifactSchemaId): string {
  return (
    `Формат артефакта ${outputFileVar} обязан полностью соответствовать schema ${schemaId} из registry. ` +
    "Не пропускай required fields, не переименовывай поля, не меняй типы, не заменяй массив объектом или строкой и не оставляй обязательные строки пустыми. " +
    "Итоговый JSON должен пройти валидацию по этой схеме без ручных исправлений. " +
    `Canonical schema:\n${renderStructuredArtifactSchema(schemaId)}\n`
  );
}

export const PLAN_PROMPT_TEMPLATE =
  "Посмотри и проанализируй задачу в {jira_task_file}. " +
  "Обязательно проанализируй дополнительные материалы из Jira attachments manifest {jira_attachments_manifest_file} и текстовый контекст {jira_attachments_context_file}; если attachment содержит более детальную постановку, ограничения, список файлов, migration strategy или инварианты, считай attachment source of truth для planning наравне с Jira issue. " +
  "Сначала создай структурированные JSON-артефакты, они являются source of truth для следующих flow. " +
  "Человекочитаемые markdown-файлы сделай как подробное производное представление этих JSON-артефактов для пользователя, а не как краткое summary. " +
  "Markdown не должен влиять на структуру JSON: сначала определи корректные JSON-типы, затем строй markdown как производное представление. " +
  "Не схлопывай конкретику из задачи и attachment: сохраняй явные файлы, методы, API, инварианты, migration steps, DB-ограничения, business rules и acceptance criteria. " +
  "Разработай системный дизайн решения и запиши JSON в {design_json_file}, затем markdown в {design_file}. " +
  strictSchemaInstruction("{design_json_file}", "implementation-design/v1") +
  "Разработай подробный план реализации и запиши JSON в {plan_json_file}, затем markdown в {plan_file}. " +
  strictSchemaInstruction("{plan_json_file}", "implementation-plan/v1") +
  "Разработай план тестирования для QA и запиши JSON в {qa_json_file}, затем markdown в {qa_file}. " +
  strictSchemaInstruction("{qa_json_file}", "qa-plan/v1") +
  "Markdown для design и plan оформи развёрнуто, с отдельными секциями Summary, Current State, Target State, Affected Code, Decisions, Migration/DB Changes, Risks, Implementation Steps, Tests, Rollout. " +
  "JSON-файлы должны быть валидными и содержать только JSON без markdown-обёртки. ";

export const PLAN_QUESTIONS_PROMPT_TEMPLATE =
  "Посмотри и проанализируй задачу в {jira_task_file}. " +
  "Обязательно проанализируй дополнительные материалы из Jira attachments manifest {jira_attachments_manifest_file} и текстовый контекст {jira_attachments_context_file}; если attachment содержит более детальную постановку, ограничения, список файлов, migration strategy или инварианты, считай attachment source of truth для planning наравне с Jira issue. " +
  "Перед финальным planning определи, нужны ли уточнения от пользователя. " +
  strictSchemaInstruction("{planning_questions_json_file}", "planning-questions/v1") +
  "Задавай только вопросы, без ответа на которые design/plan могут оказаться неверными или слишком предположительными. " +
  "Не задавай очевидные, декоративные или дублирующие вопросы. " +
  "Обычно достаточно 1-5 вопросов. " +
  "JSON-файл должен быть валидным и содержать только JSON без markdown-обёртки. ";

export const BUG_ANALYZE_PROMPT_TEMPLATE =
  "Посмотри и проанализируй баг в {jira_task_file}. " +
  "Сначала создай структурированные JSON-артефакты, они являются source of truth для следующих flow. " +
  "Человекочитаемые markdown-файлы сделай как краткое производное представление этих JSON-артефактов для пользователя. " +
  "Запиши структурированный анализ бага в {bug_analyze_json_file}, затем краткую markdown-версию в {bug_analyze_file}. " +
  "Запиши структурированный дизайн исправления в {bug_fix_design_json_file}, затем краткую markdown-версию в {bug_fix_design_file}. " +
  "Запиши структурированный план реализации в {bug_fix_plan_json_file}, затем краткую markdown-версию в {bug_fix_plan_file}. " +
  "JSON-файлы должны быть валидными и содержать только JSON без markdown-обёртки. " +
  strictSchemaInstruction("{bug_analyze_json_file}", "bug-analysis/v1") +
  strictSchemaInstruction("{bug_fix_design_json_file}", "bug-fix-design/v1") +
  strictSchemaInstruction("{bug_fix_plan_json_file}", "bug-fix-plan/v1");

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
  `Сначала запиши source-of-truth JSON в {mr_description_json_file}. ${strictSchemaInstruction("{mr_description_json_file}", "mr-description/v1")}Затем производную markdown-версию в {mr_description_file}. `;

export const IMPLEMENT_PROMPT_TEMPLATE =
  "Используй только структурированные артефакты как source of truth. " +
  "Проанализируй системный дизайн {design_json_file}, план реализации {plan_json_file} и приступай к реализации по плану. " +
  "Markdown-артефакты предназначены только для чтения человеком и не должны определять реализацию. ";

export const REVIEW_PROMPT_TEMPLATE =
  "Проведи код-ревью текущих изменений. " +
  "Используй только структурированные артефакты как source of truth: задачу в {jira_task_file}, дизайн в {design_json_file} и план в {plan_json_file}. " +
  `Сначала запиши структурированный результат в {review_json_file}. ${strictSchemaInstruction("{review_json_file}", "review-findings/v1")}` +
  "Затем запиши производную markdown-версию в {review_file}. " +
  "Если ready_to_merge=true и нет блокеров, препятствующих merge - создай файл ready-to-merge.md.";

export const REVIEW_PROJECT_PROMPT_TEMPLATE =
  "Проведи код-ревью текущих изменений в проекте без Jira-контекста. " +
  "Оцени качество изменений по текущему коду, тестам, рискам регрессий и общему инженерному качеству. " +
  `Сначала запиши структурированный результат в {review_json_file}. ${strictSchemaInstruction("{review_json_file}", "review-findings/v1")}` +
  "Затем запиши производную markdown-версию в {review_file}. " +
  "Если ready_to_merge=true и нет блокеров, создай файл {ready_to_merge_file}.";

export const GITLAB_DIFF_REVIEW_PROMPT_TEMPLATE =
  "Проведи код-ревью diff merge request из GitLab. " +
  "Используй structured diff artifact {gitlab_diff_json_file} как source of truth, а markdown {gitlab_diff_file} только как удобное представление для чтения человеком. " +
  "Оцени только изменения из diff: корректность, риски регрессий, отсутствие тестов, опасные edge cases, нарушения контрактов и поддерживаемость. " +
  `Сначала запиши структурированный результат в {review_json_file}. ${strictSchemaInstruction("{review_json_file}", "review-findings/v1")}` +
  "Затем запиши производную markdown-версию в {review_file}. " +
  "Если ready_to_merge=true и нет блокеров, создай файл {ready_to_merge_file}.";

export const REVIEW_REPLY_PROMPT_TEMPLATE =
  "Твой коллега провёл код-ревью и записал структурированный результат в {review_json_file}. " +
  "Используй только структурированные артефакты как source of truth: задачу в {jira_task_file}, дизайн в {design_json_file}, план в {plan_json_file} и review в {review_json_file}. " +
  `Сначала запиши структурированный ответ в {review_reply_json_file}. ${strictSchemaInstruction("{review_reply_json_file}", "review-reply/v1")}` +
  "Затем запиши производную markdown-версию в {review_reply_file}.";

export const REVIEW_REPLY_PROJECT_PROMPT_TEMPLATE =
  "Твой коллега провёл код-ревью и записал структурированный результат в {review_json_file}. " +
  "Используй review в {review_json_file} как source of truth, разберись в замечаниях и подготовь структурированный ответ. " +
  `Сначала запиши структурированный ответ в {review_reply_json_file}. ${strictSchemaInstruction("{review_reply_json_file}", "review-reply/v1")}` +
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
  `По завершении сначала запиши структурированный отчёт в {review_fix_json_file}. ${strictSchemaInstruction("{review_fix_json_file}", "review-fix-report/v1")}Затем производную markdown-версию в {review_fix_file}.`;

export const TASK_SUMMARY_PROMPT_TEMPLATE =
  "Посмотри в {jira_task_file}. " +
  "Сделай краткое резюме задачи, на 1-2 абзаца. " +
  `Сначала запиши source-of-truth JSON в {task_summary_json_file}. ${strictSchemaInstruction("{task_summary_json_file}", "task-summary/v1")}Затем markdown-версию в {task_summary_file}.`;

export const JIRA_DESCRIPTION_PROMPT_TEMPLATE =
  "Посмотри задачу в {jira_task_file}. " +
  "Сформируй типичное описание задачи для Jira простым продуктовым языком, без перегруза техническими деталями. " +
  "Структура описания: Проблема, Контекст, Что нужно сделать, Критерии готовности. " +
  "Пиши только то, что помогает понять суть задачи и ожидаемый результат; технические детали, названия внутренних сервисов, моделей данных, файлов, REST-методов и шаги реализации упоминай только если без них теряется смысл задачи. " +
  `Сначала запиши source-of-truth JSON в {jira_description_json_file}. ${strictSchemaInstruction("{jira_description_json_file}", "jira-description/v1")}Затем markdown-версию в {jira_description_file}.`;

export const RUN_GO_TESTS_LOOP_FIX_PROMPT_TEMPLATE =
  "Используй структурированный результат последнего запуска run_go_tests.py из {tests_result_json_file} как source of truth. " +
  "Проанализируй последнюю ошибку проверки, исправь код и подготовь изменения так, чтобы следующий прогон run_go_tests.py прошёл успешно.";
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
