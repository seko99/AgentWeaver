# Плагинный SDK AgentWeaver

## Поддерживаемая граница импорта

Для написания плагинов используйте только `agentweaver/plugin-sdk`.

Не используйте:

- `agentweaver`
- `agentweaver/dist/*`
- `agentweaver/src/*`
- относительные импорты в исходники репозитория

## Каноническая структура

Локальные плагины ищутся только по пути:

```text
.agentweaver/.plugins/<plugin-id>/plugin.json
```

Каталог установки и поле `id` в `plugin.json` должны совпадать строго.

## Манифест

Обязательные поля:

- `id`
- `sdk_version`
- `entrypoint`

Допустимые необязательные поля:

- `name`
- `version`
- `description`

`sdk_version` должен быть равен точному поддерживаемому major SDK. Для текущей версии используйте `1`.

## Entrypoint

Поддерживаются только ESM entrypoint-файлы:

- `.js`
- `.mjs`

Не поддерживаются:

- `.cjs`
- файлы без расширения
- default export

Плагин должен использовать только named exports `executors` и/или `nodes`.

## Контракт export-коллекций

Плагин может быть:

- только с `executors`
- только с `nodes`
- с обоими export-ами

Ошибкой считается:

- отсутствие обоих export-ов
- пустые обе коллекции
- export не-массивом

## Контракт регистрации executor

Каждый элемент `executors` обязан иметь вид:

```ts
{
  id: string;
  definition: ExecutorDefinition<JsonValue, unknown, unknown>;
}
```

Требования:

- `definition.kind === id`
- `definition.version` — положительное целое число
- `definition.defaultConfig` — JSON-сериализуемое значение
- `definition.execute` — функция

## Контракт регистрации node

Каждый элемент `nodes` обязан иметь вид:

```ts
{
  id: string;
  definition: PipelineNodeDefinition<Record<string, unknown>, unknown>;
  metadata: NodeContractMetadata;
}
```

Требования:

- `definition.kind === id`
- `metadata.kind === id`
- `definition.version === metadata.version`
- `metadata.prompt` должен быть одним из `required`, `allowed`, `forbidden`
- `metadata.executors`, если задан, должен ссылаться только на существующие executor id после merge

## Политика загрузки

- Плагины обнаруживаются детерминированно в лексикографическом порядке каталогов.
- Загрузка fail-fast: первая невалидная конфигурация останавливает построение merged registry.
- Плагин не может переопределять built-in node/executor id.
- Отдельные невалидные плагины не пропускаются частично.
