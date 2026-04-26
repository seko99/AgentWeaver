# Changelog

## v0.1.18

Release range: `v0.1.17...v0.1.18`

### Highlights

- Added a Web UI for the interactive operator workflow through `agentweaver web`.
- Added project playbooks and guided project guidance for repository-specific agent context.
- Added the new `auto-common-guided` flow, which injects compact playbook guidance into planning, design review, implementation, review, and repair phases.
- Added `playbook-init` to generate and write a manifest-based project playbook.
- Added automatic scope switching for interactive and web sessions when the current git branch changes.

### Web UI

- Added `agentweaver web [--no-open] [--host <host>|--listen-all] [<jira>]`.
- The Web UI binds to `127.0.0.1` by default, uses an OS-assigned random port, and prints the final URL.
- Added browser auto-open support, with `--no-open` and `AGENTWEAVER_WEB_NO_OPEN=1` for CI and smoke checks.
- Added WebSocket-based live interaction for flow selection, launch confirmations, user-input forms, progress, logs, help, and interruption.
- Added health and shutdown endpoints: `GET /__agentweaver/health` and `POST /__agentweaver/exit`.

### Security

- External Web UI binding now requires HTTP Basic auth.
- `--listen-all`, `--host 0.0.0.0`, `--host ::`, non-loopback IPs, and non-localhost hostnames require both `AGENTWEAVER_WEB_USERNAME` and `AGENTWEAVER_WEB_PASSWORD`.
- Localhost bindings remain no-auth by default unless credentials are configured.
- Web UI docs now clarify that Basic auth over plain HTTP should only be used on trusted networks or behind TLS termination.

### Project Playbook and Guided Flows

- Added `.agentweaver/playbook/` support with `manifest.yaml`, project context, practices, examples, and templates.
- Added deterministic repository inventory and playbook generation nodes.
- Added playbook validation for manifest format, paths, phases, severities, duplicate ids, and relationship references.
- Added structured playbook artifacts, including repository inventory, practice candidates, playbook questions, answers, draft, and write result.
- Added project guidance artifacts for `plan`, `design-review`, `implement`, `review`, and `repair/review-fix`.
- Added `--accept-playbook-draft` for non-interactive playbook initialization and guided flow startup when a manifest is missing.

### Workflow Changes

- Added `auto-common-guided --help-phases`.
- Updated planning, design-review, implementation, review, and review-fix prompts to accept optional project guidance files.
- Added project guidance wiring to `auto-common-guided` before each guided LLM phase.
- Added web and interactive controller actions that can be shared by Ink and browser sessions.
- Improved interactive session cleanup and interruption handling.
- Interactive and web sessions now refresh branch-derived scope before launch confirmation, before flow launch, and after active flows complete.

### Documentation

- Expanded the README with Web UI usage, auth requirements, guided project guidance, playbook initialization, and updated smoke checks.
- Added `docs/features.md` with a high-level feature overview.
- Added `docs/playbook.md` with the playbook format, rule maintenance guidance, validation behavior, and guided execution notes.
- Moved the flow-spec reference from `FLOW-SPECS.md` to `docs/declarative-workflows.md`.

### Build and Packaging

- Added Tailwind CSS build steps for Web UI styles:
  - `npm run build:web-css`
  - `npm run dev:web-css`
- Updated `npm run build` to build Web UI CSS before TypeScript compilation and flow-spec copying.
- Added the `yaml` runtime dependency for playbook manifest and frontmatter parsing.

### Tests

- Added coverage for Web UI CLI behavior, server behavior, protocol parsing, and web interactive sessions.
- Added coverage for playbook runtime validation, inventory, prompts, write behavior, and `playbook-init`.
- Added coverage for project guidance generation and guided `auto-common` flow behavior.
- Extended interactive controller and state tests for Web UI-compatible actions and scope behavior.
