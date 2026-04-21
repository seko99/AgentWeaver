# AgentWeaver

`AgentWeaver` is a TypeScript/Node.js CLI for harness engineering around coding agents.

It is built around declarative workflow specs. A flow describes phases and steps in JSON, runtime nodes implement behavior in TypeScript, and artifacts on disk make runs resumable, inspectable, and operationally manageable from the TUI.

Typical usage looks like:

`plan -> implement -> run-go-linter-loop -> run-go-tests-loop -> review -> review-fix`

The important part is not that exact chain. The point is that AgentWeaver lets you design, operate, and evolve durable agent harnesses instead of accumulating one-off prompts and shell glue.

For planning-heavy work, a typical path can now include `plan -> design-review -> implement`, where `design-review` critiques planning artifacts before coding starts.

## What It Does

- Fetches Jira issue context by issue key or browse URL
- Fetches GitLab merge request diff and review data into reusable artifacts
- Runs Codex-, OpenCode-, and process-backed stages through a common pipeline runtime
- Persists artifacts and compact flow execution state under the current project scope
- Supports both operator-driven work in a TUI and end-to-end automation flows
- Resumes interrupted declarative flows when required artifacts and launch profile still match

## Harness Engineering Focus

AgentWeaver is not positioned as a thin wrapper around one agent call. It is meant for harness engineering:

- workflows are modeled explicitly as phases, steps, prompts, params, expectations, and artifacts
- execution logic is isolated into reusable nodes and executors instead of being embedded in ad-hoc scripts
- artifacts on disk are the contract between stages, which makes runs reviewable and restartable
- the same workflow model can be used in direct CLI mode, interactive TUI mode, and resumable automation flows

In practice, this means you can treat an agent workflow like an engineered system: versioned, inspectable, repeatable, and debuggable.

## Core Concepts

- `flow spec`: declarative JSON under `src/pipeline/flow-specs/` or project-local `.agentweaver/.flows/`
- `node`: reusable runtime unit from `src/pipeline/nodes/`
- `executor`: integration layer for Jira, Codex, OpenCode, GitLab, shell/process execution, Telegram notifications, and related actions
- `scope`: isolated workspace key for artifacts and flow state; usually based on Jira task, otherwise derived from git context
- `artifact`: file produced or consumed by flows, used as the stable contract between stages
- `flow state`: compact persisted execution metadata used for resume/restart in long-running flows such as `auto-golang`

## Declarative Workflow Model

The center of the system is the declarative flow spec:

- phases define the workflow structure visible to operators
- steps define execution units inside each phase
- prompt bindings define how agent instructions are assembled
- params define node runtime inputs
- expectations define postconditions
- `after` actions update runtime state without introducing ad-hoc imperative glue

This keeps workflow design in JSON while keeping implementation details in typed runtime code.

## Repository Layout

- `src/index.ts` — CLI entrypoint, interactive mode bootstrap, and top-level orchestration
- `src/executors/` — first-class executors
- `src/executors/configs/` — data-only default executor configs
- `src/pipeline/` — declarative flow loading, compilation, validation, runtime, and built-in flow specs
- `src/pipeline/nodes/` — reusable runtime nodes used by flow specs
- `src/runtime/` — shared runtime services such as command resolution and subprocess execution
- `src/interactive/` — Ink-based interactive session, controller, state, and view-model logic
- `src/markdown.ts` — markdown rendering for terminal output
- `src/structured-artifact-schemas.json` — schemas for machine-readable artifacts
- `tests/` — automated tests for pipeline behavior

## Built-In Flows

User-invokable built-in commands currently map to these flow specs:

- `plan` — fetches Jira task with attachments, generates clarifying questions for the developer, collects answers, and produces design, implementation plan, and QA plan as structured JSON and markdown artifacts
- `design-review` — performs a structured critique of the latest planning artifacts and writes a dedicated `design-review/v1` artifact; `approved_with_warnings` is treated as ready to proceed and may still produce `ready-to-merge.md`
- `task-describe` — generates a brief task description from a Jira issue or from manual input; when Jira is provided, fetches the issue and summarizes it; otherwise accepts free-form text and analyzes the codebase to produce a richer description
- `implement` — runs LLM-backed implementation based on previously approved design and plan artifacts; executes code changes locally in the project working directory
- `review` — performs code review of current changes against the task design and plan; produces structured review findings with severity levels and a ready-to-merge verdict
- `review-fix` — takes review findings, auto-selects blockers and criticals (or lets the developer pick manually), builds a targeted fix prompt, and applies fixes locally; runs mandatory checks after modifications
- `review-loop` — iteratively runs review → review-fix cycles up to 5 times; stops early when ready-to-merge is achieved; each iteration auto-selects blockers and critical findings for fixing
- `bug-analyze` — fetches a Bug-type Jira issue, validates the issue type, generates or reuses a cached task summary, and produces structured bug analysis: root cause hypothesis, fix design, and step-by-step fix plan
- `bug-fix` — applies the fix designed in bug-analyze; uses the root cause hypothesis, fix design, and fix plan artifacts as the source of truth to implement code changes locally
- `git-commit` — four-phase commit workflow: collects git status and diff, generates a commit message via LLM, presents a file selection form, then shows the editable message for confirmation and executes the commit
- `gitlab-diff-review` — prompts for a GitLab merge request URL, fetches the MR diff via GitLab API, and runs LLM-backed code review producing structured findings with severity levels and a ready-to-merge verdict
- `gitlab-review` — prompts for a GitLab merge request URL, fetches existing code review comments via GitLab API, assesses which findings are fair and which can be dismissed, then runs review-fix to apply fixes for the accepted findings
- `mr-description` — generates a concise merge request description based on the task context and current code changes; produces both markdown and structured JSON artifacts
- `run-go-tests-loop` — runs `run_go_tests.py` and analyzes failures; if tests fail, sends the error output to LLM for a fix and retries; repeats up to 5 attempts, stopping early on success
- `run-go-linter-loop` — runs `run_go_linter.py` and analyzes output; if the linter reports issues, sends them to LLM for a fix and retries; repeats up to 5 attempts, stopping early on success
- `auto-golang` — end-to-end resumable pipeline for Go projects: plan → implement → linter loop → test loop → review loop → final linter loop → final test loop; supports `--from` to restart from a specific phase and `auto-status`/`auto-reset` for state management
- `auto-common` — planning-aware pipeline with a mandatory design-review gate before implementation: plan → design-review loop → implement → review loop; design-review can iterate with `plan-revise` up to 3 times, and if the final verdict still requires revision the operator must explicitly choose whether to continue with the latest planning artifacts or stop
- `auto-simple` — preserved simplified pipeline equivalent to the legacy auto-common behavior: plan → implement → review loop; no planning review gate, suitable for projects that do not need design review before coding
- `doctor` — diagnostics command that runs system, executor, and flow readiness health checks; supports filtering by category or check ID and JSON output

There are also built-in nested/helper flows that are loaded declaratively but are not direct top-level CLI commands, for example `review-project` (project-level code review used internally when no prior design/plan artifacts are present).

## Requirements

- Node.js `>= 18.19.0`
- npm
- `codex` CLI for Codex-backed stages
- `opencode` CLI if you use OpenCode-backed stages
- access to Jira and/or GitLab when the selected flow needs them

## Installation

Local development:

```bash
npm install
npm run build
```

Run from source:

```bash
node dist/index.js --help
```

Global install after publishing:

## Плагинный SDK

Для авторов плагинов поддерживается только один публичный импорт: `agentweaver/plugin-sdk`.
Импорт из корня пакета `agentweaver`, а также любые внутренние пути вида `agentweaver/dist/*`, `agentweaver/src/*` и репозиторные относительные импорты не считаются поддерживаемым SDK-контрактом.

Канонический путь локального плагина: `.agentweaver/.plugins/<plugin-id>/plugin.json`.
Подробный контракт манифеста, entrypoint и export-схемы описан в [docs/plugin-sdk.md](docs/plugin-sdk.md).

```bash
npm install -g agentweaver
agentweaver --help
```

One-off usage after publishing:

```bash
npx agentweaver --help
```

## Environment Loading

AgentWeaver loads environment variables from two optional `.env` files:

1. `~/.agentweaver/.env`
2. `<project>/.agentweaver/.env`

Priority is:

1. shell environment
2. project-local `.agentweaver/.env`
3. global `~/.agentweaver/.env`

The directory `~/.agentweaver` is created automatically on startup. Missing `.env` files are allowed.

`AGENTWEAVER_HOME` is only used to override the package installation/home directory used by the CLI. It is not the same thing as `~/.agentweaver`.

## Environment Variables

Required for Jira-backed flows:

- `JIRA_API_KEY` — Jira API token

Common optional variables:

- `JIRA_USERNAME` — required for Jira Cloud Basic auth
- `JIRA_AUTH_MODE` — `auto`, `basic`, or `bearer`
- `JIRA_BASE_URL` — required when passing only an issue key such as `DEMO-123`
- `GITLAB_TOKEN` — token for GitLab review-related flows
- `AGENTWEAVER_HOME` — override package home/installation directory
- `CODEX_BIN` — override `codex` executable path
- `CODEX_MODEL` — fallback model for Codex-backed executors
- `OPENCODE_BIN` — override `opencode` executable path
- `OPENCODE_MODEL` — fallback model for OpenCode-backed executors

Example:

```bash
JIRA_API_KEY=your-jira-api-token
JIRA_USERNAME=your.name@company.com
JIRA_AUTH_MODE=auto
JIRA_BASE_URL=https://jira.example.com
GITLAB_TOKEN=your-gitlab-token
AGENTWEAVER_HOME=/absolute/path/to/AgentWeaver
CODEX_BIN=codex
CODEX_MODEL=gpt-5.4
OPENCODE_BIN=opencode
OPENCODE_MODEL=minimax-coding-plan/MiniMax-M2.7
```

## TUI-First Operations

The full-screen TUI is not a cosmetic wrapper. It is the operator console for the harness:

- browse built-in and project-local workflows
- launch flows in the current scope
- inspect progress by phase and step
- follow activity, prompts, summaries, and statuses
- operate resumable flows without losing the execution model

The CLI remains important for direct execution and automation, but the TUI is where the harness becomes an operational system rather than a set of commands.

## CLI Usage

Interactive mode:

```bash
agentweaver
agentweaver DEMO-1234
agentweaver --force DEMO-1234
```

Direct flow execution:

```bash
agentweaver plan DEMO-1234
agentweaver design-review DEMO-1234
agentweaver task-describe DEMO-1234
agentweaver implement DEMO-1234
agentweaver review DEMO-1234
agentweaver review-fix DEMO-1234
agentweaver review-loop DEMO-1234
agentweaver bug-analyze DEMO-1234
agentweaver bug-fix DEMO-1234
agentweaver git-commit DEMO-1234
agentweaver gitlab-diff-review
agentweaver gitlab-review
agentweaver mr-description DEMO-1234
agentweaver run-go-tests-loop DEMO-1234
agentweaver run-go-linter-loop DEMO-1234
agentweaver auto-golang DEMO-1234
agentweaver auto-common DEMO-1234
agentweaver auto-simple DEMO-1234
agentweaver doctor
agentweaver doctor --json
agentweaver doctor <category>|<check-id>
```

From a source checkout:

```bash
node dist/index.js plan DEMO-1234
node dist/index.js design-review DEMO-1234
node dist/index.js implement DEMO-1234
node dist/index.js review DEMO-1234
node dist/index.js auto-golang DEMO-1234
node dist/index.js auto-common DEMO-1234
```

Useful commands:

```bash
agentweaver --help
agentweaver --version
agentweaver auto-golang --help-phases
agentweaver auto-common --help-phases
agentweaver auto-simple --help-phases
agentweaver auto-golang --from <phase> DEMO-1234
agentweaver auto-status DEMO-1234
agentweaver auto-reset DEMO-1234
agentweaver doctor
agentweaver doctor --json
```

Notes:

- `--dry` fetches required context but prints launch commands instead of running Codex/OpenCode steps
- `--verbose` streams child process stdout/stderr in direct CLI mode
- `--prompt <text>` appends extra instructions to the prompt
- `--scope <name>` is supported by scope-flexible flows such as `implement`, `review`, `review-fix`, `review-loop`, `run-go-tests-loop`, `run-go-linter-loop`, `gitlab-review`, and `gitlab-diff-review`
- `--md-lang <en|ru>` currently applies to `plan`
- `--force` only affects interactive mode: it skips loading cached summary-pane content on startup so Jira-backed flows that regenerate summary artifacts can repopulate it during the run
- Jira-backed flows ask for Jira input interactively when it is omitted
- `task-describe` can also work from manual task description input without Jira
- `gitlab-review` and `gitlab-diff-review` ask for a GitLab merge request URL interactively
- `auto-status` and `auto-reset` currently operate on persisted state for `auto-golang`

## `auto-golang`, `auto-common`, and `auto-simple`

`auto-golang` is the main resumable end-to-end automation flow. It stores persisted execution state and supports:

- phase listing via `--help-phases`
- restart from a specific phase via `--from <phase>`
- status inspection via `auto-status`
- reset via `auto-reset`
- resume validation against saved launch profile and required artifacts

`auto-common` is the planning-aware built-in automation flow. After `plan`, it runs a `design-review` loop and blocks implementation until the verdict is `approved` or `approved_with_warnings`. When the verdict is `needs_revision`, it runs `plan-revise` and then another `design-review`, for up to 3 design-review iterations total. If the final verdict still requires revision, the pipeline asks the operator whether to continue with the latest planning artifacts or stop before `implement`.

`auto-simple` is the preserved simplified pipeline: `plan → implement → review loop`, with no planning review gate and no revise rounds. It is behaviorally equivalent to the legacy `auto-common` before the planning gate was introduced.

## Launch Profiles and Resume

Interactive flow runs can ask for an LLM launch profile: executor plus model. That selection is persisted with resumable flow state.

Resume is allowed only when:

- the flow state exists for the current scope
- the saved launch profile matches the requested one
- required artifacts from completed steps are still present and valid
- Jira-backed flows still have the Jira context they need

If those checks fail, the runtime requires a restart instead of resuming.

## Artifacts and Scope

Artifacts and flow state are stored under the current project scope. In practice:

- Jira-backed runs usually use the Jira issue key as scope
- non-Jira runs can fall back to a git-derived scope
- `--scope <name>` lets you override the default for supported commands

The runtime uses artifacts as the contract between stages, including markdown outputs and structured JSON files validated against schemas.

## Interactive TUI

Running without a command opens the full-screen TUI. It acts as the operator console for the harness: browsing flows, launching them in scope, following current execution, and reviewing summaries.

Interactive mode is Ink-only. It requires:

- a real TTY for both stdin and stdout
- installed runtime dependencies from `npm install`

Current navigation:

- `Up` / `Down` — move in the flow tree
- `Left` / `Right` — collapse or expand folders
- `Enter` — toggle folder or run selected flow
- `Tab` / `Shift+Tab` — switch panes
- `PgUp` / `PgDn` — scroll focused pane
- `h` — open help
- `q` or `Ctrl+C` — exit

Current layout:

- left column: `Flows`, `Flow Description`, `Status`
- right column: `Current Flow`, optional `Task Summary`, `Activity`
- `Current Flow` is intentionally tall and scrollable; in the current layout it uses the same height budget as `Flows`
- the `Task Summary` pane is runtime-driven and shows whichever markdown artifact the active flow publishes into summary state, such as a normalized task context or a cached task summary

Flow discovery behavior:

- built-in flows are loaded from `src/pipeline/flow-specs/`
- project-local flows are loaded from `.agentweaver/.flows/`
- both built-in and project-local flow specs are validated at load time
- duplicate flow ids fail fast
- project-local flows are shown separately in the UI

## Project-Local Flows

You can add project-specific flow specs under:

```bash
.agentweaver/.flows/**/*.json
```

Project-local flows:

- are discovered recursively
- get their flow id from the relative path without `.json`
- share the same validator and runtime as built-in flows
- cannot conflict with an existing built-in or other discovered flow id

Nested `flow-run` steps can reference built-in or project-local specs by file name, as long as the name resolves unambiguously.

## Development

Install dependencies and build:

```bash
npm install
npm run build
```

Type-check only:

```bash
npm run check
```

Preview publish tarball:

```bash
npm run pack:check
```

Run from source in dev mode:

```bash
npm run dev -- --help
```

Recommended smoke checks:

```bash
node dist/index.js --help
node dist/index.js auto-golang --help-phases
node dist/index.js auto-common --help-phases
node dist/index.js plan --dry DEMO-1234
node dist/index.js implement --dry DEMO-1234
node dist/index.js review --dry DEMO-1234
```
