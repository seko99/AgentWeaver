# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AgentWeaver is a TypeScript/Node.js CLI for harness engineering around coding agents. It uses declarative workflow specs (JSON) that define phases and steps, executed by runtime nodes in TypeScript. Artifacts on disk form the contract between stages, making runs resumable, inspectable, and operationally manageable through both CLI and a full-screen TUI.

## Build and Development Commands

```bash
npm install              # install dependencies
npm run build            # compile TypeScript + copy flow specs to dist/
npm run check            # type-check only (tsc --noEmit)
npm run dev -- --help    # run from source via ts-node/esm
```

## Testing

Tests use Node.js built-in test runner (`node:test` + `node:assert`). Test files live under `tests/`.

```bash
node --test tests/pipeline/nodes/git-status-node.test.mjs   # run a single test
bash tests/doctor/smoke.sh                                   # doctor smoke test
```

No comprehensive test suite exists yet. Every change should include at minimum:
- `npm run check` (type-check)
- CLI smoke tests: `node dist/index.js --help`, `node dist/index.js auto-golang --help-phases`
- `--dry` runs for flow changes (e.g. `node dist/index.js plan --dry DEMO-1234`)

## Architecture

The system has three layers with clear separation:

**Flow Specs (JSON)** — Declarative workflow definitions in `src/pipeline/flow-specs/` (built-in) or `.agentweaver/.flows/` (project-local). Define phases, steps, prompt bindings, params, expectations, conditions, and `after` actions.

**Nodes (TypeScript)** — Reusable runtime units in `src/pipeline/nodes/` (~28 nodes). Each implements `PipelineNodeDefinition<TParams, TResult>` and declares metadata: version, prompt requirement, required params, supported executors. Registered in `src/pipeline/node-registry.ts`.

**Executors (TypeScript)** — Integration layer in `src/executors/` for external systems (Codex, OpenCode, Jira, GitLab, shell, git, Telegram). Each implements `ExecutorDefinition<TConfig, TInput, TResult>` with data-only default configs in `src/executors/configs/`.

### Key Runtime Components

- `src/pipeline/declarative-flow-runner.ts` — Phase execution engine: loads specs, compiles repeat phases, executes steps, evaluates conditions
- `src/pipeline/value-resolver.ts` — Evaluates ValueSpec objects (const, ref, artifact ref, template, condition, concat, list) for step parameterization
- `src/pipeline/spec-compiler.ts` — Expands repeat phases into executable phases
- `src/pipeline/flow-catalog.ts` — Discovers built-in + project-local flows
- `src/flow-state.ts` — Persisted execution state for resumable flows
- `src/artifacts.ts` — Artifact path resolution and versioning; artifacts stored in `.agentweaver/scopes/<scope-key>/.artifacts/`
- `src/structured-artifact-schemas.json` — JSON schemas for machine-readable artifacts
- `src/pipeline/launch-profile-config.ts` — LLM executor + model selection for interactive runs

### Entry Points

- `src/index.ts` — CLI entrypoint, orchestration, and auto-pipeline state handling (~2000 lines, acts as CLI router)
- `src/interactive-ui.ts` — Full-screen TUI operator console (neo-blessed)
- `src/doctor/` — Diagnostics subsystem with category-based health checks

## Coding Conventions

- ES modules (`"type": "module"` in package.json), target ES2022, `NodeNext` module resolution
- TypeScript strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
- `camelCase` for functions/variables, `PascalCase` for types/classes, `UPPER_CASE` for module-level constants
- New external actions should be added as executor modules + config entries, not inline in `src/index.ts`
- Machine-readable artifacts (`.json`) must always be in English
- Human-readable artifacts (`.md`) use the workflow-selected `mdLang`

## Extending the System

- **New node**: Add to `src/pipeline/nodes/`, register in `node-registry.ts`
- **New executor**: Add to `src/executors/`, add default config in `src/executors/configs/`, register in `src/pipeline/registry.ts`
- **New flow**: Add JSON spec to `src/pipeline/flow-specs/` (built-in) or `.agentweaver/.flows/` (project-local); spec is validated at load time
- **New doctor check**: Add to `src/doctor/checks/`, register in `src/doctor/registry.ts`

## Build Notes

The build step `scripts/copy-flow-specs.mjs` copies JSON flow specs from `src/pipeline/flow-specs/` to `dist/pipeline/flow-specs/`. If you add or rename flow spec files, rebuild to keep dist in sync.
