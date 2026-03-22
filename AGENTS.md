# Repository Guidelines

## Project Structure & Module Organization
`src/index.ts` is the main entrypoint and contains CLI orchestration. Interactive terminal UI lives in `src/interactive-ui.ts`, markdown rendering in `src/markdown.ts`, and supporting modules such as Jira/prompt/artifact helpers live alongside them in `src/`. Container runtime files live at the repository root: `docker-compose.yml` defines services, `Dockerfile.codex` builds the Codex image, and `verify_build.sh` is the build-verification hook used by the Docker workflow. Build output goes to `dist/`. If you add tests, place them under a clear top-level directory such as `tests/`.

## Build, Test, and Development Commands
Install dependencies and build:

```bash
npm install
npm run build
```

Useful commands:

```bash
node dist/index.js --help            # show CLI usage
node dist/index.js plan DEMO-1234    # run one workflow stage
node dist/index.js auto DEMO-1234    # run the full pipeline
npm run check                        # TypeScript type-check
npm run pack:check                   # inspect npm publish tarball
docker compose run --rm codex-exec   # execute Codex inside the container
```

## Coding Style & Naming Conventions
Follow TypeScript/Node conventions: 2-space or existing-file indentation consistency, `camelCase` for functions and variables, `PascalCase` for classes/types, and `UPPER_CASE` for module-level constants. Keep imports grouped and prefer focused modules over large inline blocks when extending command handlers or TUI components.

## Language For Artifacts
Design docs, implementation plans, architecture notes, and similar project artifacts created in the repository must be written in Russian by default, unless the user explicitly asks for another language.

## Testing Guidelines
No committed automated test suite exists yet, so every change should include at least `npm run check` and one CLI smoke test. Prefer adding tests under `tests/` for new behavior. When changing Docker execution paths, also validate the relevant `docker compose run --rm ...` flow.

## Commit & Pull Request Guidelines
Git history currently contains only `init`, so adopt a clearer convention going forward: use short imperative subjects such as `Add auto pipeline state validation`. Keep commits scoped to one concern. Pull requests should include the user-visible workflow affected, required environment variables, manual verification steps, and terminal output snippets when behavior changes.

## Configuration & Secrets
Do not commit Jira tokens, `.env`, npm auth tokens, or Codex home data. Keep local secrets in untracked environment files, and document any new required variables in `README.md` and the PR description.
