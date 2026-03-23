# AgentWeaver

`AgentWeaver` is a TypeScript/Node.js CLI for engineering workflows around Jira, Codex, and Claude.

It orchestrates a flow like:

`plan -> implement -> test -> review -> review-fix -> test`

The package is designed to run as an npm CLI and includes an interactive terminal UI built on `neo-blessed`.

## What It Does

- Fetches a Jira issue by key or browse URL
- Generates workflow artifacts such as design, implementation plan, QA plan, reviews, and summaries
- Runs workflow stages like `plan`, `implement`, `review`, `review-fix`, `test`, and `auto`
- Persists `auto` pipeline state on disk so runs can resume
- Uses Docker runtime services for isolated Codex execution and build verification

## Architecture

The CLI now uses an executor + node + declarative flow architecture.

- `src/index.ts` remains the CLI entrypoint and high-level orchestration layer
- `src/executors/` contains first-class executors for external actions such as Jira fetch, local Codex, Docker-based build verification, Claude, Claude summaries, and process execution
- `src/pipeline/nodes/` contains reusable runtime nodes built on top of executors
- `src/pipeline/flow-specs/` contains declarative JSON flow specs for `preflight`, `plan`, `implement`, `review`, `review-fix`, `test`, `test-fix`, `test-linter-fix`, and `auto`
- `src/runtime/` contains shared runtime services such as command resolution, Docker runtime environment setup, and subprocess execution

This keeps command handlers focused on choosing a flow and providing parameters instead of assembling prompts and subprocess wiring inline.

## Repository Layout

- `src/` — main TypeScript sources
- `src/index.ts` — CLI entrypoint and workflow orchestration
- `src/pipeline/flow-specs/` — declarative JSON specs for workflow stages
- `src/pipeline/nodes/` — reusable pipeline nodes executed by the declarative runner
- `src/interactive-ui.ts` — interactive TUI built with `neo-blessed`
- `src/markdown.ts` — markdown-to-terminal renderer for the TUI
- `src/executors/` — executor modules for concrete execution families
- `src/executors/configs/` — default executor configs kept as plain data
- `src/runtime/` — shared runtime services used by executors
- `docker-compose.yml` — runtime services for Codex and build verification
- `Dockerfile.codex` — container image for Codex runtime
- `verify_build.sh` — project-specific verification entrypoint used by `verify-build`
- `package.json` — npm package metadata and scripts
- `tsconfig.json` — TypeScript configuration

## Requirements

- Node.js `>= 18.19.0`
- npm
- Docker with `docker compose` or `docker-compose`
- `codex` CLI for `plan` and Codex-driven steps
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
agentweaver implement DEMO-3288
agentweaver review DEMO-3288
agentweaver auto DEMO-3288
```

From source checkout:

```bash
node dist/index.js plan DEMO-3288
node dist/index.js auto DEMO-3288
```

Interactive mode:

```bash
agentweaver DEMO-3288
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

## Interactive TUI

Interactive mode opens a full-screen terminal UI with:

- command input
- activity log
- task summary pane
- command list/help
- keyboard navigation between panes

Current navigation:

- `Enter` — run command
- `Tab` / `Shift+Tab` — switch panes
- `Ctrl+J` — focus activity log
- `Ctrl+K` — focus command input
- `Ctrl+U` — focus task summary
- `Ctrl+H` — focus commands pane
- `PgUp` / `PgDn` / `Home` / `End` — scroll focused panes
- `?` or `F1` — help overlay
- `q` or `Ctrl+C` — exit

## Docker Runtime

Docker is used as an isolated execution environment for Codex and build/test verification.

Main services:

- `codex` — interactive Codex container
- `codex-exec` — non-interactive `codex exec`
- `verify-build` — project verification script inside container
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
