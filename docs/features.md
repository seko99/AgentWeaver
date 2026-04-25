# Key Features

AgentWeaver is built around harness engineering: the workflow around the coding agent is explicit, versioned, inspectable, and repeatable. This document expands the key features summarized in the README and points to the deeper reference documents.

## Declarative Agent Workflows

AgentWeaver workflows are JSON flow specs. A flow declares phases, steps, prompt bindings, params, conditions, expected artifacts, and post-step actions. Runtime behavior lives in typed nodes and executors instead of ad-hoc command handlers.

This makes workflows reviewable as source code and lets the same model power direct CLI commands, long-running automation, and the interactive TUI.

Reference: [Declarative Workflows](declarative-workflows.md)

## Project Playbook

The project playbook stores repository-local conventions under `.agentweaver/playbook/`. It contains a manifest, stable practices, examples, templates, and baseline project context.

Guided workflows validate the playbook, select compact phase-specific guidance, and pass that guidance into planning, design review, implementation, review, and repair prompts. This helps repeated agent runs inherit the same project knowledge without copying long instructions into every prompt.

Reference: [Project Playbook](playbook.md)

## Artifact-First Execution

AgentWeaver treats artifacts as the contract between stages. LLM-backed stages write structured JSON artifacts first, then derivative markdown for human reading.

This gives each workflow durable intermediate state: normalized task context, planning questions, design, implementation plan, QA plan, review findings, repair reports, project guidance, and other artifacts can be inspected, validated, reused, or used to resume a run.

## Planning and Design Review

Planning is not only a prompt. The planning flow produces structured design, implementation plan, and QA plan artifacts. `design-review` then critiques those planning artifacts before implementation starts.

For planning-heavy work, `auto-common` can run a design-review loop and iterate through `plan-revise` before coding. This makes implementation less dependent on a single speculative prompt.

## Review and Repair Loops

Review stages produce structured findings with severity levels. Repair stages can use those findings to select blockers and critical issues, build targeted fix prompts, apply changes, and run follow-up checks.

Loop flows such as `review-loop`, `run-go-tests-loop`, and `run-go-linter-loop` make repeated review/fix/check cycles explicit and bounded.

## Resumable Automation

Long-running flows persist compact execution state under `.agentweaver/scopes/<scope>/`. AgentWeaver uses that state with artifacts and launch profile checks to support resume, continue, and restart behavior.

This is especially useful for end-to-end flows such as `auto-common`, `auto-golang`, and review/check loops where restarting from scratch would waste context and work.

## Execution Backends

AgentWeaver routes work through executors. Built-in executors cover Codex, OpenCode, Jira fetch, GitLab diff/review fetch, shell/process checks, Git commit, and Telegram notifications.

Executor configuration is separated from flow specs, so workflows can describe what should happen while runtime profiles decide how work is executed.

## Interactive TUI and Direct CLI

The same flow model works in direct CLI commands and in the interactive terminal UI. The TUI surfaces discovered flows, flow descriptions, active state, progress, and summary artifacts.

This lets operators choose between fast command execution and supervised long-running workflows without changing the underlying flow definitions.

## Custom Flows

Built-in flows live under `src/pipeline/flow-specs/`, while custom flow specs can live under `~/.agentweaver/.flows/` or project-local `.agentweaver/.flows/`.

Custom flows are discovered recursively, validated at load time, and can compose built-in, global, or project-local flows through nested `flow-run` steps.

Reference: [Declarative Workflows](declarative-workflows.md)

## Plugin SDK

Local plugins can add public-SDK-compatible nodes and executors. Plugin manifests declare ids, SDK version, runtime entrypoints, and contributed runtime capabilities.

The loader validates plugin manifests, SDK compatibility, executor definitions, node metadata, and version consistency before plugin contributions become available to flows.

Reference: [Plugin SDK](plugin-sdk.md)

## Operational Diagnostics

The `doctor` command checks readiness before a workflow fails mid-run. It covers system requirements, executor configuration, flow readiness, node versions, current working directory context, AgentWeaver home configuration, and environment diagnostics.

Diagnostics are available as human-readable output or JSON for automation.
