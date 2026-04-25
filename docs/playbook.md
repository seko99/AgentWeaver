# Project playbook

The project playbook lives inside the repository and describes stable practices, examples, and templates that AgentWeaver validates and uses when building compact project guidance.

If the repository ignores runtime AgentWeaver state, keep `.agentweaver/playbook/` explicitly tracked. A typical `.gitignore` setup ignores other project-local AgentWeaver files while allowing the playbook:

```gitignore
.agentweaver/*
!.agentweaver/playbook/
!.agentweaver/playbook/**
```

## Structure

Minimal structure:

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

`manifest.yaml` is the root file for playbook format version 1. All paths in the manifest are relative to `.agentweaver/playbook/` and must not escape that directory.

## manifest.yaml

Minimal example:

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

Supported phases for `context_budgets` and markdown frontmatter:

- `plan`
- `design_review`
- `implement`
- `review`
- `repair`

`practices`, `examples`, and `templates` support `paths` and `globs` sections. `always_include` contains files that must exist and are usually used as baseline project context.

`selection.include_examples` is a boolean. `selection.max_examples` is a non-negative integer.

## project.md

`project.md` contains concise human-readable project context: purpose, key constraints, architecture agreements, and important commands. The file is validated as existing markdown and can be included in guidance through `always_include`.

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

- `id`: unique identifier for a practice or example
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

Long examples should live in separate files under `examples/` or `templates/`. This keeps the playbook portable and prevents prompts from receiving unnecessary text unless the example is directly relevant.

## Rule maintenance and versioning

The playbook is maintained as repository content. Treat every practice, example, and template as reviewed source material: changes should be made through normal Git history, reviewed in pull requests, and validated before they are used by guided workflows.

### Adding a new rule

Add a new rule when the project has a stable practice that should influence future planning, implementation, review, or repair work. A rule should describe a repeatable engineering expectation, not a one-off task decision.

Recommended process:

1. Create a new markdown file under `.agentweaver/playbook/practices/`.
2. Give the rule a stable, unique `id` using the `practice.<domain-or-topic>` pattern.
3. Add a concise `title`, relevant `phases`, `applies_to` selectors, `priority`, and `severity`.
4. Write the body as direct guidance. Prefer concrete expectations, constraints, and examples of what good output should do.
5. Add `related_examples` when there is a concrete example file that demonstrates the rule.
6. Ensure the file is included by `manifest.yaml`, either through `practices.globs` or an explicit `practices.paths` entry.
7. Run validation or a guided smoke check before merging.

Example:

```markdown
---
id: practice.api-error-contracts
title: API error contracts
phases: [implement, review]
applies_to:
  languages: [typescript]
  globs: ["src/**/*.ts"]
  keywords: [api, error, validation]
priority: 10
severity: must
related_examples: [example.api-error-contracts]
---

Return typed API errors at runtime boundaries. Error responses should preserve a stable machine-readable code and include enough context for the caller to recover.
```

Use `severity` deliberately:

- `must`: required project rule; violations should be treated as defects.
- `should`: preferred practice; deviations are allowed when the task gives a clear reason.
- `info`: contextual guidance; useful for planning or orientation but not a strict requirement.

Use `priority` to resolve attention when many rules match the same task. Higher-priority rules are stronger candidates for compact guidance, but priority should not be used to compensate for vague selectors.

### Updating an existing rule

Update an existing rule when the underlying practice is still the same but the wording, scope, examples, or applicability need to become clearer.

Keep the existing `id` when:

- the rule describes the same engineering expectation;
- existing `related_practices` or `related_examples` links should continue to mean the same thing;
- previous references in reviews, pull requests, or generated guidance should remain understandable.

Safe updates include:

- clarifying the body text;
- adding or removing `keywords`;
- narrowing or broadening `applies_to.globs`;
- adding a related example;
- changing `severity` after team agreement;
- adjusting `priority` when guidance selection is too noisy or too weak.

Do not silently change a rule into a different rule while keeping the old `id`. If the new guidance would surprise someone who followed the previous rule, treat it as a breaking change.

### Breaking changes

A playbook rule change is breaking when it changes the expected behavior of future agent work in a way that can invalidate earlier assumptions.

Examples of breaking changes:

- changing a recommendation from `should` to `must`;
- replacing the meaning of a `practice.*` id;
- broadening `applies_to.globs` so the rule affects a new major part of the codebase;
- removing an exception that existing modules relied on;
- deleting a rule that other rules or examples reference.

For breaking changes:

1. Prefer creating a new `id` when the meaning changes substantially.
2. Update or remove all `related_practices` and `related_examples` references.
3. Mention the migration path in the pull request.
4. Keep the change scoped to the affected rule files and examples.
5. Run a guided smoke check for at least one affected phase.

If a rule is replaced, keep the old rule temporarily only when it is still useful for compatibility. Lower its `severity` or narrow its `applies_to` selectors instead of leaving conflicting guidance active.

### Removing a rule

Remove a rule only when it is obsolete, misleading, duplicated by a better rule, or no longer matches the project architecture.

Removal process:

1. Search for the rule `id` across `.agentweaver/playbook/`.
2. Remove or update all `related_practices` and `related_examples` references.
3. Remove the file from `practices.paths` if the manifest lists files explicitly.
4. If the manifest uses `practices.globs`, deleting the file is enough, but the remaining glob must still match at least one file.
5. Run validation or a guided smoke check.
6. Explain in the pull request why the rule is obsolete and what replaces it, if anything.

### Examples and templates

Examples should stay path-addressable and focused. Add a new example when a rule benefits from a concrete implementation pattern, review finding, prompt fragment, or expected artifact shape.

Keep examples separate from rule bodies when they are long. The guidance builder can inline compact entries, but long examples should remain referenced by file path so prompts do not receive unnecessary text.

Templates should describe reusable artifact shapes or prompt fragments. Update templates with the same compatibility discipline as rules: preserve the path when the template has the same purpose, and create a new file when the template represents a different contract.

### Versioning policy

`manifest.yaml` contains `version: 1`, but this is the playbook format version, not the version of the project rules. Do not increment it when adding, editing, or removing practices, examples, or templates. The runtime currently accepts only format version `1`; changing it to another value makes the playbook invalid.

Rule content is versioned through Git:

- each playbook change should be committed like normal source code;
- pull requests should describe the user-visible workflow impact;
- breaking rule changes should be called out explicitly;
- related code, tests, examples, and templates should be updated in the same change when they depend on the rule;
- generated or external evidence should be referenced, not copied into machine-readable artifacts unless it is intentionally stored as source text.

Use commit subjects that describe the playbook behavior change, for example:

```text
Add API error contract playbook rule
Clarify runtime validation guidance
Retire obsolete Docker workflow rule
```

If the project needs a human-readable playbook release history, add a normal markdown changelog such as `.agentweaver/playbook/CHANGELOG.md`. This changelog is optional repository documentation; it is not part of the runtime playbook contract unless it is also referenced from `manifest.yaml`.

### Review checklist

Before merging a playbook change, check:

- every practice and example has a unique `id`;
- every `related_practices` and `related_examples` entry points to an existing id;
- all paths are relative to `.agentweaver/playbook/`;
- `manifest.yaml` still uses `version: 1`;
- all `phases` and `severity` values are supported;
- selectors are specific enough to avoid unrelated guidance;
- long examples are stored as files instead of copied into multiple rule bodies;
- the change has been validated with `npm run check` and at least one relevant CLI smoke test when possible.

## Generation and execution

Create or update the playbook with:

```bash
agentweaver playbook-init
```

Use this command to accept the generated layout non-interactively:

```bash
agentweaver playbook-init --accept-playbook-draft
```

The guided workflow uses the playbook through:

```bash
agentweaver auto-common-guided --help-phases
agentweaver auto-common-guided DEMO-1234
agentweaver auto-common-guided --accept-playbook-draft DEMO-1234
```

`--accept-playbook-draft` in `auto-common-guided` is used for the missing-manifest scenario: the workflow explicitly accepts generated manifest-based playbook content before planning. Without this flag, a missing manifest stops the non-interactive guided run before the LLM prompt.

## Validation errors

The validator must fail clearly in these cases:

- `.agentweaver/playbook/manifest.yaml` is missing
- YAML in the manifest or frontmatter is syntactically invalid
- `version` is not `1`
- a required file from `paths`, `globs`, `always_include`, or `project.md` is missing
- a path is absolute or escapes `.agentweaver/playbook/`
- a phase is not in the supported phase list
- `severity` is not `must`, `should`, or `info`
- ids are duplicated
- a relationship reference points to an unknown id

## Compact project guidance

`auto-common-guided` uses only `.agentweaver/playbook/manifest.yaml` as the canonical source of project rules. Old `.agentweaver/playbook/playbook.json` and `.agentweaver/playbook/playbook.md` files are not used as semantic fallbacks.

Before the `plan`, `design-review`, `implement`, `review`, and `repair/review-fix` phases, the workflow writes structured `project-guidance/v1` JSON and derived markdown. Canonical artifact names are `project-guidance-plan`, `project-guidance-design-review`, `project-guidance-implement`, `project-guidance-review`, and `project-guidance-repair-review-fix`.

Guidance selection considers the phase, `always_include`, `priority`, `severity`, keywords, glob paths, languages, and frameworks from task context. Budgets are approximate: `plan` 1200, `design-review` 1000, `implement` 1400, `review` 1000, and `repair/review-fix` 1000 tokens. The default inline-entry threshold is 300 approximate tokens. Long examples remain file references instead of being copied into prompts.

If `manifest.yaml` is missing, the runtime can create an explicit `missing_playbook` artifact where that mode is allowed. In `auto-common-guided`, a missing manifest stops the non-interactive workflow before planning by default unless the user passes `--accept-playbook-draft`. If the manifest is invalid, the standard `fail_before_prompt` policy stops execution before the LLM prompt; `invalid_playbook` is intended only for explicit diagnostic mode.

Project guidance is additional context. It does not replace task context, design, plan, QA, design-review, or review JSON, which remain the sources of truth. There is no skills integration yet; the playbook generator must remain evidence-backed. Guided prompts receive compact context, and full examples are opened only when they are directly relevant to the current phase.
