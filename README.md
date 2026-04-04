# AgentWeaver

`AgentWeaver` is a TypeScript/Node.js CLI for engineering workflows around Jira, GitLab review artifacts, Codex, and Claude.

It orchestrates a flow like:

`plan -> implement -> run-go-linter-loop -> run-go-tests-loop -> review -> review-fix`

The package is designed to run as an npm CLI and includes an interactive terminal UI built on `neo-blessed`.

## What It Does

- Fetches a Jira issue by key or browse URL
- Fetches GitLab merge request review comments into reusable markdown and JSON artifacts
- Fetches GitLab merge request diffs into reusable markdown and JSON artifacts and can run Claude-based diff review directly from MR
- Generates workflow artifacts such as design, implementation plan, QA plan, bug analysis, reviews, and summaries
- Machine-readable JSON artifacts are stored under `.agentweaver/scopes/<scope-key>/.artifacts/` and act as the source of truth between workflow steps; Markdown artifacts remain for human inspection
- Workflow artifacts are isolated by scope; for Jira-driven flows the scope key defaults to the Jira task key, otherwise it defaults to `<git-branch>--<worktree-hash>`
- Runs workflow stages like `bug-analyze`, `bug-fix`, `gitlab-diff-review`, `mr-description`, `plan`, `task-describe`, `implement`, `review`, `review-fix`, `run-go-tests-loop`, `run-go-linter-loop`, and `auto`
- Persists compact `auto` pipeline state on disk so runs can resume without storing large agent outputs
- Uses Docker runtime services for isolated Codex execution and build verification

## Architecture

The CLI now uses an executor + node + declarative flow architecture.

- `src/index.ts` remains the CLI entrypoint and high-level orchestration layer
- `src/executors/` contains first-class executors for external actions such as Jira fetch, GitLab review fetch, local Codex, Docker-based build verification, Claude, Claude summaries, and process execution
- `src/pipeline/nodes/` contains reusable runtime nodes built on top of executors
- `src/pipeline/flow-specs/` contains declarative JSON flow specs for `preflight`, `bug-analyze`, `bug-fix`, `gitlab-diff-review`, `gitlab-review`, `mr-description`, `plan`, `task-describe`, `implement`, `review`, `review-fix`, `run-go-tests-loop`, `run-go-linter-loop`, and `auto`
- project-local flow may additionally be placed in `.agentweaver/.flows/*.json`; they are discovered at runtime from the current workspace
- `src/runtime/` contains shared runtime services such as command resolution, Docker runtime environment setup, and subprocess execution

This keeps command handlers focused on choosing a flow and providing parameters instead of assembling prompts and subprocess wiring inline.

## Repository Layout

- `src/` — main TypeScript sources
- `src/index.ts` — CLI entrypoint and workflow orchestration
- `src/pipeline/flow-specs/` — declarative JSON specs for workflow stages
- `.agentweaver/.flows/` — optional project-local declarative flow specs loaded from the current repository
- `src/pipeline/nodes/` — reusable pipeline nodes executed by the declarative runner
- `src/interactive-ui.ts` — interactive TUI built with `neo-blessed`
- `src/markdown.ts` — markdown-to-terminal renderer for the TUI
- `src/executors/` — executor modules for concrete execution families
- `src/executors/configs/` — default executor configs kept as plain data
- `src/runtime/` — shared runtime services used by executors
- `docker-compose.yml` — runtime services for Codex and build verification
- `Dockerfile.codex` — container image for Codex runtime
- `verify_build.sh` — aggregated verification entrypoint used by `verify-build`
- `run_go_tests.py` — isolated Go test verification entrypoint
- `run_go_linter.py` — isolated Go generate + lint verification entrypoint
- `run_go_coverage.sh` — isolated Go coverage verification entrypoint
- `package.json` — npm package metadata and scripts
- `tsconfig.json` — TypeScript configuration

## Requirements

- Node.js `>= 18.19.0`
- npm
- Docker with `docker compose` or `docker-compose`
- `codex` CLI for `bug-analyze`, `bug-fix`, `mr-description`, `plan`, and other Codex-driven steps
- `claude` CLI for review and summary steps

## Installation

Local development:

```bash
npm install
npm run build
```

Global install after publication:

```bash
npm install -g agentweaver
```

One-off usage after publication:

```bash
npx agentweaver --help
```

## Environment

Required:

- `JIRA_API_KEY` — Jira API token used to fetch issue JSON

Common optional variables:

- `JIRA_BASE_URL` — required when you pass only an issue key like `DEMO-123`
- `GITLAB_TOKEN` — personal access token for `gitlab-review` and `gitlab-diff-review`
- `AGENTWEAVER_HOME` — path to the AgentWeaver installation directory
- `DOCKER_COMPOSE_BIN` — override compose command, for example `docker compose`
- `CODEX_BIN` — override `codex` executable path
- `CLAUDE_BIN` — override `claude` executable path
- `CODEX_MODEL` — fallback model for Codex executors when the flow spec does not set `params.model`
- `CLAUDE_MODEL` — fallback Claude model when the flow spec does not set `params.model`

Example `.env`:

```bash
JIRA_API_KEY=your-jira-api-token
JIRA_BASE_URL=https://jira.example.com
AGENTWEAVER_HOME=/absolute/path/to/AgentWeaver
CODEX_BIN=codex
CLAUDE_BIN=claude
CODEX_MODEL=gpt-5.4
CLAUDE_MODEL=opus
GOPRIVATE=gitlab.example.org/*
GONOSUMDB=gitlab.example.org/*
GONOPROXY=gitlab.example.org/*
GIT_ALLOW_PROTOCOL=file:https:ssh
```

## Usage

Direct CLI usage:

```bash
agentweaver plan DEMO-3288
agentweaver plan
agentweaver bug-analyze DEMO-3288
agentweaver bug-fix DEMO-3288
agentweaver gitlab-diff-review
agentweaver gitlab-review
agentweaver mr-description DEMO-3288
agentweaver task-describe DEMO-3288
agentweaver implement DEMO-3288
agentweaver review
agentweaver review DEMO-3288
agentweaver review --scope release-prep
agentweaver run-go-tests-loop DEMO-3288
agentweaver run-go-tests-loop
agentweaver run-go-linter-loop DEMO-3288
agentweaver auto DEMO-3288
```

From source checkout:

```bash
node dist/index.js plan DEMO-3288
node dist/index.js plan
node dist/index.js bug-analyze DEMO-3288
node dist/index.js bug-fix DEMO-3288
node dist/index.js gitlab-diff-review
node dist/index.js gitlab-review
node dist/index.js mr-description DEMO-3288
node dist/index.js task-describe DEMO-3288
node dist/index.js review
node dist/index.js auto DEMO-3288
```

Interactive mode:

```bash
agentweaver DEMO-3288
agentweaver
```

When you run from a working project directory, set `AGENTWEAVER_HOME` to the AgentWeaver installation:

```bash
AGENTWEAVER_HOME=/absolute/path/to/AgentWeaver agentweaver DEMO-3288
```

Useful commands:

```bash
agentweaver --help
agentweaver auto --help-phases
agentweaver auto-status DEMO-3288
agentweaver auto-reset DEMO-3288
```

Notes:

- `--verbose` streams child process `stdout/stderr` in direct CLI mode
- task-only commands such as `plan` and `auto` ask for Jira task via interactive `user-input` when it is omitted
- scope-flexible commands such as `gitlab-diff-review`, `gitlab-review`, `review`, `review-fix`, `run-go-tests-loop`, and `run-go-linter-loop` use the current git branch by default when Jira task is omitted
- `gitlab-review` and `gitlab-diff-review` ask for GitLab merge request URL via interactive `user-input`
- `--scope <name>` lets you override the default project scope name
- the interactive `Activity` pane is intentionally structured: it shows launch separators, prompts, summaries, and short status messages instead of raw Codex/Claude logs by default

## Interactive TUI

Interactive mode opens a full-screen terminal UI with:

- flow list
- current flow progress
- activity log
- task summary pane
- keyboard navigation between panes

Current navigation:

- `Enter` — run selected flow
- `Tab` / `Shift+Tab` — switch panes
- `PgUp` / `PgDn` / `Home` / `End` — scroll focused panes
- `h` — help overlay
- `q` or `Ctrl+C` — exit

Flow discovery and highlighting:

- built-in flow are loaded from the packaged `src/pipeline/flow-specs/`
- project-local flow are loaded from `.agentweaver/.flows/*.json`
- project-local flow are shown in a different color in the `Flows` pane
- when a project-local flow is selected, the description pane also shows its source file path
- if a local flow conflicts with a built-in flow id or uses unknown node / executor / prompt / schema types, interactive startup fails fast with a validation error

Activity pane behavior:

- each external launch is separated with a framed block that shows the current `node`, `executor`, and `model` when available
- prompts and summaries are rendered as plain text for readability
- live raw Codex/Claude output is not shown there in normal mode

## Docker Runtime

Docker is used as an isolated execution environment for Codex-related runtime scenarios that still require container orchestration.

Main services:

- `codex` — interactive Codex container
- `codex-exec` — non-interactive `codex exec`
- `verify-build` — project verification script inside container
- `run-go-tests` — isolated `run_go_tests.py` execution inside container
- `run-go-linter` — isolated `run_go_linter.py` execution inside container
- `run-go-coverage` — isolated `run_go_coverage.sh` execution inside container
- `codex-login` — interactive login container
- `dockerd` — internal Docker daemon for testcontainers/build flows

Typical login flow:

```bash
PROJECT_DIR="$PWD" docker compose -f "$AGENTWEAVER_HOME/docker-compose.yml" run --rm codex-login
```

Interactive Codex container:

```bash
PROJECT_DIR="$PWD" docker compose -f "$AGENTWEAVER_HOME/docker-compose.yml" run --rm codex
```

Non-interactive Codex run:

```bash
PROJECT_DIR="$PWD" docker compose -f "$AGENTWEAVER_HOME/docker-compose.yml" run --rm \
  -e CODEX_PROMPT="Review the project and fix failing tests" \
  codex-exec
```

Build verification:

```bash
PROJECT_DIR="$PWD" docker compose -f "$AGENTWEAVER_HOME/docker-compose.yml" run --rm verify-build
```

Tests only:

```bash
PROJECT_DIR="$PWD" docker compose -f "$AGENTWEAVER_HOME/docker-compose.yml" run --rm run-go-tests
```

Linter only:

```bash
PROJECT_DIR="$PWD" docker compose -f "$AGENTWEAVER_HOME/docker-compose.yml" run --rm run-go-linter
```

Coverage only:

```bash
PROJECT_DIR="$PWD" docker compose -f "$AGENTWEAVER_HOME/docker-compose.yml" run --rm run-go-coverage
```

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

Representative smoke checks during development:

```bash
node dist/index.js --help
node dist/index.js auto --help-phases
node dist/index.js plan --dry DEMO-123
node dist/index.js implement --dry DEMO-123
node dist/index.js review --dry DEMO-123
```

## Publishing

The package is prepared for npm publication and currently includes:

- npm bin entry: `agentweaver`
- `prepublishOnly` build/typecheck
- tarball filtering through `files`
- public publish config

Publish flow:

```bash
npm login
npm publish
```

If you want a public package, verify the package name and license before publishing.

## Security Notes

- the Codex container does not receive host `docker.sock`
- Docker access for tests goes through isolated `dockerd`
- secure Git protocols only: `ssh` and `https`
- `dockerd` runs privileged because DinD requires it; this is still safer than exposing host Docker directly
