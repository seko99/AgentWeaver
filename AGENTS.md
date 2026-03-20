# Repository Guidelines

## Project Structure & Module Organization
`agentweaver.py` is the main entrypoint and contains the CLI, orchestration logic, Jira access, and interactive shell. Container runtime files live at the repository root: `docker-compose.yml` defines services, `Dockerfile.codex` builds the Codex image, and `verify_build.sh` is the build-verification hook used by the Docker workflow. Python dependencies are pinned in `requirements.txt`. There is no `src/` or `tests/` directory yet; if you add modules or tests, keep them in top-level packages with clear names such as `tests/test_cli.py`.

## Build, Test, and Development Commands
Create a local environment and install dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Useful commands:

```bash
./agentweaver.py --help              # show CLI usage
./agentweaver.py plan DEMO-1234      # run one workflow stage
./agentweaver.py auto DEMO-1234      # run the full pipeline
python3 -m py_compile agentweaver.py # quick syntax check
docker compose run --rm codex-exec   # execute Codex inside the container
```

## Coding Style & Naming Conventions
Follow Python 3 conventions: 4-space indentation, snake_case for functions and variables, CapWords for dataclasses, and UPPER_CASE for module-level constants. Preserve the current typed style (`str | None`, dataclasses, small helper functions) and keep imports grouped as standard library first, third-party second. Prefer focused functions over large inline blocks when extending command handlers.

## Testing Guidelines
No committed automated test suite exists yet, so every change should include at least a syntax check and one CLI smoke test. Prefer adding `pytest` tests under `tests/` for new behavior, with names like `test_parse_cli_args.py` or `test_auto_pipeline_state.py`. When changing Docker execution paths, also validate the relevant `docker compose run --rm ...` flow.

## Commit & Pull Request Guidelines
Git history currently contains only `init`, so adopt a clearer convention going forward: use short imperative subjects such as `Add auto pipeline state validation`. Keep commits scoped to one concern. Pull requests should include the user-visible workflow affected, required environment variables, manual verification steps, and terminal output snippets when behavior changes.

## Configuration & Secrets
Do not commit Jira tokens, `.env`, or Codex home data. Keep local secrets in untracked environment files, and document any new required variables in `README.md` and the PR description.
