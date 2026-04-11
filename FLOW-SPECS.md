# Flow Specs

## Зачем нужен этот файл

`src/pipeline/flow-specs/*.json` описывают встроенные pipeline декларативно.

Дополнительно flow можно положить в `.agentweaver/.flows/*.json` в текущем проекте.

Обе группы flow проходят одинаковую runtime-валидацию при загрузке.

Идея такая:

- JSON отвечает за то, **что** выполнять
- `node` runtime в TypeScript отвечает за то, **как** это выполнять

На практике это означает:

- flow spec выбирает phases и steps
- step выбирает `node`
- step описывает `prompt`
- step описывает runtime `params`
- step описывает `expect`, то есть postconditions после выполнения node

Этот документ объясняет, как читать flow spec и где проходит граница ответственности.

## Где может лежать flow

- built-in flow: `src/pipeline/flow-specs/*.json`
- project-local flow: `.agentweaver/.flows/*.json`

Для project-local flow действуют ограничения:

- поддерживаются только файлы верхнего уровня в `.agentweaver/.flows`
- `id` flow берётся из имени файла без `.json`
- конфликт `id` с built-in flow считается ошибкой загрузки

При загрузке flow валидируются:

- `node`
- executor-зависимости, объявленные в metadata соответствующего node
- `prompt.templateRef`
- `artifact.kind`
- `artifactList.kind`
- `StructuredArtifactSchemaId`
- ссылки `ref` между шагами

Для `flow-run` дополнительно проверяется существование вложенного flow, если `params.fileName` задан константой.

## Базовые сущности

### `kind`

Тип flow spec.

Пример:

```json
{
  "kind": "auto-flow"
}
```

### `version`

Версия формата flow spec.

### `constants`

Набор констант, которые можно переиспользовать внутри spec через `ref: "flow.<name>"`.

Пример:

```json
{
  "constants": {
    "autoReviewFixExtraPrompt": "Исправлять только блокеры, критикалы и важные"
  }
}
```

### `phases`

Верхний уровень `auto`.

Именно `phase.id` сейчас становится:

- phase id в `auto --help-phases`
- id phase в persisted flow state для `auto`
- значением для `auto --from <phase>`

Примеры:

- `plan`
- `task_describe`
- `implement`
- `test_after_implement`
- `review_1`
- `review_fix_1`

### `steps`

Внутренние действия внутри одной phase.

Например, phase `plan` состоит из двух steps:

1. `fetch_jira`
2. `run_codex_plan`

## Что делает step

Каждый step описывает:

- `id` — стабильный идентификатор шага внутри phase
- `node` — какой runtime node нужно вызвать
- `when` — условие запуска
- `prompt` — как собрать prompt
- `params` — какие runtime-параметры передать в node
- `expect` — что должно быть истинно после выполнения step
- `after` — какие side effects выполнить после успешного завершения step

Для `codex` и `opencode` модель теперь тоже считается частью `params`.

Важно:

- runtime во время текущего запуска может держать `step.value` и `step.outputs` в памяти, чтобы следующие шаги могли ссылаться на результаты через `ref`
- persisted flow state сохраняет только компактный execution state: статусы, timestamps, `repeatVars` и `stopFlow`
- большие agent outputs в persisted flow state не сериализуются

Общий шаблон:

```json
{
  "id": "run_codex_plan",
  "node": "codex-prompt",
  "prompt": { "...": "..." },
  "params": { "...": "..." },
  "expect": [ { "...": "..." } ],
  "after": [ { "...": "..." } ]
}
```

## Что делает `node`

`node` в JSON не содержит реализации.

Это ссылка на runtime node в коде.

Примеры:

- `jira-fetch`
- `fetch-gitlab-diff`
- `codex-prompt`

Runtime находит node через registry:

- [src/pipeline/node-registry.ts](/home/seko/Projects/ai/AgentWeaver/src/pipeline/node-registry.ts)

А сами node-ы живут в:

- [src/pipeline/nodes/](/home/seko/Projects/ai/AgentWeaver/src/pipeline/nodes)

Важно:

- JSON не описывает subprocess напрямую
- JSON не знает argv/env/docker flags
- JSON только говорит: "вызови node `X` с такими params"

## Что делает `prompt`

`prompt` отвечает только за сборку итогового текста prompt.

Обычно внутри есть:

- `templateRef` — ссылка на prompt template
- `vars` — переменные для подстановки
- `extraPrompt` — дополнительные указания
- `format` — как оформить prompt

Пример:

```json
"prompt": {
  "templateRef": "plan",
  "vars": {
    "jira_task_file": {
      "artifact": {
        "kind": "jira-task-file",
        "taskKey": { "ref": "params.taskKey" }
      }
    }
  },
  "extraPrompt": { "ref": "params.extraPrompt" },
  "format": "task-prompt"
}
```

Это значит:

1. взять шаблон `plan`
2. вычислить переменные
3. подставить их в шаблон
4. при наличии добавить `extraPrompt`
5. передать итоговую строку в `params.prompt` для node

Где это реализовано:

- [src/pipeline/prompt-registry.ts](/home/seko/Projects/ai/AgentWeaver/src/pipeline/prompt-registry.ts)
- [src/pipeline/prompt-runtime.ts](/home/seko/Projects/ai/AgentWeaver/src/pipeline/prompt-runtime.ts)

## Что делают `params`

`params` — это runtime input конкретного node.

Примеры:

Для `jira-fetch`:

- `jiraApiUrl`
- `outputFile`

Для `codex-prompt`:

- `labelText`
- `model`

То есть:

- `prompt` отвечает за текст задания
- `params` отвечает за остальные runtime-параметры node

Важно:

- `params` не должны описывать flow-level postconditions
- если нужно сказать, какие файлы обязаны появиться после шага, для этого есть `expect`
- для `codex` и `opencode` именно `params.model` теперь определяет модель на уровне flow
- summary-steps в built-in flow могут использовать prompt-ноды с `outputFile` и `summaryTitle`

## Что делает `expect`

`expect` — это flow-level postconditions.

Они выполняются после завершения node.

Сейчас поддерживаются:

- `require-artifacts`
- `require-structured-artifacts`
- `require-file`
- `step-output`

Пример:

```json
"expect": [
  {
    "kind": "require-artifacts",
    "paths": {
      "artifactList": {
        "kind": "plan-artifacts",
        "taskKey": { "ref": "params.taskKey" }
      }
    },
    "message": "Plan mode did not produce the required artifacts."
  }
]
```

Это значит:

1. выполнить node
2. вычислить `paths`
3. проверить, что все эти файлы существуют
4. если нет, упасть с `message`

Для structured JSON-артефактов есть отдельная postcondition:

```json
"expect": [
  {
    "kind": "require-structured-artifacts",
    "items": [
      {
        "path": {
          "artifact": {
            "kind": "review-json-file",
            "taskKey": { "ref": "params.taskKey" },
            "iteration": { "ref": "params.iteration" }
          }
        },
        "schemaId": "review-findings/v1"
      }
    ],
    "message": "Codex review produced invalid structured artifacts."
  }
]
```

Это значит:

1. выполнить node
2. вычислить пути к JSON-артефактам
3. провалидировать каждый файл по указанной schema
4. если JSON отсутствует или невалиден, упасть с `message`

Где это реализовано:

- [src/pipeline/declarative-flow-runner.ts](/home/seko/Projects/ai/AgentWeaver/src/pipeline/declarative-flow-runner.ts)
- [src/pipeline/checks.ts](/home/seko/Projects/ai/AgentWeaver/src/pipeline/checks.ts)

Важно:

- если step задаёт `expect`, declarative runner использует именно его как источник postconditions
- встроенные node-level checks для такого шага пропускаются, чтобы не было дублирования
- legacy flow, которые вызывают node напрямую, продолжают использовать built-in checks node
- `step-output` проверяется по runtime execution state текущего запуска, а не по persisted auto state на диске

## Что делает `after`

`after` — это declarative post-step side effects.

В отличие от `expect`, это не валидация, а изменение runtime state после успешного шага.

Сейчас поддерживается:

- `set-summary-from-file`

Пример:

```json
"after": [
  {
    "kind": "set-summary-from-file",
    "path": {
      "artifact": {
        "kind": "task-summary-file",
        "taskKey": { "ref": "params.taskKey" }
      }
    }
  }
]
```

Это значит:

1. вычислить путь к файлу
2. прочитать файл
3. передать текст в `context.setSummary(...)`

Такой механизм нужен, когда flow должен обновить interactive runtime state без отдельной special-case node.

## Что делают `ref`, `artifact`, `artifactList`, `template`

Это не значения сами по себе, а декларативные способы их вычислить.

### `ref`

Ссылка на уже существующее значение.

Примеры:

- `params.taskKey`
- `params.jiraApiUrl`
- `params.extraPrompt`
- `flow.autoReviewFixExtraPrompt`
- `repeat.iteration`

### `artifact`

Вычислить путь к одному артефакту.

Пример:

```json
{
  "artifact": {
    "kind": "plan-file",
    "taskKey": { "ref": "params.taskKey" }
  }
}
```

Это только вычисление пути, а не проверка существования файла.

### `artifactList`

Вычислить список путей.

Пример:

```json
{
  "artifactList": {
    "kind": "plan-artifacts",
    "taskKey": { "ref": "params.taskKey" }
  }
}
```

### `template`

Локальный string template для вычисления param.

Пример:

```json
{
  "template": "Running Codex review mode (iteration {iteration})",
  "vars": {
    "iteration": { "ref": "repeat.iteration" }
  }
}
```

## Подробный разбор `plan`

Ниже тот же блок `plan`, но с пояснениями.

```json
{
  "id": "plan",
  "steps": [
    {
      "id": "fetch_jira",
      "node": "jira-fetch",
      "params": {
        "jiraApiUrl": { "ref": "params.jiraApiUrl" },
        "outputFile": {
          "artifact": {
            "kind": "jira-task-file",
            "taskKey": { "ref": "params.taskKey" }
          }
        }
      },
      "expect": [
        {
          "kind": "require-file",
          "path": {
            "artifact": {
              "kind": "jira-task-file",
              "taskKey": { "ref": "params.taskKey" }
            }
          },
          "message": "Jira fetch node did not produce the Jira task file."
        }
      ]
    },
    {
      "id": "run_codex_plan",
      "node": "codex-prompt",
      "prompt": {
        "templateRef": "plan",
        "vars": {
          "jira_task_file": {
            "artifact": {
              "kind": "jira-task-file",
              "taskKey": { "ref": "params.taskKey" }
            }
          },
          "design_file": {
            "artifact": {
              "kind": "design-file",
              "taskKey": { "ref": "params.taskKey" }
            }
          },
          "plan_file": {
            "artifact": {
              "kind": "plan-file",
              "taskKey": { "ref": "params.taskKey" }
            }
          },
          "qa_file": {
            "artifact": {
              "kind": "qa-file",
              "taskKey": { "ref": "params.taskKey" }
            }
          }
        },
        "extraPrompt": { "ref": "params.extraPrompt" },
        "format": "task-prompt"
      },
      "params": {
        "labelText": { "const": "Running Codex planning mode" }
      },
      "expect": [
        {
          "kind": "require-artifacts",
          "paths": {
            "artifactList": {
              "kind": "plan-artifacts",
              "taskKey": { "ref": "params.taskKey" }
            }
          },
          "message": "Plan mode did not produce the required artifacts."
        }
      ]
    }
  ]
}
```

### Phase `plan`

```json
{
  "id": "plan"
}
```

Это user-facing стадия `auto`.

Именно она:

- видна пользователю
- хранится в auto state
- используется в `auto --from plan`

### Step `fetch_jira`

```json
{
  "id": "fetch_jira",
  "node": "jira-fetch"
}
```

Этот step говорит:

- взять runtime node `jira-fetch`
- вычислить `params`
- после выполнения проверить `expect`

Его runtime params:

```json
"params": {
  "jiraApiUrl": { "ref": "params.jiraApiUrl" },
  "outputFile": {
    "artifact": {
      "kind": "jira-task-file",
      "taskKey": { "ref": "params.taskKey" }
    }
  }
}
```

После resolve node получит примерно:

```json
{
  "jiraApiUrl": "https://jira.example.com/rest/api/...",
  "outputFile": "/work/.agentweaver-DEMO-123/DEMO-123.json"
}
```

Что делает node:

- [src/pipeline/nodes/jira-fetch-node.ts](/home/seko/Projects/ai/AgentWeaver/src/pipeline/nodes/jira-fetch-node.ts)
- вызывает executor `jira-fetch`
- создаёт Jira JSON файл

Что делает `expect`:

```json
"expect": [
  {
    "kind": "require-file",
    "path": {
      "artifact": {
        "kind": "jira-task-file",
        "taskKey": { "ref": "params.taskKey" }
      }
    },
    "message": "Jira fetch node did not produce the Jira task file."
  }
]
```

Это flow-level проверка:

- какой файл должен появиться
- с каким сообщением падать, если его нет

То есть для `fetch_jira`:

- `params` задают input node
- `expect` задаёт postcondition flow

### Step `run_codex_plan`

```json
{
  "id": "run_codex_plan",
  "node": "codex-prompt"
}
```

Этот step говорит:

- взять generic node `codex-prompt`
- собрать для него prompt
- передать runtime params
- после выполнения проверить expected outputs

#### Что делает `prompt`

```json
"prompt": {
  "templateRef": "plan",
  "vars": {
    "jira_task_file": "...",
    "design_file": "...",
    "plan_file": "...",
    "qa_file": "..."
  },
  "extraPrompt": { "ref": "params.extraPrompt" },
  "format": "task-prompt"
}
```

Это значит:

- взять template `plan`
- вычислить пути к файлам
- подставить их
- при наличии добавить `extraPrompt`

Итог уйдёт в `params.prompt` для node.

#### Что делает `params`

```json
"params": {
  "labelText": { "const": "Running Codex planning mode" }
}
```

Это уже runtime contract node.

Здесь сказано только:

- что показать в UI перед запуском

Node получит примерно:

```json
{
  "prompt": "<готовый текст prompt>",
  "labelText": "Running Codex planning mode"
}
```

#### Что делает `expect`

```json
"expect": [
  {
    "kind": "require-artifacts",
    "paths": {
      "artifactList": {
        "kind": "plan-artifacts",
        "taskKey": { "ref": "params.taskKey" }
      }
    },
    "message": "Plan mode did not produce the required artifacts."
  }
]
```

Это уже не runtime input node.

Это описание того, что flow считает корректным результатом шага:

- после выполнения должны существовать `design`, `plan`, `qa`

То есть на примере `plan` ответственность распределена так:

- JSON `prompt` описывает текст задания
- JSON `params` описывает runtime input node
- JSON `expect` описывает expected outputs
- node runtime выполняет работу
- flow runtime проверяет postconditions

## Итоговое правило ответственности

### В JSON spec живёт

- sequencing
- phase ids
- выбор node
- prompt template
- prompt variables
- runtime params node
- flow-level postconditions через `expect`

### В runtime node живёт

- вызов executor
- печать UI
- внутренний runtime contract node
- node-specific checks, если они являются частью самого node

### В declarative flow runner живёт

- resolve `prompt`
- resolve `params`
- выполнение `node`
- выполнение `expect`
- хранение runtime `step.value`/`step.outputs` в памяти только на время текущего запуска

### В persisted auto state живёт

- phase statuses
- step statuses
- timestamps
- `repeatVars`
- `terminationReason`
- `stopFlow`

И не живёт:

- полный agent `output`
- `step.value`
- `step.outputs`

## Почему `expect` лучше, чем старый `requiredArtifacts` в `params`

Потому что теперь граница ответственности чище:

- `params` описывает только runtime input node
- `expect` описывает только flow-level postconditions

Node больше не должен знать, какие именно артефакты flow считает обязательными, если это не часть собственного runtime contract.

## Где смотреть реализацию

- spec: [src/pipeline/flow-specs/auto.json](/home/seko/Projects/ai/AgentWeaver/src/pipeline/flow-specs/auto.json)
- loader: [src/pipeline/spec-loader.ts](/home/seko/Projects/ai/AgentWeaver/src/pipeline/spec-loader.ts)
- validator: [src/pipeline/spec-validator.ts](/home/seko/Projects/ai/AgentWeaver/src/pipeline/spec-validator.ts)
- compiler: [src/pipeline/spec-compiler.ts](/home/seko/Projects/ai/AgentWeaver/src/pipeline/spec-compiler.ts)
- value resolver: [src/pipeline/value-resolver.ts](/home/seko/Projects/ai/AgentWeaver/src/pipeline/value-resolver.ts)
- prompt runtime: [src/pipeline/prompt-runtime.ts](/home/seko/Projects/ai/AgentWeaver/src/pipeline/prompt-runtime.ts)
- declarative runner: [src/pipeline/declarative-flow-runner.ts](/home/seko/Projects/ai/AgentWeaver/src/pipeline/declarative-flow-runner.ts)
- node registry: [src/pipeline/node-registry.ts](/home/seko/Projects/ai/AgentWeaver/src/pipeline/node-registry.ts)

## Короткий итог

На примере `plan`:

- `fetch_jira` создаёт Jira JSON
- `run_codex_plan` запускает Codex с prompt `plan`
- `prompt` отвечает за текст задания
- `params` отвечает за runtime input node
- `expect` отвечает за обязательные выходные артефакты
- flow runtime проверяет, что эти файлы реально появились
