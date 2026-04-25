---
id: "practice.documentation-language"
title: "Write repository documentation in English"
phases:
  - "plan"
  - "design_review"
  - "implement"
  - "review"
  - "repair"
applies_to:
  globs:
    - "README.md"
    - "AGENTS.md"
    - "CLAUDE.md"
    - "docs/**/*.md"
    - ".agentweaver/playbook/**/*.md"
  keywords:
    - "documentation"
    - "docs"
    - "readme"
    - "playbook"
    - "markdown"
priority: 20
severity: "must"
related_practices: []
related_examples: []
---

Write all repository documentation in English. This applies to `README.md`, `AGENTS.md`, `CLAUDE.md`, files under `docs/`, and committed playbook markdown under `.agentweaver/playbook/`.

Generated machine-readable JSON artifacts must also use English for semantic string values unless they intentionally preserve verbatim user-provided or external source text. Runtime UI strings may support localization, but committed documentation should remain English by default.
