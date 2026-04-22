# AgentWeaver Plugin SDK

This guide is for external plugin authors who want to add custom executors, custom nodes, and custom declarative flows without modifying AgentWeaver core.

Use only the public SDK import:

```ts
import type {
  ExecutorDefinition,
  JsonValue,
  NodeContractMetadata,
  PipelineNodeDefinition,
  PluginEntryModuleExports,
  PluginExecutorRegistration,
  PluginManifest,
  PluginNodeRegistration,
} from "agentweaver/plugin-sdk";
```

Do not import from:

- `agentweaver`
- `agentweaver/dist/*`
- `agentweaver/src/*`
- repository-relative source paths

## Architecture Overview

AgentWeaver has four pieces that matter to plugin authors:

- An `executor` integrates with an external tool or runtime action. It is a typed function with `defaultConfig` and `execute`.
- A `node` is the runtime unit referenced from declarative flow JSON. A node can use executors, read flow context, and return outputs.
- A `flow` is declarative JSON loaded from built-in specs, global `~/.agentweaver/.flows/**/*.json`, or project-local `.agentweaver/.flows/**/*.json`.
- A `plugin manifest` tells AgentWeaver where a global or project-local plugin is installed and which ESM entrypoint to load.

The runtime merges built-in registries with global and project-local plugin registrations. Flow validation then runs against that merged registry. That means a custom flow can reference plugin-provided node kinds directly, and plugin node metadata can declare dependencies on built-in or plugin-provided executor ids.

## Installation Layout

Supported plugin locations are:

```text
~/.agentweaver/.plugins/<plugin-id>/plugin.json
.agentweaver/.plugins/<plugin-id>/plugin.json
```

Rules enforced by the loader:

- AgentWeaver discovers plugin directories from `~/.agentweaver/.plugins/` and `.agentweaver/.plugins/`.
- Directories are loaded in lexicographic order.
- Each plugin directory must contain `plugin.json`.
- The directory name must match the manifest `id` exactly.
- Loading is fail-fast. An invalid plugin stops registry construction.
- Invalid plugins are not skipped partially.
- Duplicate built-in ids and duplicate plugin ids are rejected by registry creation.

Custom flows live under:

```text
~/.agentweaver/.flows/**/*.json
.agentweaver/.flows/**/*.json
```

Those flows use the same validator and runtime as built-in flows.
If the same flow id or plugin id is discovered from more than one source, AgentWeaver fails fast instead of silently overriding one source with another.

## Claude Example Plugin

This repository includes a complete project-local reference example under `docs/example/`.

Files in the example:

- plugin manifest: `docs/example/.plugins/claude-example-plugin/plugin.json`
- plugin entrypoint: `docs/example/.plugins/claude-example-plugin/index.js`
- example flow: `docs/example/.flows/examples/claude-example.json`

The `docs/example/` directory is documentation material, not an auto-loaded runtime location. AgentWeaver discovers plugins and flows only from `~/.agentweaver/.plugins/`, `~/.agentweaver/.flows/`, `.agentweaver/.plugins/`, and `.agentweaver/.flows/`.

To wire the example into a real AgentWeaver project, copy it into either the global or the project-local `.agentweaver/` directory.

Project-local wiring:

```bash
mkdir -p .agentweaver/.plugins/claude-example-plugin
mkdir -p .agentweaver/.flows/examples
cp docs/example/.plugins/claude-example-plugin/plugin.json .agentweaver/.plugins/claude-example-plugin/plugin.json
cp docs/example/.plugins/claude-example-plugin/index.js .agentweaver/.plugins/claude-example-plugin/index.js
cp docs/example/.flows/examples/claude-example.json .agentweaver/.flows/examples/claude-example.json
```

Global wiring:

```bash
mkdir -p ~/.agentweaver/.plugins/claude-example-plugin
mkdir -p ~/.agentweaver/.flows/examples
cp docs/example/.plugins/claude-example-plugin/plugin.json ~/.agentweaver/.plugins/claude-example-plugin/plugin.json
cp docs/example/.plugins/claude-example-plugin/index.js ~/.agentweaver/.plugins/claude-example-plugin/index.js
cp docs/example/.flows/examples/claude-example.json ~/.agentweaver/.flows/examples/claude-example.json
```

After that, AgentWeaver will load either:

- the plugin manifest from `.agentweaver/.plugins/claude-example-plugin/plugin.json`
- the plugin module from `.agentweaver/.plugins/claude-example-plugin/index.js`
- the example flow from `.agentweaver/.flows/examples/claude-example.json`

or:

- the plugin manifest from `~/.agentweaver/.plugins/claude-example-plugin/plugin.json`
- the plugin module from `~/.agentweaver/.plugins/claude-example-plugin/index.js`
- the example flow from `~/.agentweaver/.flows/examples/claude-example.json`

This example specifically demonstrates an external plugin without any core registry changes. It imports only `agentweaver/plugin-sdk` and does not depend on `agentweaver`, `agentweaver/dist/*`, `agentweaver/src/*`, or repository-relative internal paths.

The supported Claude CLI invocation contract used by the example is fixed:

```text
claude -p <prompt> --output-format json [--model <value>] [--max-turns <n>]
```

The configuration precedence is also fixed:

- direct executor-run override
- `CLAUDE_MODEL` and `CLAUDE_MAX_TURNS`
- `defaultConfig`

If the final value is empty, the corresponding flag must be omitted.
The binary path is resolved through `runtime.resolveCmd(config.defaultCommand, config.commandEnvVar)`; in this example that env var is `CLAUDE_BIN`.

Before an optional local smoke test, verify the CLI setup separately:

```bash
claude auth status
```

If that command exits non-zero, treat it as a setup prerequisite failure, not an AgentWeaver SDK defect.

Claude JSON response normalization in this example is the authoritative contract:

1. `result`
2. `message.content[*].text`
3. `content[*].text`

Fallback array rules:

- traversal keeps the original array order
- only `text` values that are strings with non-empty `trim()` are preserved
- preserved fragments are kept without semantic rewriting
- the final string is joined with a single newline character
- empty, whitespace-only, missing, `null`, and non-string items are ignored

If no supported assistant text source exists after those rules, the example must fail with a deterministic normalization contract error.
The `model` field comes from non-empty `payload.model`, or falls back to the effective configured model for the current run.
The parsed payload is preserved without rewriting as `rawResponse`.

Representative fixtures that the plugin should handle:

```json
{
  "result": "Top-level result wins",
  "model": "claude-3-7-sonnet"
}
```

```json
{
  "message": {
    "content": [
      { "text": "First fragment" },
      { "type": "tool_use" },
      { "text": "Second fragment" }
    ]
  }
}
```

```json
{
  "content": [
    { "text": "Alpha" },
    { "text": "Beta" }
  ]
}
```

The proof artifact contract in this example is also fixed:

- file: `.agentweaver/.artifacts/examples/claude-example-proof.json`
- logical key: `artifacts/examples/claude-example-proof.json`
- schema: `helper-json/v1`
- writer: `claude-prompt`

`claude-prompt` writes the JSON object itself with exactly the fields `response`, `command`, `model`, and `executor`, then publishes it through node outputs with manifest metadata.
That matters: the proof file must not depend on a second node, a manual step, or a separate core serialization feature.

## Manifest Contract

`plugin.json` must be a JSON object with these required fields:

- `id`
- `sdk_version`
- `entrypoint`

Supported optional fields:

- `name`
- `version`
- `description`

Example:

```json
{
  "id": "sample-plugin",
  "sdk_version": 1,
  "entrypoint": "index.js",
  "name": "Sample Plugin",
  "version": "0.1.0",
  "description": "Custom executor and node for a project-local flow."
}
```

Validation rules:

- `id` must be a non-empty string.
- `sdk_version` must be a positive integer.
- `sdk_version` must match the current supported SDK major exactly. Today that value is `1`.
- `entrypoint` must be a non-empty string.

## Entrypoint Rules

The manifest `entrypoint` is resolved relative to the plugin root.

Supported module formats:

- ESM `.js`
- ESM `.mjs`

Unsupported patterns:

- `.cjs`
- files without `.js` or `.mjs`
- entrypoints outside the plugin root
- default exports

The plugin entry module may export:

- `executors`
- `nodes`
- both

At least one recognized non-empty registration array must exist.

This is valid:

```ts
export const executors = [/* ... */];
export const nodes = [/* ... */];
```

This is invalid:

```ts
export default {
  executors: [],
};
```

## Executor Contract

Executors are registered as objects with `id` and `definition`.

```ts
import type { ExecutorDefinition, JsonValue, PluginExecutorRegistration } from "agentweaver/plugin-sdk";

type EchoConfig = {
  prefix: string;
};

type EchoInput = {
  message: string;
};

type EchoResult = {
  echoed: string;
};

const echoExecutorDefinition: ExecutorDefinition<EchoConfig, EchoInput, EchoResult> = {
  kind: "sample-echo-executor",
  version: 1,
  defaultConfig: {
    prefix: "plugin:",
  },
  async execute(context, input, config) {
    context.ui.writeStdout(`[sample-echo-executor] ${input.message}\n`);
    return {
      echoed: `${config.prefix}${input.message}`,
    };
  },
};

export const executors: PluginExecutorRegistration[] = [
  {
    id: "sample-echo-executor",
    definition: echoExecutorDefinition,
  },
];
```

Rules enforced by the loader:

- `definition.kind === id`
- `definition.version` must be a positive integer
- `definition.defaultConfig` must be JSON-serializable
- `definition.execute` must be a function

### Executor Runtime Context

`ExecutorContext` contains:

- `cwd`: current project working directory
- `env`: resolved process environment
- `ui`: terminal output adapter
- `dryRun`: whether the current execution is dry-run
- `verbose`: verbose execution flag
- `mdLang`: markdown language preference when available
- `runtime.resolveCmd(name, envVarName)`: resolve a tool path
- `runtime.runCommand(argv, options)`: run a subprocess
- `runtime.artifactRegistry`: publish artifacts through the runtime registry

Use these facade APIs instead of importing internal runtime modules from AgentWeaver source.

## Node Contract

Nodes are what flow JSON references through `step.node`.

Each node registration has three parts:

- `id`
- `definition`
- `metadata`

Example:

```ts
import type {
  NodeContractMetadata,
  PipelineNodeDefinition,
  PluginNodeRegistration,
} from "agentweaver/plugin-sdk";

type SampleNodeParams = {
  message: string;
};

type SampleNodeResult = {
  echoed: string;
};

const sampleNodeDefinition: PipelineNodeDefinition<SampleNodeParams, SampleNodeResult> = {
  kind: "sample-node",
  version: 1,
  async run(context, params) {
    const executor = context.executors.get("sample-echo-executor");
    const result = await executor.execute(context, { message: params.message }, executor.defaultConfig);
    context.setSummary?.(`Echoed: ${result.echoed}`);
    return {
      value: {
        echoed: result.echoed,
      },
    };
  },
};

const sampleNodeMetadata: NodeContractMetadata = {
  kind: "sample-node",
  version: 1,
  prompt: "forbidden",
  requiredParams: ["message"],
  executors: ["sample-echo-executor"],
};

export const nodes: PluginNodeRegistration[] = [
  {
    id: "sample-node",
    definition: sampleNodeDefinition,
    metadata: sampleNodeMetadata,
  },
];
```

Rules enforced by the loader:

- `definition.kind === id`
- `metadata.kind === id`
- `definition.version` must be a positive integer
- `metadata.version` must be a positive integer
- `definition.version === metadata.version`
- `definition.run` must be a function
- `metadata.prompt` must be one of `required`, `allowed`, or `forbidden`
- `metadata.requiredParams`, when present, must be a non-empty `string[]`
- `metadata.executors`, when present, must be a non-empty `string[]`
- `metadata.nestedFlowParam`, when present, must be a non-empty string

After registries are merged, every executor id listed in `metadata.executors` must exist. This can point to built-in executors or plugin-provided executors.

### Node Runtime Context

`PipelineContext` contains everything from the executor-facing runtime plus pipeline-specific services:

- `issueKey`
- `jiraRef`
- `cwd`
- `env`
- `ui`
- `dryRun`
- `verbose`
- `mdLang`
- `runtime`
- `executors`
- `nodes`
- `registryContext`
- `setSummary(markdown)`
- `requestUserInput(...)` when the active node supports it
- `executionRouting`
- resume helpers such as `resumeStepValue` and `persistRunningStepValue`

Use the context object and the public SDK types as the stable integration surface. Do not couple plugin code to internal files under `src/` or `dist/`.

## Executors vs. Nodes

Use an executor when you need a reusable integration boundary:

- call an external CLI
- wrap a service client
- normalize I/O or configuration across nodes

Use a node when you need a flow-visible runtime unit:

- consume flow params
- enforce required params and prompt behavior through metadata
- combine one or more executors
- publish outputs or set summaries for the surrounding flow

A declarative flow never references an executor directly. It references node kinds. Nodes are the bridge between flow JSON and executor-backed behavior.

## Complete Plugin Entry Module

The following `index.js` is a minimal but complete plugin entrypoint that exports both a custom executor and a custom node:

```js
/** @type {import("agentweaver/plugin-sdk").PluginExecutorRegistration[]} */
export const executors = [
  {
    id: "sample-echo-executor",
    definition: {
      kind: "sample-echo-executor",
      version: 1,
      defaultConfig: {
        prefix: "plugin:",
      },
      async execute(context, input, config) {
        context.ui.writeStdout(`[sample-echo-executor] ${String(input.message)}\n`);
        return {
          echoed: `${config.prefix}${String(input.message)}`,
        };
      },
    },
  },
];

/** @type {import("agentweaver/plugin-sdk").PluginNodeRegistration[]} */
export const nodes = [
  {
    id: "sample-node",
    definition: {
      kind: "sample-node",
      version: 1,
      async run(context, params) {
        const executor = context.executors.get("sample-echo-executor");
        const result = await executor.execute(
          context,
          { message: String(params.message) },
          executor.defaultConfig,
        );
        context.setSummary?.(`Sample node completed with ${result.echoed}`);
        return {
          value: result,
        };
      },
    },
    metadata: {
      kind: "sample-node",
      version: 1,
      prompt: "forbidden",
      requiredParams: ["message"],
      executors: ["sample-echo-executor"],
    },
  },
];
```

## Wiring a Custom Flow

A custom flow can be discovered from `~/.agentweaver/.flows/**/*.json` or `.agentweaver/.flows/**/*.json`.

A flow can reference your plugin-provided node id directly:

```json
{
  "kind": "sample-flow",
  "version": 1,
  "description": "Run the sample plugin node.",
  "phases": [
    {
      "id": "run-sample",
      "steps": [
        {
          "id": "echo",
          "node": "sample-node",
          "params": {
            "message": {
              "const": "hello from plugin"
            }
          }
        }
      ]
    }
  ]
}
```

Save that file as either:

```text
.agentweaver/.flows/sample-flow.json
```

or:

```text
~/.agentweaver/.flows/sample-flow.json
```

Once the plugin loads successfully, the flow validator treats `sample-node` like any built-in node kind.

### Nested Flow Resolution

If a node supports nested flow references through a metadata field such as `nestedFlowParam`, AgentWeaver resolves the nested flow by file name.

Resolution rules:

- project-local, global, and built-in flow file names must not collide for the same nested flow reference
- multiple project-local files with the same base file name are ambiguous
- multiple global files with the same base file name are ambiguous
- multiple built-in files with the same base file name are ambiguous
- an unknown file name fails validation

Keep nested flow file names unique when you rely on file-name-based resolution.

## End-to-End Walkthrough

This walkthrough is the acceptance path for the public docs. It creates a throwaway local plugin and runs a custom flow using only the documented contract.

### 1. Create the plugin directory

Use either project-local or global installation. Project-local example:

```bash
mkdir -p .agentweaver/.plugins/sample-plugin
```

Global example:

```bash
mkdir -p ~/.agentweaver/.plugins/sample-plugin
```

### 2. Write `plugin.json`

```json
{
  "id": "sample-plugin",
  "sdk_version": 1,
  "entrypoint": "index.js",
  "name": "Sample Plugin",
  "version": "0.1.0",
  "description": "Throwaway local plugin used to validate the public SDK guide."
}
```

Write it to one of:

```text
.agentweaver/.plugins/sample-plugin/plugin.json
~/.agentweaver/.plugins/sample-plugin/plugin.json
```

### 3. Write the plugin entrypoint

Write the complete `index.js` example from the previous section to one of:

```text
.agentweaver/.plugins/sample-plugin/index.js
~/.agentweaver/.plugins/sample-plugin/index.js
```

### 4. Create the custom flow

Project-local:

```bash
mkdir -p .agentweaver/.flows
```

Global:

```bash
mkdir -p ~/.agentweaver/.flows
```

Create `sample-flow.json` in the matching flow directory with the flow JSON from the previous section.

### 5. Build AgentWeaver

From the AgentWeaver repository:

```bash
npm install
npm run build
```

### 6. Run the flow

Custom flows are discovered in the interactive catalog:

```bash
node dist/index.js
node dist/index.js --help
```

The flow should appear under either the `global` or `custom` catalog root with the id `sample-flow`. Select it from interactive mode and run it there.

### 7. Expected result

The registry should load the plugin, validate `sample-node`, and allow the custom flow to execute without reading AgentWeaver internals.

If execution fails, use the troubleshooting section below before inspecting any core source files.

## Compatibility and Versioning

Compatibility is strict:

- `sdk_version` must match the currently supported SDK major exactly
- the current public SDK major is `1`
- the supported public export is `agentweaver/plugin-sdk`
- built-in node and executor ids are protected and cannot be overridden
- plugin-provided ids must also be unique across all loaded plugins

Recommended upgrade workflow after updating AgentWeaver:

1. Check whether `AGENTWEAVER_PLUGIN_SDK_VERSION` changed.
2. Update `sdk_version` in each plugin manifest if the SDK major changed.
3. Rebuild AgentWeaver.
4. Run at least one local custom flow that exercises your plugin nodes.
5. Re-check packaging or deployment steps if you publish your plugin from a separate repository.

If the SDK major changes, review your plugin entrypoint, executor definitions, node metadata, and custom flow assumptions before trusting the plugin in production use.

## Testing Workflow for Plugin Authors

A practical minimum workflow:

1. Build AgentWeaver with `npm run build`.
2. Keep your plugin under `~/.agentweaver/.plugins/<plugin-id>/` or `.agentweaver/.plugins/<plugin-id>/`.
3. Keep one or more smoke-test flows under `~/.agentweaver/.flows/` or `.agentweaver/.flows/`.
4. Run a custom flow that touches every plugin node and executor dependency.
5. Re-run the flow after every AgentWeaver upgrade.

Useful checks:

- `npm run check`
- `npm run build`
- `node dist/index.js --help`
- interactive catalog inspection to confirm the custom flow is visible

## Troubleshooting

### Manifest parse error

Symptom: AgentWeaver reports that it failed to parse `plugin.json`.

Checks:

- ensure `plugin.json` is valid JSON
- ensure the top-level value is a JSON object

### Plugin directory does not match manifest id

Symptom: the loader reports that the manifest id does not match the installation directory.

Fix:

- rename the directory or change `plugin.json.id` so both values match exactly

### Unsupported `sdk_version`

Symptom: the loader reports that the plugin declares one SDK version but AgentWeaver supports another.

Fix:

- change `sdk_version` to the exact supported major
- review compatibility before trusting the plugin after the upgrade

### Invalid entrypoint path

Symptom: the loader reports that the entrypoint resolves outside the plugin root.

Fix:

- point `entrypoint` to a file inside `.agentweaver/.plugins/<plugin-id>/`

### Unsupported module format

Symptom: the loader rejects `.cjs` or another unsupported file extension.

Fix:

- use ESM `.js` or `.mjs`

### Default export misuse

Symptom: the loader reports that default exports are not supported.

Fix:

- export named `executors` and/or `nodes` arrays only

### Empty or missing registration arrays

Symptom: the loader reports that the plugin must export at least one non-empty recognized registration array.

Fix:

- export `executors`, `nodes`, or both
- make sure at least one of them contains a registration

### Invalid executor registration

Checks:

- `definition.kind` matches `id`
- `definition.version` is a positive integer
- `definition.defaultConfig` is JSON-serializable
- `definition.execute` is a function

### Invalid node registration

Checks:

- `definition.kind` matches `id`
- `metadata.kind` matches `id`
- `definition.version` matches `metadata.version`
- `metadata.prompt` is `required`, `allowed`, or `forbidden`
- `metadata.executors` references valid executor ids

### Duplicate ids

Symptom: registry creation fails because a node or executor id already exists.

Fix:

- rename the plugin-provided id
- avoid built-in ids and ids used by other local plugins

### Unresolved executor dependencies

Symptom: a node declares `metadata.executors` and registry creation reports an unknown executor.

Fix:

- export the executor from the same plugin or another loaded plugin
- confirm the executor id matches exactly

### Missing or ambiguous nested flow reference

Symptom: flow validation fails with an unknown or ambiguous nested flow name.

Fix:

- ensure the referenced file exists
- avoid duplicate base file names across global, project-local, and built-in flows
- keep global and project-local nested flow file names unique

## Supported Boundary Summary

Treat these as stable public assumptions for plugin authoring:

- import only from `agentweaver/plugin-sdk`
- install local plugins under `~/.agentweaver/.plugins/<plugin-id>/plugin.json` or `.agentweaver/.plugins/<plugin-id>/plugin.json`
- export named `executors` and/or `nodes` arrays from an ESM `.js` or `.mjs` entrypoint
- reference plugin node ids from `~/.agentweaver/.flows/**/*.json` or `.agentweaver/.flows/**/*.json`
- keep plugin ids, node ids, executor ids, and nested flow file names unambiguous

Everything else should be treated as internal implementation detail unless it is exposed through the public SDK subpath in a future release.
