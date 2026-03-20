BASE_PROMPT_HEADER = "Основная задача:"
EXTRA_PROMPT_HEADER = "Дополнительные указания:"

PLAN_PROMPT_TEMPLATE = (
    "Посмотри и проанализируй задачу в {jira_task_file}. "
    "Разработай системный дизайн решения, запиши в {design_file}. "
    "Разработай подробный план реализации и запиши его в {plan_file}. "
    "Разработай план тестирования для QA и запиши в {qa_file}. "
)
IMPLEMENT_PROMPT_TEMPLATE = (
    "Проанализируй системный дизайн {design_file}, план реализации {plan_file} и приступай к реализации по плану. "
    "По окончании обязательно прогони вне песочницы линтер, все тесты, сгенерируй make swagger. "
    "Исправь ошибки линтера и тестов, если будут."
)
REVIEW_PROMPT_TEMPLATE = (
    "Проведи код-ревью текущих изменений. "
    "Сверься с задачей в {jira_task_file}, дизайном {design_file} и планом {plan_file}. "
    "Замечания и комментарии запиши в {review_file}. "
    "Если больше нет блокеров, препятствующих merge - создай файл ready-to-merge.md."
)
REVIEW_REPLY_PROMPT_TEMPLATE = (
    "Твой коллега провёл код-ревью и записал комментарии в {review_file}. "
    "Проанализируй комментарии к код-ревью, сверься с задачей в {jira_task_file}, "
    "дизайном {design_file}, планом {plan_file} и запиши свои комментарии в {review_reply_file}."
)
REVIEW_SUMMARY_PROMPT_TEMPLATE = (
    "Посмотри в {review_file}. "
    "Сделай краткий список комментариев без подробностей, 3-7 пунктов. "
    "Запиши результат в {review_summary_file}."
)
REVIEW_REPLY_SUMMARY_PROMPT_TEMPLATE = (
    "Посмотри в {review_reply_file}. "
    "Сделай краткий список ответов и итоговых действий без подробностей, 3-7 пунктов. "
    "Запиши результат в {review_reply_summary_file}."
)
REVIEW_FIX_PROMPT_TEMPLATE = (
    "Проанализируй комментарии в {review_reply_file}. "
    "Исправь то, что содержится в дополнительных указаниях, а если таковых нет - исправь все пункты. "
    "По окончании обязательно прогони вне песочницы линтер, все тесты, сгенерируй make swagger. "
    "Исправь ошибки линтера и тестов, если будут. "
    "По завершении резюме запиши в {review_fix_file}."
)
TASK_SUMMARY_PROMPT_TEMPLATE = (
    "Посмотри в {jira_task_file}. "
    "Сделай краткое резюме задачи, на 1-2 абзаца, "
    "запиши в {task_summary_file}."
)
TEST_FIX_PROMPT_TEMPLATE = "Прогони тесты, исправь ошибки."
TEST_LINTER_FIX_PROMPT_TEMPLATE = "Прогони линтер, исправь замечания."
AUTO_REVIEW_FIX_EXTRA_PROMPT = "Исправлять только блокеры, критикалы и важные"


def format_prompt(base_prompt: str, extra_prompt: str | None = None) -> str:
    sections = [f"{BASE_PROMPT_HEADER}\n{base_prompt.strip()}"]

    if extra_prompt and extra_prompt.strip():
        sections.append(f"{EXTRA_PROMPT_HEADER}\n{extra_prompt.strip()}")

    return "\n\n".join(sections)
