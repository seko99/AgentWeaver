# Project playbook

Draft playbook rules were generated from structured repository inventory, practice candidates, clarification questions, and recorded answers. High-confidence practices were accepted directly, and medium-confidence practices were accepted only where the recorded answers resolved the ambiguity.

## Required rules

- Use npm scripts as supported workflow entrypoints: Run project build, type-check, development, packaging, and start workflows through the npm scripts declared in package.json.
  Evidence: package.json, tsconfig.json
- Use the declared check script for TypeScript validation: Before delivering changes that affect TypeScript source or tests, run the declared npm check script unless the task context makes that impossible.
  Evidence: package.json, tsconfig.json
- Place automated tests under the top-level tests directory: Add or update automated tests under the top-level tests directory, using existing nested areas such as tests/doctor, tests/pipeline, tests/pipeline/nodes, or tests/runtime when they fit the changed behavior.
  Evidence: tests, tests/doctor, tests/pipeline, tests/pipeline/nodes, tests/runtime, tests/artifact-registry.test.mjs, tests/auto-common-flow.test.ts, tests/pipeline/nodes/ensure-summary-json-node.test.mjs, tests/runtime/ready-to-merge.test.mjs
- Keep executor runtime defaults in src/executors/configs: Add new executor runtime configuration modules under src/executors/configs when introducing comparable executor defaults.
  Evidence: src/executors/configs/codex-config.ts, src/executors/configs/fetch-gitlab-diff-config.ts, src/executors/configs/fetch-gitlab-review-config.ts, src/executors/configs/jira-fetch-config.ts, src/executors/configs/opencode-config.ts, src/executors/configs/process-config.ts, src/executors/configs/telegram-notifier-config.ts
- Treat .agentweaver/.env as local runtime configuration: Treat .agentweaver/.env only as a local runtime file and exclude it from committed practice guidance. No required environment variables are established by the recorded answers.
  Evidence: .agentweaver/.env, .env.example
- Keep repository maintenance scripts under scripts: Place repository maintenance automation under the top-level scripts directory when adding comparable automation, and use the .mjs module format for future repository maintenance scripts.
  Evidence: scripts/copy-flow-specs.mjs
