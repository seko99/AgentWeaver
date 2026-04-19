# Flow Specs

This document describes the declarative flow-spec format used by AgentWeaver today.

In architectural terms, flow specs are the language AgentWeaver uses for harness engineering. They are not just config files for commands. They define the workflow model that the CLI, resumable automation, and TUI all operate on.

The current implementation lives in:

- [src/pipeline/spec-types.ts](src/pipeline/spec-types.ts)
- [src/pipeline/spec-loader.ts](src/pipeline/spec-loader.ts)
- [src/pipeline/spec-validator.ts](src/pipeline/spec-validator.ts)
- [src/pipeline/spec-compiler.ts](src/pipeline/spec-compiler.ts)
- [src/pipeline/declarative-flow-runner.ts](src/pipeline/declarative-flow-runner.ts)
- [src/pipeline/value-resolver.ts](src/pipeline/value-resolver.ts)

If this document and the code disagree, the code is the source of truth.

## Why Flow Specs Exist

Flow specs keep orchestration declarative:

- JSON says what phases and steps should run
- runtime nodes in TypeScript say how each step executes
- executors provide integration with Codex, OpenCode, Jira, GitLab, shell commands, and related actions

That separation is the core of AgentWeaver's harness engineering approach. It keeps workflow design, runtime execution, validation, and operational control separated cleanly enough to evolve without rewriting command handlers.

Practically, this gives the project:

- a stable workflow description that can be reviewed like code
- reusable runtime behavior behind nodes and executors
- predictable artifacts and postconditions between stages
- a workflow graph that can be surfaced consistently in the TUI and in resumable runs

## Where Flow Specs Live

Built-in flow specs:

- `src/pipeline/flow-specs/**/*.json`

Project-local flow specs:

- `.agentweaver/.flows/**/*.json`

Discovery is recursive for both built-in and project-local flows.

Project-local flow ids are derived from the relative path inside `.agentweaver/.flows/` without the `.json` suffix. For example:

- `.agentweaver/.flows/my-team/release-check.json` -> `my-team/release-check`

Flow ids must be unique across the combined catalog. A project-local flow cannot shadow a built-in flow id.

## Load and Validation Pipeline

When a flow is loaded:

1. the JSON file is parsed
2. the validator checks structure and references
3. the compiler expands repeated phases into executable phases
4. the runner executes the expanded phases

Validation currently checks:

- `kind` and `version` structure
- known `node` ids
- required executors declared by node metadata
- required node params
- prompt template references
- artifact ref kinds
- artifact-list ref kinds
- structured artifact schema ids
- `ref` scope/path correctness
- nested `flow-run` file references when they are constant strings

## Top-Level Shape

Every flow spec has this shape:

```json
{
  "kind": "flow",
  "version": 1,
  "constants": {},
  "phases": []
}
```

Fields:

- `kind: string` — flow family identifier persisted into execution state
- `version: number` — flow format/version marker
- `constants?: Record<string, JsonValue>` — reusable flow-level constants available through `ref: "flow.<name>"`
- `phases` — ordered list of executable phases or repeat blocks

## Phases

A phase is the main user-visible stage in a declarative flow.

Shape:

```json
{
  "id": "plan",
  "when": { "exists": { "ref": "params.taskKey" } },
  "steps": []
}
```

Fields:

- `id` — non-empty phase id
- `when?` — optional condition; false means the phase is skipped
- `steps` — ordered list of steps

For resumable flows such as `auto-golang`, phase ids are the identifiers shown in `--help-phases`, persisted in flow state, and used by restart-from-phase logic.

They are also the primary units the TUI can present to an operator when showing workflow progress.

## Repeat Blocks

The flow compiler supports repeated phase groups:

```json
{
  "repeat": {
    "var": "iteration",
    "from": 1,
    "to": 3
  },
  "phases": [
    {
      "id": "review_{iteration}",
      "steps": []
    }
  ]
}
```

At compile time, repeated phases are expanded and receive `repeatVars`. Those values are later available via `ref: "repeat.<name>"`.

## Steps

A step is the executable unit inside a phase.

Shape:

```json
{
  "id": "run_codex_plan",
  "node": "codex-prompt",
  "when": { "exists": { "ref": "params.taskKey" } },
  "prompt": {},
  "params": {},
  "expect": [],
  "stopFlowIf": { "ref": "steps.run_codex_plan.stopFlow" },
  "after": []
}
```

Fields:

- `id` — stable step id within the phase
- `node` — runtime node kind from the node registry
- `when?` — optional condition; false means the step is skipped
- `prompt?` — declarative prompt binding for nodes that accept or require prompts
- `params?` — runtime parameters passed to the node after value resolution
- `expect?` — postconditions checked after the node completes
- `stopFlowIf?` — condition that can terminate the remaining flow after a successful step
- `after?` — post-step side effects

Node metadata controls whether a prompt is forbidden, optional, or required, and which params are mandatory.

From a harness-engineering perspective, steps are where a declarative workflow binds to concrete runtime capabilities without collapsing back into imperative scripting.

## Nodes

`node` values are references into the runtime node registry, not inline implementations.

Examples in the current codebase include:

- `jira-fetch`
- `codex-prompt`
- `opencode-prompt`
- `flow-run`
- `command-check`
- `build-failure-summary`
- `git-commit`
- `telegram-notifier`

See:

- [src/pipeline/node-registry.ts](src/pipeline/node-registry.ts)
- [src/pipeline/nodes/](src/pipeline/nodes)

## Prompt Binding

`prompt` describes how to assemble the final prompt text before it is passed to a prompt-capable node.

Shape:

```json
{
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

Supported fields:

- `templateRef` — named prompt template from the prompt registry
- `inlineTemplate` — inline string template instead of a named one
- `vars` — variables used for template interpolation
- `extraPrompt` — additional text appended via prompt runtime
- `format` — currently `plain` or `task-prompt`

At least one of `templateRef` or `inlineTemplate` must be present when `prompt` is defined.

See:

- [src/pipeline/prompt-registry.ts](src/pipeline/prompt-registry.ts)
- [src/pipeline/prompt-runtime.ts](src/pipeline/prompt-runtime.ts)

## Params

`params` are runtime inputs for the selected node.

Examples:

- `jira-fetch` may receive `jiraApiUrl` and `outputFile`
- `codex-prompt` may receive `labelText`, `model`, `outputFile`, or other node-specific values
- `flow-run` requires `fileName`

Prompt text is not part of `params`; it is assembled separately through `prompt`.

## Value Resolution

Most non-literal values in a flow spec are expressed with `ValueSpec`.

Currently supported value forms:

- `{ "const": ... }`
- `{ "ref": "..." }`
- `{ "artifact": { ... } }`
- `{ "artifactList": { ... } }`
- `{ "template": "...", "vars": { ... } }`
- `{ "appendPrompt": { "base": ..., "suffix": ... } }`
- `{ "add": [ ... ] }`
- `{ "concat": [ ... ] }`
- `{ "list": [ ... ] }`

### `const`

Returns the literal JSON value as-is.

### `ref`

Reads another runtime value by path.

Supported ref scopes are:

- `params`
- `flow`
- `context`
- `repeat`
- `steps`

Examples:

- `params.taskKey`
- `flow.autoReviewFixExtraPrompt`
- `context.cwd`
- `repeat.iteration`
- `steps.fetch_jira.outputs.outputFile`

`steps.*` refs are validated against previously available steps. A step cannot depend on a later step.

### `artifact`

Resolves the path to a single known artifact kind.

Example:

```json
{
  "artifact": {
    "kind": "plan-file",
    "taskKey": { "ref": "params.taskKey" }
  }
}
```

This computes a path only. It does not assert that the file exists.

### `artifactList`

Resolves to a list of artifact paths for a known artifact-list kind.

Example:

```json
{
  "artifactList": {
    "kind": "plan-artifacts",
    "taskKey": { "ref": "params.taskKey" }
  }
}
```

### `template`

Interpolates a local string template using resolved variables.

### `appendPrompt`

Builds prompt-like text by appending `suffix` to an optional `base`.

### `add`

Resolves a list of values and adds them numerically.

### `concat`

Resolves a list of values and concatenates them as strings.

### `list`

Resolves a list of values and returns them as an array.

## Conditions

`when` and `stopFlowIf` use `ConditionSpec`.

Supported condition forms:

- `{ "ref": "..." }`
- `{ "not": { ... } }`
- `{ "all": [ ... ] }`
- `{ "any": [ ... ] }`
- `{ "equals": [valueA, valueB] }`
- `{ "exists": valueSpec }`

Conditions are evaluated at runtime after all referenced values have been resolved.

## Expectations

`expect` defines postconditions for a completed step.

Currently supported expectation kinds:

- `require-artifacts`
- `require-structured-artifacts`
- `require-file`
- `step-output`

### `require-artifacts`

Expects a resolved string array of file paths and fails if required artifacts are missing.

### `require-structured-artifacts`

Expects a list of `{ path, schemaId }` items and validates each JSON artifact against the registered structured-artifact schema.

### `require-file`

Expects a single path to exist.

### `step-output`

Checks a runtime value from execution state. It can either:

- assert truthiness of `value`
- compare `value` to `equals`

Important detail: `step-output` is evaluated against current execution state, not against serialized persisted auto state on disk.

## `after` Actions

`after` performs post-step side effects after a successful step.

Currently supported action:

- `set-summary-from-file`

Example:

```json
{
  "kind": "set-summary-from-file",
  "path": {
    "artifact": {
      "kind": "task-summary-file",
      "taskKey": { "ref": "params.taskKey" }
    }
  }
}
```

This reads the file and updates runtime summary state through `context.setSummary(...)`.

The target file does not have to be a dedicated `task-summary-file`. Any markdown artifact can be published into the runtime summary pane this way. In the built-in flows, for example:

- `bug-analyze` can publish a cached task summary markdown artifact
- `normalize-task-source` publishes the normalized task-context markdown artifact

From the operator's perspective, the TUI summary pane is therefore a generic runtime summary surface populated by flow specs, not a hard-coded view of one artifact kind.

## Nested Flows with `flow-run`

The `flow-run` node executes another declarative flow by file name.

Example:

```json
{
  "id": "run_review_loop",
  "node": "flow-run",
  "params": {
    "fileName": { "const": "review-loop.json" },
    "taskKey": { "ref": "params.taskKey" }
  }
}
```

Resolution rules:

- if the file name matches exactly one built-in flow spec, it is used
- if it matches exactly one project-local flow spec, it is used
- ambiguous names fail validation/runtime
- constant `fileName` values are validated up front

Important implementation detail: `flow-run` is not always a pure parameter passthrough. For some built-in nested flow kinds, the runtime enriches the child flow params from scope-local artifact contracts before execution. In particular:

- `design-review-flow` resolves the latest planning bundle plus optional normalized task context, Jira context, planning answers, and manual task input
- `plan-revise-flow` resolves the latest design-review verdict, source planning artifacts, optional normalized task context, Jira context, planning answers, and manual task input
- `review-flow` resolves the latest planning artifacts plus optional normalized task context, Jira context, and manual task input

This contract injection is what allows child specs to reference params such as `params.designFile`, `params.planJsonFile`, or `params.taskContextJsonFile` without each caller having to wire every artifact path manually.

## Persisted State vs Runtime State

Declarative flow execution uses two different layers of state:

- runtime execution state
- persisted resumable state

Runtime execution state includes:

- phase and step statuses
- step `value`
- step `outputs`
- repeat variables
- termination flags

Persisted resumable state is intentionally smaller and is used mainly for long-running resumable flows such as `auto-golang`.

Persisted state keeps:

- statuses
- timestamps
- repeat variables
- stop/termination markers
- selected launch profile

Large prompt outputs and step payloads are not serialized there.

That split matters operationally:

- runtime state is rich enough for intra-run references and step chaining
- persisted state is compact enough for resumable harness execution
- the TUI and automation logic can expose flow progress without depending on raw agent transcripts

## Minimal Example

```json
{
  "kind": "flow",
  "version": 1,
  "constants": {
    "summaryTitle": "Planning summary"
  },
  "phases": [
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
  ]
}
```

## Practical Guidance

- Use flow JSON to describe orchestration, not subprocess details.
- Put executor-specific behavior into nodes and executors, not into ad-hoc flow fields.
- Use `expect` to define postconditions explicitly instead of relying on implicit side effects.
- Prefer structured JSON artifacts for machine-readable contracts between stages.
- Keep nested flow file names unique if you plan to call them via `flow-run`.
- When changing the format, update `spec-types.ts`, validator, resolver, and this document together.
- When designing a new workflow, think in harness terms first: operator-visible phases, durable artifacts, explicit postconditions, and resumability boundaries.
