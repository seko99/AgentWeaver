# Project Playbook

The project playbook lives inside the project and describes stable practices, examples, and templates that AgentWeaver can validate and later use while assembling context.

## Structure

Minimum structure:

```text
.agentweaver/playbook/
  manifest.yaml
  project.md
  practices/
    typescript-runtime.md
  examples/
    validation-boundary.md
  templates/
    implementation-note.md
```

`manifest.yaml` is the root file for format version 1. All paths in it are relative to `.agentweaver/playbook/` and cannot escape that directory.

## manifest.yaml

Minimum example:

```yaml
version: 1
project:
  name: AgentWeaver
  stack: [node]
  languages: [typescript]
  frameworks: [node]
context_budgets:
  plan: 1200
  design_review: 1200
  implement: 2400
  review: 1200
  repair: 1200
practices:
  globs: ["practices/*.md"]
examples:
  globs: ["examples/*.md"]
templates:
  paths: ["templates/implementation-note.md"]
always_include: ["project.md"]
selection:
  include_examples: true
  max_examples: 3
```

Supported phases for `context_budgets` and frontmatter:

- `plan`
- `design_review`
- `implement`
- `review`
- `repair`

`practices`, `examples`, and `templates` support `paths` and `globs` sections. `always_include` contains files that must exist and are usually used as the base project context.

`selection.include_examples` is a boolean. `selection.max_examples` is a non-negative integer.

## project.md

`project.md` contains concise human-readable project context: purpose, main constraints, architectural conventions, and important commands. This file is validated as an existing markdown file and can be included in context through `always_include`.

## Practices

Files under `practices/*.md` must start with YAML frontmatter:

```markdown
---
id: practice.runtime-validation
title: Runtime boundary validation
phases: [implement, review]
applies_to:
  languages: [typescript]
  frameworks: [node]
  globs: ["src/runtime/**/*.ts"]
  keywords: [validation, parsing]
priority: 10
severity: must
related_examples: [example.playbook-validation]
---

Validate user-authored structured files at the runtime boundary. Error messages should name the file, the field path, and the fix.
```

Required fields:

- `id`: unique identifier for the practice or example
- `title`: human-readable title

Optional fields:

- `phases`: array of supported phases
- `applies_to.languages`: array of languages
- `applies_to.frameworks`: array of frameworks
- `applies_to.globs`: array of glob patterns
- `applies_to.keywords`: array of keywords
- `priority`: non-negative integer
- `severity`: one of `must`, `should`, or `info`
- `related_practices`: array of existing ids
- `related_examples`: array of existing ids

Identifiers must be unique across practices and examples. References in `related_practices` and `related_examples` must point to existing ids.

## Examples

Files under `examples/*.md` use the same frontmatter contract as practices:

```markdown
---
id: example.playbook-validation
title: Playbook validation example
phases: [implement]
severity: should
related_practices: [practice.runtime-validation]
---

Keep long examples in separate files and reference them by path instead of copying them into every prompt.
```

Long examples should be stored as separate files in `examples/` or `templates/`. This keeps the playbook portable and avoids forcing every prompt to include unnecessary text.

## Validation Errors

The validator must fail explicitly in these cases:

- `.agentweaver/playbook/manifest.yaml` is missing
- YAML in the manifest or frontmatter is syntactically invalid
- `version` is not `1`
- a required file from `paths`, `globs`, `always_include`, or `project.md` is missing
- a path is absolute or escapes `.agentweaver/playbook/`
- a phase is not in the supported list
- `severity` is not `must`, `should`, or `info`
- ids are duplicated
- a relationship reference points to an unknown id
