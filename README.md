# AgentWeaver

`AgentWeaver` is a TypeScript/Node.js CLI for engineering durable workflows around coding agents.

It is built for teams that want agent work to behave less like one-off prompting and more like an inspectable engineering system: explicit workflows, durable artifacts, repeatable review gates, resumable execution, and repository-local guidance that evolves with the codebase.

Typical usage looks like:

`plan -> implement -> run-go-linter-loop -> run-go-tests-loop -> review -> review-fix`

Planning-heavy work can use:

`plan -> design-review -> implement -> review-loop`

The important part is not the exact chain. The point is that AgentWeaver lets you model, operate, and evolve the harness around the agent.

## Key Features

See [docs/features.md](docs/features.md) for the expanded feature overview.

- **Declarative agent workflows**: flows are JSON specs with phases, steps, prompt bindings, params, expectations, and post-step actions. Workflow design stays declarative while runtime behavior lives in typed nodes and executors.
- **Repository-local project playbook**: stable project conventions live under `.agentweaver/playbook/` as versioned rules, examples, and templates. Guided flows select relevant guidance before planning, implementation, review, and repair so repeated agent runs inherit the same project knowledge.
- **Artifact-first execution**: each stage produces structured JSON and human-readable markdown artifacts on disk. Artifacts are the contract between stages, which makes runs inspectable, reviewable, and restartable.
- **Planning and design-review gates**: planning flows produce design, implementation plan, and QA plan artifacts. `design-review` critiques those artifacts before coding starts, and `auto-common` can iterate through `plan-revise` before implementation.
- **Review and repair loops**: review flows produce structured findings with severities. Repair flows can select blockers and critical findings, apply targeted fixes, and run follow-up checks.
- **Resumable automation**: long-running flows persist compact execution state, support resume/continue/restart semantics, and can restart from selected phases when the artifacts and launch profile are compatible.
- **Multiple execution backends**: Codex, OpenCode, shell/process checks, Jira, GitLab, Git commit, and Telegram notification integrations run through a common executor model.
- **Interactive TUI and direct CLI**: the same workflow model works in an operator-driven terminal UI, direct CLI commands, and non-interactive automation.
- **Custom flows**: built-in flows can be extended with global or project-local flow specs without changing AgentWeaver source code.
- **Plugin SDK**: local plugins can add public-SDK-compatible nodes and executors, with manifest validation, version checks, and documented entrypoint rules.
- **Operational diagnostics**: `doctor` checks system readiness, executor configuration, flow specs, node versions, and runtime environment shape before workflows fail mid-run.

## Why Harness Engineering

AgentWeaver is not positioned as a thin wrapper around one agent call. It is meant for harness engineering:

- The workflow is explicit instead of hidden in a long prompt.
- The intermediate decisions are persisted instead of disappearing in chat history.
- The agent receives project guidance from the repository instead of relying on memory or copy-pasted instructions.
- Review, repair, checks, and restart behavior are first-class parts of the workflow.
- The same model works in local CLI use, interactive operation, and automation.

In practice, this means you can treat an agent workflow like an engineered system: versioned, inspectable, repeatable, and debuggable.

## Core Concepts

- `flow spec`: declarative JSON under `src/pipeline/flow-specs/`, global `~/.agentweaver/.flows/`, or project-local `.agentweaver/.flows/`
- `node`: reusable runtime unit from `src/pipeline/nodes/`
- `executor`: integration layer for Jira, Codex, OpenCode, GitLab, shell/process execution, Telegram notifications, and related actions
- `scope`: isolated workspace key for artifacts and flow state; usually based on Jira task, otherwise derived from git context
- `artifact`: file produced or consumed by flows, used as the stable contract between stages
- `flow state`: compact persisted execution metadata used for resume/restart in long-running flows such as `auto-golang`
- `project playbook`: local `.agentweaver/playbook/` directory with `manifest.yaml`, practices, examples, and templates; the format is described in [docs/playbook.md](docs/playbook.md)

## Launch Semantics

- `resume` only resumes a genuinely interrupted run and uses the saved execution state without rebuilding already completed steps
- `continue` is intended for completed iterative cycles and starts the next iteration from the latest valid artifacts without deleting historical artifacts
- `restart` is treated as a new run: the current active attempt is archived under `.agentweaver/scopes/<scope>/.artifacts/restart-archives/attempt-XXXX`, then a new active attempt is created
- For ambiguous launches, the operator must choose the action explicitly: by confirmation in interactive mode, or with `--resume`, `--continue`, or `--restart` in non-interactive mode
- This contract applies to `auto-common`, `auto-simple`, `auto-golang`, `instant-task`, `review-loop`, `run-go-linter-loop`, and `run-go-tests-loop`

## Declarative Workflow Model

The center of the system is the declarative flow spec:

- phases define the workflow structure visible to operators
- steps define execution units inside each phase
- prompt bindings define how agent instructions are assembled
- params define node runtime inputs
- expectations define postconditions
- `after` actions update runtime state without introducing ad-hoc imperative glue

This keeps workflow design in JSON while keeping implementation details in typed runtime code.

The full flow-spec reference now lives in [docs/declarative-workflows.md](docs/declarative-workflows.md).

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

## Plugin SDK

AgentWeaver supports local plugins and custom declarative flows from both global and project-local `.agentweaver` directories.

Plugin authors must use only the public SDK subpath: `agentweaver/plugin-sdk`.
The package root `agentweaver`, internal paths such as `agentweaver/dist/*` and `agentweaver/src/*`, and repository-relative source imports are not part of the supported SDK contract.

Supported plugin manifest locations are:

- `~/.agentweaver/.plugins/<plugin-id>/plugin.json`
- `.agentweaver/.plugins/<plugin-id>/plugin.json`

The plugin directory name and manifest `id` must match exactly.

Use the dedicated guide at [docs/plugin-sdk.md](docs/plugin-sdk.md) for:

- the executor versus node architecture
- manifest and entrypoint rules
- optional routing metadata for plugin LLM executors
- runtime context APIs available to plugin code
- global and project-local flow wiring under `~/.agentweaver/.flows/` and `.agentweaver/.flows/`
- compatibility, testing, troubleshooting, and a complete end-to-end walkthrough

Repository reference examples live under `docs/examples/`, for example:

- `docs/examples/.plugins/claude-example-plugin/`
- `docs/examples/.flows/claude-example.json`

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

- browse built-in, global, and project-local workflows
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
- global custom flows are loaded from `~/.agentweaver/.flows/`
- project-local custom flows are loaded from `.agentweaver/.flows/`
- all discovered flow specs are validated at load time
- duplicate flow ids fail fast across built-in, global, and project-local sources
- custom flows are shown separately in the UI as global and project-local groups

## Custom Flows

You can add custom flow specs under either:

```bash
~/.agentweaver/.flows/**/*.json
.agentweaver/.flows/**/*.json
```

Custom flows:

- are discovered recursively
- get their flow id from the relative path without `.json`
- share the same validator and runtime as built-in flows
- cannot conflict with an existing built-in or other discovered flow id

Use the global directory for reusable personal flows and plugins across repositories, and the project-local directory for repo-specific wiring.

Nested `flow-run` steps can reference built-in, global, or project-local specs by file name, as long as the name resolves unambiguously.

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
node dist/index.js auto-common-guided --help-phases
node dist/index.js plan --dry DEMO-1234
node dist/index.js implement --dry DEMO-1234
node dist/index.js review --dry DEMO-1234
```

## Guided Project Guidance

The project playbook is AgentWeaver's way to turn project-specific conventions into durable agent context. Instead of repeating the same instructions in every prompt, a repository can keep stable rules, examples, and templates under `.agentweaver/playbook/`. Guided flows validate that material, select the parts relevant to the current task and phase, and pass compact guidance into the model before planning, implementation, review, and repair.

Typical playbook content includes:

- engineering rules such as required test locations, documentation language, or runtime validation boundaries
- examples that should be opened only when relevant, instead of pasted into every prompt
- templates for recurring artifact shapes or implementation notes
- repository context that should remain visible across tasks without overriding task-specific inputs

The guided flow is `auto-common-guided`. It first runs the same Jira fetch and task normalization steps as `auto-common`, then validates `.agentweaver/playbook/manifest.yaml` and generates compact project guidance before the `plan`, `design-review`, `implement`, `review`, and `repair/review-fix` phases. JSON artifacts remain English and machine-readable; markdown is generated in the workflow-selected language.

The guidance is intentionally phase-aware. A rule can apply only to `plan`, `implement`, `review`, or another supported phase; it can also target languages, frameworks, glob patterns, and keywords. AgentWeaver writes both a structured `project-guidance/v1` JSON artifact and a derivative markdown file, then passes their paths into the phase prompt as supplemental project-local context.

Initialize or refresh the playbook with:

```bash
agentweaver playbook-init
agentweaver playbook-init --accept-playbook-draft
```

Use the guided flow with:

```bash
agentweaver auto-common-guided --help-phases
agentweaver auto-common-guided --accept-playbook-draft DEMO-1234
```

The workflow does not read old `playbook.json` or `playbook.md` files as fallbacks. In non-interactive runs, a missing manifest stops the workflow before planning and reports the required action: run `agentweaver playbook-init --accept-playbook-draft` first, or rerun `agentweaver auto-common-guided --accept-playbook-draft <jira>`. The `--accept-playbook-draft` flag explicitly accepts the generated playbook without interactive review and allows AgentWeaver to write the manifest-based layout. An invalid manifest stops the guided phase before the LLM prompt.

To inspect whether playbook guidance participated in a run, check the generated artifacts:

```bash
find .agentweaver/scopes -name 'project-guidance-*'
rg -n "Project Guidance|practice\\." .agentweaver/scopes
```

Keep `.agentweaver/playbook/` in Git even when other AgentWeaver runtime state is ignored. The playbook format and maintenance workflow are documented in [docs/playbook.md](docs/playbook.md).

Current limitations: skills integration is not available yet; the playbook generator must rely on repository evidence and clarification answers; guided prompts receive compact context and open full examples only when they are directly relevant to the current phase.
