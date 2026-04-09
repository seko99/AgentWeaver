# RFC: `llm-prompt` и обязательный pre-run выбор профиля в UI

## Статус

- Статус: draft (утверждённые продуктовые решения зафиксированы)
- Дата: 2026-04-09
- Контекст: запуск flow с выбором executor/model до старта

## 1. Цель

Добавить возможность **обязательного выбора конфигурации LLM перед запуском flow в UI**:

- выбор `executor` и `model` на **уровне всего flow**;
- вариант `default` должен быть доступен;
- конфигурация запуска фиксируется и сохраняется в state;
- при `Resume` смена конфигурации запрещена;
- для `auto` и любого resumable flow профиль фиксируется на весь run.

## 2. Нефункциональные ограничения

1. Built-in поведение не должно ломаться: без override всё работает как сейчас.
2. Ноды `opencode-prompt` / `codex-local-prompt` / `claude-prompt` сохраняются (backward compatibility).
3. Начальная миграция — только `plan-opencode`.
4. Валидацию `params.executor` на этапе spec-validator пока не добавляем (runtime-check в новой ноде).

## 3. Продуктовые решения (зафиксированные)

### 3.1 Scope выбора

- Выбор профиля делается на **весь flow**, не на отдельные шаги.
- Шаг выбора в UI — **обязательный** перед запуском, но позволяет выбрать `default`.
- Профили (presets вроде fast/cheap/quality) пока не вводим.

### 3.2 Resume и state

- `Resume` всегда использует **сохранённый** профиль запуска.
- Смена executor/model для resume-run **запрещена**.
- Для `auto` профиль фиксируется на весь run.

### 3.3 Контракт `llm-prompt`

Минимальный контракт:

- `executor` (required)
- `model` (optional)
- `command` (optional)
- `labelText`
- `requiredArtifacts`
- `missingArtifactsMessage`

### 3.4 Разрешённые executors и модели

На первом этапе список жёсткий.

- `codex-local`: `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.3-codex`
- `opencode`: `opencode/minimax-m2.5-free`, `minimax-coding-plan/MiniMax-M2.7`
- `claude`: `opus`, `sonnet`

Источник истины — конфиг (не хардкод прямо в UI-компоненте).

### 3.5 Приоритеты резолвинга

1. UI override
2. flow params
3. env var (`OPENCODE_MODEL` / `CODEX_MODEL` / `CLAUDE_MODEL`)
4. executor default

## 4. Предлагаемые изменения по слоям

## 4.1 Конфиг launch-профиля

Добавить конфиг (например, `src/pipeline/launch-profile-config.ts`):

- `allowedExecutors: ["codex-local", "opencode", "claude"]`
- `allowedModelsByExecutor: Record<ExecutorId, string[]>`
- `defaultPolicy` (как интерпретировать `default`: без явного `model`, использовать стандартный текущий путь резолва)

Цель: единый источник для UI и runtime-валидации.

## 4.2 Новая нода `llm-prompt`

Добавить `src/pipeline/nodes/llm-prompt-node.ts`.

Поведение:

1. Получает `executor` и проверяет, что executor входит в разрешённый список.
2. Если `model` задан, проверяет совместимость `model` с выбранным executor.
3. Делегирует выполнение в соответствующий executor registry:
   - `codex-local`
   - `opencode`
   - `claude`
4. Возвращает outputs/checks по аналогии с текущими prompt-нодами.

Важно: старые prompt-ноды оставить без изменений.

## 4.3 Node registry

- Расширить `NodeKind` и `builtInNodes` новым `llm-prompt`.
- Metadata для ноды:
  - `prompt: "required"`
  - `requiredParams: ["labelText", "executor"]`
  - без жёсткой привязки к одному executor в metadata (проверка на runtime).

## 4.4 UI pre-run форма

Перед подтверждением запуска/непосредственным запуском:

1. Показать форму выбора launch-конфига:
   - `executor` (`default` + значения из allowlist)
   - `model` (`default` + список моделей выбранного executor)
2. Сохранить результат как `launchProfile` для run.
3. Показать панель **Effective Launch Config** перед стартом.

UX-правило:

- форма обязательна всегда;
- `default` — валидный выбор, не требует ручного ввода модели.

## 4.5 Проброс параметров в flow

Расширить `defaultDeclarativeFlowParams(...)` runtime-полями:

- `llmExecutor`
- `llmModel`
- `launchProfile`

Для `plan-opencode` в первом этапе:

- миграция нужного шага на `llm-prompt`;
- `params.executor` и `params.model` брать из новых `params.*` с fallback к текущим значениям для совместимости.

## 4.6 State и Resume-guard

Расширить `FlowRunState`:

- `launchProfile?: { executor: string | "default"; model: string | "default"; resolvedExecutor?: string; resolvedModel?: string | null; fingerprint: string }`

Правила:

1. На первом запуске вычислить `fingerprint` effective-конфига и сохранить.
2. На `Resume` игнорировать новый UI-ввод и использовать сохранённый профиль.
3. Если сохранённый профиль отсутствует/битый — `Resume unavailable`, только `Restart`.

## 5. Out of scope (этап 1)

- Миграция всех flow на `llm-prompt`.
- Управление profile presets.
- Расширенная статическая валидация `spec-validator` для `params.executor`.
- Переключение executor/model на уровне отдельных шагов.

## 6. Риски и меры

1. **Дрейф воспроизводимости при resume**
   - Мера: fingerprint в state + запрет изменения на resume.
2. **Несовместимый model/executor выбор**
   - Мера: жёсткий allowlist в конфиге + runtime validation в `llm-prompt`.
3. **Поведенческие регрессии built-in команд**
   - Мера: без override поведение 1:1 как сейчас; старые ноды не удаляются.
4. **Понижение качества structured output при смене модели**
   - Мера: сохранить/усилить `require-structured-artifacts` в flow-шагах.

## 7. План внедрения

### Этап A (MVP)

1. Добавить launch-profile конфиг с allowlist executor/model.
2. Добавить `llm-prompt` ноду и зарегистрировать её.
3. Добавить pre-run обязательную форму в UI (`default` + выбор executor/model).
4. Прокинуть `llmExecutor`/`llmModel` в `flowParams`.
5. Мигрировать только `plan-opencode` шаг `generate_task_summary` на `llm-prompt`.
6. Добавить Effective Launch Config панель в лог перед стартом.

### Этап B (стабилизация)

1. Расширить state и resume-guard по fingerprint.
2. Явно обработать старые state без launchProfile (graceful fallback: restart-only).
3. Доработать сообщения в confirm/details для пользователя.

## 8. Критерии приёмки

1. UI не даёт запустить flow без прохождения pre-run выбора.
2. `default` путь запуска полностью повторяет текущее поведение.
3. `plan-opencode` можно запустить с выбранным executor/model через UI.
4. При `Resume` нельзя поменять конфиг запуска; используется сохранённый.
5. В логе перед стартом отображается effective executor/model.
6. Старые flow, использующие старые prompt-ноды, продолжают работать без изменений.

