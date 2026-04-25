# Project playbook

Draft playbook rules were generated from repository inventory, practice candidates, clarification questions, and recorded answers. High-confidence practices were accepted directly, and medium-confidence practices were accepted only where the recorded answers resolved their clarification needs.

## Required rules

- Use npm scripts as the supported project entrypoints: Run project build, type-check, development, packaging, and start workflows through the npm scripts declared in package.json.
  Evidence: package.json, tsconfig.json
- Use the declared check script for TypeScript validation: Before delivering changes that affect TypeScript source or tests, run the declared npm check script unless the task context makes that impossible.
  Evidence: package.json, tsconfig.json
- Place automated tests under the tests directory: Add or update automated tests under the top-level tests directory, following the existing nested areas when they fit the changed behavior.
  Evidence: tests, tests/doctor, tests/pipeline, tests/pipeline/nodes, tests/runtime, tests/artifact-manifest-schema.test.mjs, tests/auto-common-flow.test.ts, tests/pipeline/nodes/ensure-summary-json-node.test.mjs, tests/runtime/ready-to-merge.test.mjs
- Keep executor runtime defaults in src/executors/configs: Add new executor runtime configuration modules under src/executors/configs when introducing comparable executor defaults.
  Evidence: src/executors/configs/codex-config.ts, src/executors/configs/fetch-gitlab-diff-config.ts, src/executors/configs/fetch-gitlab-review-config.ts, src/executors/configs/jira-fetch-config.ts, src/executors/configs/opencode-config.ts, src/executors/configs/process-config.ts, src/executors/configs/telegram-notifier-config.ts
- Keep environment examples limited to required variables: When required environment variables or runtime environment expectations change, update .env.example for those requirements. Treat .agentweaver/.env as a local runtime file that is excluded from committed practice guidance except as evidence that local configuration exists.
  Evidence: .env.example, .agentweaver/.env
- Keep repository maintenance scripts under scripts: Place repository maintenance automation under the top-level scripts directory when adding automation comparable to the existing maintenance script. No repository-wide .mjs module-format or naming-style requirement is established by the recorded answers.
  Evidence: scripts/copy-flow-specs.mjs
