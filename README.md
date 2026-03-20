# AgentWeaver

`AgentWeaver` это CLI-оркестратор для инженерного workflow вида `plan -> implement -> review -> fix -> test` поверх Jira, Codex и Claude.

Главное здесь не `docker-compose`, а сам агентный сценарий в `./agentweaver.py`. Docker-обвязка в репозитории нужна как вспомогательный runtime для запуска Codex в предсказуемом окружении, логина и build/test-проверок.

## Что делает AgentWeaver
- Забирает задачу из Jira по ключу или browse URL.
- Строит артефакты workflow: дизайн, план реализации, QA-план, review/reply summary.
- Оркестрирует шаги `plan`, `implement`, `review`, `review-fix`, `test`, `test-fix`, `auto`.
- Позволяет запускать эти шаги локально или через Docker runtime, не меняя пользовательский сценарий.

Основной entrypoint: `./agentweaver.py`

## Состав репозитория
- `agentweaver.py` — основной CLI и interactive shell.
- `docker-compose.yml` — вспомогательный runtime для `codex`, `codex-exec`, `verify-build`, `codex-login`.
- `Dockerfile.codex` — образ для этого runtime с `codex`, Go toolchain и утилитами.
- `verify_build.sh` — project-specific build verification script для контейнерного `verify-build`.
- `requirements.txt` — Python-зависимости для CLI.

## Быстрый старт
1. Установите Python-зависимости для CLI:

```bash
pip install -r requirements.txt
```

2. Подготовьте переменные окружения для самого AgentWeaver:
- `JIRA_API_KEY` для скачивания задачи из Jira.
- `JIRA_BASE_URL`, если передаёте только ключ задачи, а не полный browse URL.
- `AGENTWEAVER_HOME`, только если нужно явно указать, где лежит установка AgentWeaver. Если переменная не задана, используется каталог, в котором лежит `agentweaver.py`.
- `CODEX_BIN`, `CLAUDE_BIN`, `CODEX_MODEL`, `CLAUDE_REVIEW_MODEL`, `CLAUDE_SUMMARY_MODEL` при необходимости переопределения.

3. Запускайте нужный шаг workflow:

```bash
./agentweaver.py DEMO-3288
./agentweaver.py plan DEMO-3288
./agentweaver.py implement DEMO-3288
./agentweaver.py review DEMO-3288
./agentweaver.py auto DEMO-3288
```

При запуске из папки проекта `AgentWeaver` автоматически использует:
- `PROJECT_DIR=$PWD`
- `AGENTWEAVER_HOME` или каталог самого `agentweaver.py`
- `AGENTWEAVER_HOME/docker-compose.yml`
- `AGENTWEAVER_HOME/.codex-home`
- `~/.ssh` и `~/.gitconfig`, а если их нет, то безопасные fallback-пути внутри `AGENTWEAVER_HOME/.runtime`

То есть для типового запуска из проекта достаточно настроить только Jira-доступ.

## Docker runtime
Docker здесь нужен как инструмент: чтобы запускать Codex в контейнере, делать login и иметь изолированный runtime для build/test задач.

### Что делает контейнерная конфигурация
- Запускает `codex` в контейнере.
- Монтирует только каталог проекта (`PROJECT_DIR` -> `/workspace`).
- Стартует `codex` с флагом `--dangerously-bypass-approvals-and-sandbox`.
- Даёт сервис `codex-exec` для неинтерактивного `codex exec` с промптом из переменной окружения.
- Держит root filesystem read-only, оставляя writable только bind mount проекта и tmpfs (`/tmp`, `/root`).
- Сохраняет данные авторизации `codex` в `AGENTWEAVER_HOME/.codex-home` по умолчанию.
- Включает Go-стек: `go`, `golangci-lint v2`, `swag`, `protoc`, `protoc-gen-go`, `protoc-gen-go-grpc`, `git`, `curl`, `jq`, `rg`, `make`, `docker` CLI.
- Для `testcontainers` использует отдельный внутренний `dockerd`, без проброса `docker.sock` хоста в `codex`.

### Настройка `.env`
Для запуска `AgentWeaver` из проекта обычно достаточно такого `.env`:

```bash
JIRA_API_KEY=your-jira-api-token
JIRA_BASE_URL=https://jira.example.com
AGENTWEAVER_HOME=/absolute/path/to/AgentWeaver
CODEX_BIN=codex
CLAUDE_BIN=claude
CODEX_MODEL=gpt-5.4
CLAUDE_REVIEW_MODEL=opus
CLAUDE_SUMMARY_MODEL=haiku
GOPRIVATE=gitlab.yourdomain.org/*
GONOSUMDB=gitlab.yourdomain.org/*
GONOPROXY=gitlab.yourdomain.org/*
GIT_ALLOW_PROTOCOL=file:https:ssh
CODEX_PROMPT=
CODEX_EXEC_FLAGS=--dangerously-bypass-approvals-and-sandbox
```

Для нового окружения можно взять шаблон `.env.example`.
Кэши `go`/`golangci-lint` и codex auth по умолчанию хранятся в `AGENTWEAVER_HOME/.codex-home`, поэтому повторные прогоны заметно быстрее.

### Запуск сервисов
1. Один раз выполните вход по подписке (интерактивно):

```bash
PROJECT_DIR="$PWD" docker compose -f "$AGENTWEAVER_HOME/docker-compose.yml" run --rm codex-login
```

`codex-login` использует `network_mode: host`, чтобы OAuth callback на `localhost` был доступен из браузера хоста.

2. Рабочий запуск Codex в контейнере:

```bash
PROJECT_DIR="$PWD" docker compose -f "$AGENTWEAVER_HOME/docker-compose.yml" run --rm codex
```

3. Неинтерактивный запуск с готовым промптом:

```bash
PROJECT_DIR="$PWD" docker compose -f "$AGENTWEAVER_HOME/docker-compose.yml" run --rm \
  -e CODEX_PROMPT="Проверь проект и исправь failing тесты" \
  codex-exec
```

Если удобнее держать промпт в `.env`, можно задать `CODEX_PROMPT` там и запускать короче:

```bash
PROJECT_DIR="$PWD" docker compose -f "$AGENTWEAVER_HOME/docker-compose.yml" run --rm codex-exec
```

По умолчанию `codex-exec` запускает `codex exec --dangerously-bypass-approvals-and-sandbox`, чтобы режим совпадал с интерактивным `codex`. Флаги можно переопределить через `CODEX_EXEC_FLAGS`, например:

```bash
PROJECT_DIR="$PWD" docker compose -f "$AGENTWEAVER_HOME/docker-compose.yml" run --rm \
  -e CODEX_PROMPT="Сделай обзор изменений в репозитории" \
  -e CODEX_EXEC_FLAGS="--full-auto" \
  codex-exec
```

## Go-команды внутри контейнера

```bash
PROJECT_DIR="$PWD" docker compose -f "$AGENTWEAVER_HOME/docker-compose.yml" run --rm codex bash -lc "go test ./..."
PROJECT_DIR="$PWD" docker compose -f "$AGENTWEAVER_HOME/docker-compose.yml" run --rm codex bash -lc "golangci-lint run ./..."
PROJECT_DIR="$PWD" docker compose -f "$AGENTWEAVER_HOME/docker-compose.yml" run --rm codex bash -lc "swag init -g cmd/main.go -o docs/swagger"
PROJECT_DIR="$PWD" docker compose -f "$AGENTWEAVER_HOME/docker-compose.yml" run --rm codex bash -lc "protoc --version && which protoc-gen-go && which protoc-gen-go-grpc"
PROJECT_DIR="$PWD" docker compose -f "$AGENTWEAVER_HOME/docker-compose.yml" run --rm codex bash -lc "go version && golangci-lint --version"
```

## Примечания по безопасности
- `codex` контейнер не получает `docker.sock` хоста.
- Доступ к Docker для тестов идет через изолированный `dockerd` в этой же compose-сети.
- Git remote-операции разрешены только по secure-протоколам (`ssh`/`https`); `git://` блокируется.
- Сервис `dockerd` запущен `privileged` (техническое требование DinD); это безопаснее, чем отдавать агенту доступ к Docker хоста, но не равно полной sandbox-изоляции.
