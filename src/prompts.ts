export const BASE_PROMPT_HEADER = "Основная задача:";
export const EXTRA_PROMPT_HEADER = "Дополнительные указания:";

export const PLAN_PROMPT_TEMPLATE =
  "Посмотри и проанализируй задачу в {jira_task_file}. " +
  "Обязательно проанализируй дополнительные материалы из Jira attachments manifest {jira_attachments_manifest_file} и текстовый контекст {jira_attachments_context_file}; если attachment содержит более детальную постановку, ограничения, список файлов, migration strategy или инварианты, считай attachment source of truth для planning наравне с Jira issue. " +
  "Сначала создай структурированные JSON-артефакты, они являются source of truth для следующих flow. " +
  "Человекочитаемые markdown-файлы сделай как подробное производное представление этих JSON-артефактов для пользователя, а не как краткое summary. " +
  "Markdown не должен влиять на структуру JSON: сначала определи корректные JSON-типы, затем строй markdown как производное представление. " +
  "Не схлопывай конкретику из задачи и attachment: сохраняй явные файлы, методы, API, инварианты, migration steps, DB-ограничения, business rules и acceptance criteria. " +
  "Разработай системный дизайн решения и запиши JSON в {design_json_file}, затем markdown в {design_file}. " +
  'Для {design_json_file} используй строго JSON-объект вида { "summary": "string", "goals": ["string"], "non_goals": ["string"], "components": ["string"], "current_state": ["string"], "target_state": ["string"], "affected_code": [{ "area": "string", "files": ["string"], "details": "string" }], "business_rules": ["string"], "decisions": [{ "component": "string", "decision": "string", "rationale": "string" }], "migration_strategy": ["string"], "database_changes": ["string"], "api_changes": ["string"], "risks": ["string"], "acceptance_criteria": ["string"], "open_questions": ["string"] }. ' +
  'Строго соблюдай типы. В частности, current_state и target_state всегда должны быть массивами строк, даже если пункт только один: ["..."], а не "...". ' +
  'Точно так же files, goals, non_goals, components, business_rules, migration_strategy, database_changes, api_changes, risks, acceptance_criteria и open_questions должны быть массивами, а не одиночными строками. ' +
  "Разработай подробный план реализации и запиши JSON в {plan_json_file}, затем markdown в {plan_file}. " +
  'Для {plan_json_file} используй строго JSON-объект вида { "summary": "string", "prerequisites": ["string"], "workstreams": ["string"], "implementation_steps": [{ "id": "string", "title": "string", "details": "string", "affected_files": ["string"], "verification": ["string"], "dependencies": ["string"] }], "tests": ["string"], "rollout_notes": ["string"], "follow_up_items": ["string"] }. ' +
  'Строго соблюдай типы. prerequisites, workstreams, tests, rollout_notes, follow_up_items, affected_files, verification и dependencies всегда должны быть массивами, даже если элемент только один. implementation_steps должен быть массивом объектов, а не одним объектом. ' +
  'Каждый элемент implementation_steps должен иметь вид { "id": "step-1", "title": "string", "details": "string", "affected_files": ["string"], "verification": ["string"], "dependencies": ["string"] }. ' +
  'Нельзя использовать "verification": "..." или "affected_files": "...". Нужно использовать массивы: ["..."]. ' +
  "Разработай план тестирования для QA и запиши JSON в {qa_json_file}, затем markdown в {qa_file}. " +
  'Для {qa_json_file} используй строго JSON-объект вида { "summary": "string", "test_scenarios": [{ "id": "string", "title": "string", "expected_result": "string" }], "non_functional_checks": ["string"] }. ' +
  'Строго соблюдай типы. test_scenarios должен быть массивом объектов, а non_functional_checks должен быть массивом строк, даже если пункт только один. ' +
  "Markdown для design и plan оформи развёрнуто, с отдельными секциями Summary, Current State, Target State, Affected Code, Decisions, Migration/DB Changes, Risks, Implementation Steps, Tests, Rollout. " +
  "JSON-файлы должны быть валидными и содержать только JSON без markdown-обёртки. ";

export const PLAN_QUESTIONS_PROMPT_TEMPLATE =
  "Посмотри и проанализируй задачу в {jira_task_file}. " +
  "Обязательно проанализируй дополнительные материалы из Jira attachments manifest {jira_attachments_manifest_file} и текстовый контекст {jira_attachments_context_file}; если attachment содержит более детальную постановку, ограничения, список файлов, migration strategy или инварианты, считай attachment source of truth для planning наравне с Jira issue. " +
  "Перед финальным planning определи, нужны ли уточнения от пользователя. " +
  'Если уточнения не нужны, запиши в {planning_questions_json_file} строго JSON-объект { "summary": "string", "questions": [] }. ' +
  'Если уточнения нужны, запиши в {planning_questions_json_file} строго JSON-объект { "summary": "string", "questions": [{ "id": "string", "question": "string", "details": "string", "required": true, "multiline": false, "placeholder": "string" }] }. ' +
  'questions всегда должен быть массивом. required и multiline должны быть boolean, а не строками "true"/"false". ' +
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
  'Для {bug_analyze_json_file} используй строго JSON-объект { "summary": "string", "suspected_root_cause": { "hypothesis": "string", "confidence": "string" }, "reproduction_steps": ["string"], "affected_components": ["string"], "evidence": ["string"], "risks": ["string"], "open_questions": ["string"] }. ' +
  'reproduction_steps, affected_components, evidence, risks и open_questions всегда должны быть массивами строк. suspected_root_cause всегда должен быть объектом, а не строкой. ' +
  'Для {bug_fix_design_json_file} используй строго JSON-объект { "summary": "string", "goals": ["string"], "non_goals": ["string"], "target_components": ["string"], "proposed_changes": [{ "component": "string", "change": "string", "rationale": "string" }], "alternatives_considered": [{ "option": "string", "decision": "string", "rationale": "string" }], "risks": ["string"], "validation_strategy": ["string"] }. ' +
  'goals, non_goals, target_components, risks и validation_strategy всегда должны быть массивами строк. proposed_changes и alternatives_considered всегда должны быть массивами объектов. ' +
  'Для {bug_fix_plan_json_file} используй строго JSON-объект { "summary": "string", "prerequisites": ["string"], "implementation_steps": [{ "id": "string", "title": "string", "details": "string" }], "tests": ["string"], "rollout_notes": ["string"] }. ' +
  'prerequisites, tests и rollout_notes всегда должны быть массивами строк. implementation_steps всегда должен быть массивом объектов. ';

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
  'Сначала запиши структурированный результат в {review_json_file} в виде строго JSON-объекта { "summary": "string", "ready_to_merge": true, "findings": [{ "severity": "string", "title": "string", "description": "string" }] }. ' +
  'ready_to_merge должен быть boolean, а не строкой. findings всегда должен быть массивом объектов, даже если замечание одно или их нет. ' +
  "Затем запиши производную markdown-версию в {review_file}. " +
  "Если ready_to_merge=true и нет блокеров, препятствующих merge - создай файл ready-to-merge.md.";

export const REVIEW_PROJECT_PROMPT_TEMPLATE =
  "Проведи код-ревью текущих изменений в проекте без Jira-контекста. " +
  "Оцени качество изменений по текущему коду, тестам, рискам регрессий и общему инженерному качеству. " +
  'Сначала запиши структурированный результат в {review_json_file} в виде строго JSON-объекта { "summary": "string", "ready_to_merge": true, "findings": [{ "severity": "string", "title": "string", "description": "string" }] }. ' +
  'ready_to_merge должен быть boolean, а findings всегда должен быть массивом объектов. ' +
  "Затем запиши производную markdown-версию в {review_file}. " +
  "Если ready_to_merge=true и нет блокеров, создай файл {ready_to_merge_file}.";

export const GITLAB_DIFF_REVIEW_PROMPT_TEMPLATE =
  "Проведи код-ревью diff merge request из GitLab. " +
  "Используй structured diff artifact {gitlab_diff_json_file} как source of truth, а markdown {gitlab_diff_file} только как удобное представление для чтения человеком. " +
  "Оцени только изменения из diff: корректность, риски регрессий, отсутствие тестов, опасные edge cases, нарушения контрактов и поддерживаемость. " +
  'Сначала запиши структурированный результат в {review_json_file} в виде строго JSON-объекта { "summary": "string", "ready_to_merge": true, "findings": [{ "severity": "string", "title": "string", "description": "string" }] }. ' +
  'ready_to_merge должен быть boolean, а findings всегда должен быть массивом объектов. ' +
  "Затем запиши производную markdown-версию в {review_file}. " +
  "Если ready_to_merge=true и нет блокеров, создай файл {ready_to_merge_file}.";

export const REVIEW_REPLY_PROMPT_TEMPLATE =
  "Твой коллега провёл код-ревью и записал структурированный результат в {review_json_file}. " +
  "Используй только структурированные артефакты как source of truth: задачу в {jira_task_file}, дизайн в {design_json_file}, план в {plan_json_file} и review в {review_json_file}. " +
  'Сначала запиши структурированный ответ в {review_reply_json_file} в виде строго JSON-объекта { "summary": "string", "ready_to_merge": true, "responses": [{ "finding_title": "string", "disposition": "string", "action": "string" }] }. ' +
  'ready_to_merge должен быть boolean, а responses всегда должен быть массивом объектов. ' +
  "Затем запиши производную markdown-версию в {review_reply_file}.";

export const REVIEW_REPLY_PROJECT_PROMPT_TEMPLATE =
  "Твой коллега провёл код-ревью и записал структурированный результат в {review_json_file}. " +
  "Используй review в {review_json_file} как source of truth, разберись в замечаниях и подготовь структурированный ответ. " +
  'Сначала запиши структурированный ответ в {review_reply_json_file} в виде строго JSON-объекта { "summary": "string", "ready_to_merge": true, "responses": [{ "finding_title": "string", "disposition": "string", "action": "string" }] }. ' +
  'ready_to_merge должен быть boolean, а responses всегда должен быть массивом объектов. ' +
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
  'По завершении сначала запиши структурированный отчёт в {review_fix_json_file} в виде строго JSON-объекта { "summary": "string", "completed_actions": ["string"], "validation_steps": ["string"] }, затем производную markdown-версию в {review_fix_file}. ' +
  'completed_actions и validation_steps всегда должны быть массивами строк, даже если пункт только один.';

export const TASK_SUMMARY_PROMPT_TEMPLATE =
  "Посмотри в {jira_task_file}. " +
  "Сделай краткое резюме задачи, на 1-2 абзаца. " +
  "Сначала запиши source-of-truth JSON в {task_summary_json_file} в виде объекта { summary: string }, затем markdown-версию в {task_summary_file}.";

export const JIRA_DESCRIPTION_PROMPT_TEMPLATE =
  "Посмотри задачу в {jira_task_file}. " +
  "Сформируй типичное описание задачи для Jira простым продуктовым языком, без перегруза техническими деталями. " +
  "Структура описания: Проблема, Контекст, Что нужно сделать, Критерии готовности. " +
  "Пиши только то, что помогает понять суть задачи и ожидаемый результат; технические детали, названия внутренних сервисов, моделей данных, файлов, REST-методов и шаги реализации упоминай только если без них теряется смысл задачи. " +
  "Сначала запиши source-of-truth JSON в {jira_description_json_file} в виде объекта { summary: string }, затем markdown-версию в {jira_description_file}.";

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
