# Дизайн поддержки Jira Cloud (Basic auth + username)

## Контекст
Сейчас интеграция Jira использует только `JIRA_API_KEY` и всегда отправляет заголовок `Authorization: Bearer <token>`.
Это корректно для части self-hosted Jira/DC сценариев, но не для Jira Cloud.
Для Jira Cloud требуется Basic auth с парой `email(username) + API token`.

В текущей реализации:
- URL API формируется как `<base>/rest/api/2/issue/<KEY>`;
- авторизация захардкожена в `src/jira.ts`;
- в executor-конфиге есть только один auth env var (`JIRA_API_KEY`).

## Цели
1. Автоматически определять Cloud-инстанс по URL (`atlassian` в host).
2. Для Cloud использовать Basic auth (`username + token`).
3. Для Server/DC сохранить обратную совместимость с Bearer (`JIRA_API_KEY`).
4. Сделать поведение явным и диагностируемым в ошибках.

## Не-цели
- Не меняем пайплайны flow-spec и структуру артефактов Jira.
- Не вводим OAuth 2.0/3LO на этом этапе.
- Не делаем дополнительный discovery endpoint для типа инстанса (достаточно детектора по URL).

## Предлагаемая модель конфигурации

### Новые env-переменные
- `JIRA_USERNAME` — username/email для Jira Cloud Basic auth.
- `JIRA_AUTH_MODE` (опционально) — `auto | basic | bearer`, по умолчанию `auto`.

Существующая переменная:
- `JIRA_API_KEY` — токен (и для Cloud API token, и для Bearer-сценария).

### Правила выбора авторизации
1. Если `JIRA_AUTH_MODE=basic` → всегда Basic, требуются `JIRA_USERNAME + JIRA_API_KEY`.
2. Если `JIRA_AUTH_MODE=bearer` → всегда Bearer, требуется `JIRA_API_KEY`.
3. Если `JIRA_AUTH_MODE=auto` (default):
   - если host URL содержит `atlassian` → Basic;
   - иначе → Bearer.

Примечание: правило "contains atlassian" применяется к `jiraApiUrl` (или к browse/base URL до нормализации).

## Изменения в коде

### 1) Выделить стратегию авторизации в отдельный слой
Добавить в `src/jira.ts` (или в новый `src/jira-auth.ts`) функции:
- `detectJiraDeployment(url: string): "cloud" | "server"`
- `resolveJiraAuthMode(url: string): "basic" | "bearer"`
- `buildJiraAuthHeaders(url: string): Record<string, string>`

`buildJiraAuthHeaders`:
- для Basic формирует `Authorization: Basic <base64(username:token)>`;
- для Bearer — `Authorization: Bearer <token>`;
- добавляет проверку обязательных env и понятные ошибки.

После этого `fetchAuthorizedBuffer(...)` перестаёт напрямую читать только `JIRA_API_KEY` и использует `buildJiraAuthHeaders`.

### 2) Актуализировать executor config
Расширить `JiraFetchExecutorConfig`:
- добавить `usernameEnvVar?: string` (default: `JIRA_USERNAME`),
- добавить `authModeEnvVar?: string` (default: `JIRA_AUTH_MODE`).

Даже если фактическая логика пока в `jira.ts`, конфиг станет самодокументируемым и пригодным для кастомных executor-конфигов.

### 3) Улучшить ошибки и observability
Ошибки валидации:
- Cloud+Basic без `JIRA_USERNAME`:
  - `JIRA_USERNAME is required for Jira Cloud Basic auth (detected from URL host: ...).`
- любой режим без `JIRA_API_KEY`:
  - `JIRA_API_KEY is required for Jira authentication.`
- `JIRA_AUTH_MODE` вне допустимых значений:
  - `JIRA_AUTH_MODE must be one of: auto, basic, bearer.`

Опционально в verbose-режиме логировать только тип auth (`basic/bearer`) без секретов.

## Изменения в документации
1. `README.md`:
   - обновить раздел ENV:
     - `JIRA_API_KEY` — token;
     - `JIRA_USERNAME` — обязателен для Cloud;
     - `JIRA_AUTH_MODE` — optional override.
   - добавить примеры для Cloud и Server/DC.
2. Help-текст в `src/index.ts`:
   - заменить формулировку про "Bearer only" на авто-режим.

## Обратная совместимость
- Для существующих Server/DC установок ничего не ломается: при `auto` будет выбран Bearer.
- Для Cloud установок потребуется добавить `JIRA_USERNAME`.
- При необходимости временного обхода можно явно поставить `JIRA_AUTH_MODE=bearer`.

## План реализации (итеративно)
1. Ввести функции определения режима и построения заголовков.
2. Перевести `fetchAuthorizedBuffer` на новый слой.
3. Добавить unit-тесты для матрицы URL × режим × env.
4. Обновить README и help-тексты CLI.
5. Проверить smoke-сценарии:
   - Cloud URL (`*.atlassian.net`) + Basic;
   - Server URL (`jira.company.local`) + Bearer;
   - невалидные конфиги.

## Тестовая матрица (минимум)
1. `auto + https://company.atlassian.net/...` + username+token → Basic.
2. `auto + https://jira.company.local/...` + token → Bearer.
3. `basic + atlassian URL` без username → ошибка.
4. `basic + non-atlassian URL` c username+token → Basic (manual override).
5. `bearer + atlassian URL` + token → Bearer (manual override).
6. `JIRA_AUTH_MODE=foo` → ошибка валидации.

## Риски и решения
- Риск: эвристика `host contains atlassian` может дать false positive.
  - Решение: сохранить `JIRA_AUTH_MODE` override.
- Риск: путаница "username" vs "email" для Cloud.
  - Решение: в README явно писать "Atlassian account email".

## Критерии готовности
- Cloud-инстанс с URL `*.atlassian.net` успешно читает issue через Basic auth.
- Существующий Bearer-сценарий продолжает работать без изменений env.
- В ошибках явно указано, каких переменных не хватает.
