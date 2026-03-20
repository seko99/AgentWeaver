#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import asdict, dataclass, field, replace
from pathlib import Path

from awlib.artifacts import (
    READY_TO_MERGE_FILE,
    REVIEW_FILE_RE,
    REVIEW_REPLY_FILE_RE,
    artifact_file,
    design_file,
    plan_artifacts,
    plan_file,
    qa_file,
    require_artifacts,
    task_summary_file,
)
from awlib.errors import TaskRunnerError
from awlib.jira import (
    build_jira_api_url,
    build_jira_browse_url,
    extract_issue_key,
    fetch_jira_issue,
    require_jira_task_file,
)
from awlib.prompts import (
    AUTO_REVIEW_FIX_EXTRA_PROMPT,
    IMPLEMENT_PROMPT_TEMPLATE,
    PLAN_PROMPT_TEMPLATE,
    REVIEW_FIX_PROMPT_TEMPLATE,
    REVIEW_PROMPT_TEMPLATE,
    REVIEW_REPLY_PROMPT_TEMPLATE,
    REVIEW_REPLY_SUMMARY_PROMPT_TEMPLATE,
    REVIEW_SUMMARY_PROMPT_TEMPLATE,
    TASK_SUMMARY_PROMPT_TEMPLATE,
    TEST_FIX_PROMPT_TEMPLATE,
    TEST_LINTER_FIX_PROMPT_TEMPLATE,
    format_prompt,
)

try:
    from prompt_toolkit import PromptSession
    from prompt_toolkit.completion import WordCompleter
    from prompt_toolkit.history import FileHistory
    from prompt_toolkit.key_binding import KeyBindings
    from prompt_toolkit.styles import Style
    from rich.console import Console
    from rich.panel import Panel
except ImportError as exc:
    print(
        "Missing Python dependencies. Activate the virtualenv with "
        "'source ~/venvs/do-test/bin/activate' and install requirements.txt.",
        file=sys.stderr,
    )
    raise SystemExit(1) from exc


COMMANDS = (
    "plan",
    "implement",
    "review",
    "review-fix",
    "test",
    "test-fix",
    "test-linter-fix",
    "auto",
    "auto-status",
    "auto-reset",
)
DEFAULT_CODEX_MODEL = "gpt-5.4"
DEFAULT_CLAUDE_REVIEW_MODEL = "opus"
DEFAULT_CLAUDE_SUMMARY_MODEL = "haiku"
HISTORY_FILE = Path("/home/seko/.codex/memories/agentweaver-history")
AUTO_STATE_SCHEMA_VERSION = 1
AUTO_MAX_REVIEW_ITERATIONS = 3
console = Console()
error_console = Console(stderr=True)


@dataclass
class Config:
    command: str
    jira_ref: str
    review_fix_points: str | None
    extra_prompt: str | None
    auto_from_phase: str | None
    dry_run: bool
    verbose: bool
    docker_compose_file: str
    docker_compose_cmd: list[str]
    codex_cmd: str
    claude_cmd: str
    jira_issue_key: str
    task_key: str
    jira_browse_url: str
    jira_api_url: str
    jira_task_file: str


@dataclass
class AutoStepState:
    id: str
    command: str
    status: str = "pending"
    review_iteration: int | None = None
    started_at: str | None = None
    finished_at: str | None = None
    return_code: int | None = None
    note: str | None = None


@dataclass
class AutoPipelineState:
    schema_version: int
    issue_key: str
    jira_ref: str
    status: str
    current_step: str | None
    max_review_iterations: int
    updated_at: str
    last_error: dict[str, str | int | None] | None = None
    steps: list[AutoStepState] = field(default_factory=list)


def artifact_file(prefix: str, task_key: str, iteration: int) -> str:
    return f"{prefix}-{task_key}-{iteration}.md"


def auto_state_file(task_key: str) -> Path:
    return Path(f".agentweaver-state-{task_key}.json")


def now_iso8601() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime())


def build_auto_steps(max_review_iterations: int = AUTO_MAX_REVIEW_ITERATIONS) -> list[AutoStepState]:
    steps = [
        AutoStepState(id="plan", command="plan"),
        AutoStepState(id="implement", command="implement"),
        AutoStepState(id="test_after_implement", command="test"),
    ]
    for iteration in range(1, max_review_iterations + 1):
        steps.extend(
            [
                AutoStepState(id=f"review_{iteration}", command="review", review_iteration=iteration),
                AutoStepState(id=f"review_fix_{iteration}", command="review-fix", review_iteration=iteration),
                AutoStepState(
                    id=f"test_after_review_fix_{iteration}",
                    command="test",
                    review_iteration=iteration,
                ),
            ]
        )
    return steps


def auto_phase_ids(max_review_iterations: int = AUTO_MAX_REVIEW_ITERATIONS) -> list[str]:
    return [step.id for step in build_auto_steps(max_review_iterations)]


def normalize_auto_phase_id(phase_id: str) -> str:
    return phase_id.strip().lower().replace("-", "_")


def validate_auto_phase_id(phase_id: str) -> str:
    normalized = normalize_auto_phase_id(phase_id)
    if normalized not in set(auto_phase_ids()):
        raise TaskRunnerError(
            "Unknown auto phase: "
            f"{phase_id}\nUse 'auto --help-phases' or '/help auto' to list valid phases."
        )
    return normalized


def create_auto_pipeline_state(config: Config) -> AutoPipelineState:
    return AutoPipelineState(
        schema_version=AUTO_STATE_SCHEMA_VERSION,
        issue_key=config.task_key,
        jira_ref=config.jira_ref,
        status="pending",
        current_step=None,
        max_review_iterations=AUTO_MAX_REVIEW_ITERATIONS,
        updated_at=now_iso8601(),
        steps=build_auto_steps(),
    )


def auto_step_from_dict(data: dict[str, object]) -> AutoStepState:
    return AutoStepState(
        id=str(data["id"]),
        command=str(data["command"]),
        status=str(data.get("status", "pending")),
        review_iteration=int(data["review_iteration"]) if data.get("review_iteration") is not None else None,
        started_at=str(data["started_at"]) if data.get("started_at") is not None else None,
        finished_at=str(data["finished_at"]) if data.get("finished_at") is not None else None,
        return_code=int(data["return_code"]) if data.get("return_code") is not None else None,
        note=str(data["note"]) if data.get("note") is not None else None,
    )


def auto_pipeline_from_dict(data: dict[str, object]) -> AutoPipelineState:
    return AutoPipelineState(
        schema_version=int(data.get("schema_version", 0)),
        issue_key=str(data["issue_key"]),
        jira_ref=str(data["jira_ref"]),
        status=str(data["status"]),
        current_step=str(data["current_step"]) if data.get("current_step") is not None else None,
        max_review_iterations=int(data.get("max_review_iterations", AUTO_MAX_REVIEW_ITERATIONS)),
        updated_at=str(data.get("updated_at", "")),
        last_error=data.get("last_error") if isinstance(data.get("last_error"), dict) else None,
        steps=[auto_step_from_dict(item) for item in data.get("steps", [])],
    )


def load_auto_pipeline_state(config: Config) -> AutoPipelineState | None:
    state_path = auto_state_file(config.task_key)
    if not state_path.is_file():
        return None

    try:
        raw = json.loads(state_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise TaskRunnerError(f"Failed to parse auto state file {state_path}: {exc}") from exc

    if not isinstance(raw, dict):
        raise TaskRunnerError(f"Invalid auto state file format: {state_path}")

    state = auto_pipeline_from_dict(raw)
    if state.schema_version != AUTO_STATE_SCHEMA_VERSION:
        raise TaskRunnerError(
            f"Unsupported auto state schema in {state_path}: {state.schema_version}"
        )
    return state


def save_auto_pipeline_state(state: AutoPipelineState) -> None:
    state.updated_at = now_iso8601()
    auto_state_file(state.issue_key).write_text(
        json.dumps(asdict(state), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def reset_auto_pipeline_state(config: Config) -> bool:
    state_path = auto_state_file(config.task_key)
    if not state_path.exists():
        return False
    state_path.unlink()
    return True


def auto_step_by_id(state: AutoPipelineState, step_id: str) -> AutoStepState:
    for step in state.steps:
        if step.id == step_id:
            return step
    raise TaskRunnerError(f"Auto pipeline step not found: {step_id}")


def next_auto_step(state: AutoPipelineState) -> AutoStepState | None:
    for step in state.steps:
        if step.status in {"running", "failed", "pending"}:
            return step
    return None


def mark_auto_step_skipped(step: AutoStepState, note: str) -> None:
    step.status = "skipped"
    step.note = note
    step.finished_at = now_iso8601()


def skip_auto_steps_after_ready_to_merge(state: AutoPipelineState, current_step_id: str) -> None:
    seen_current = False
    for step in state.steps:
        if not seen_current:
            seen_current = step.id == current_step_id
            continue
        if step.status == "pending":
            mark_auto_step_skipped(step, "ready-to-merge detected")


def print_auto_state(state: AutoPipelineState) -> None:
    lines = [
        f"Issue: {state.issue_key}",
        f"Status: {state.status}",
        f"Current step: {state.current_step or '-'}",
        f"Updated: {state.updated_at}",
    ]
    if state.last_error:
        lines.append(
            "Last error: "
            f"{state.last_error.get('step')} "
            f"(exit {state.last_error.get('return_code')}, {state.last_error.get('message')})"
        )
    lines.append("")
    for step in state.steps:
        suffix = f" ({step.note})" if step.note else ""
        lines.append(f"[{step.status}] {step.id}{suffix}")

    console.print(Panel("\n".join(lines), title="Auto Status", border_style="cyan"))


def print_auto_phases_help() -> None:
    phase_lines = [
        "Available auto phases:",
        "",
        "plan",
        "implement",
        "test_after_implement",
    ]
    for iteration in range(1, AUTO_MAX_REVIEW_ITERATIONS + 1):
        phase_lines.extend(
            [
                f"review_{iteration}",
                f"review_fix_{iteration}",
                f"test_after_review_fix_{iteration}",
            ]
        )
    phase_lines.extend(
        [
            "",
            "You can resume auto from a phase with:",
            "./agentweaver.py auto --from <phase> <jira>",
            "or in interactive mode:",
            "/auto --from <phase>",
        ]
    )
    console.print(Panel("\n".join(phase_lines), title="Auto Phases", border_style="magenta"))


def load_env_file(env_file: Path) -> None:
    if not env_file.is_file():
        return

    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        if not key:
            continue

        value = value.strip()
        if value:
            try:
                parsed = shlex.split(value, posix=True)
            except ValueError:
                parsed = [value]
            value = parsed[0] if len(parsed) == 1 else value

        os.environ.setdefault(key, value)


def agentweaver_home() -> Path:
    configured = os.environ.get("AGENTWEAVER_HOME", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    return Path(__file__).resolve().parent


def default_docker_compose_file() -> str:
    return str(agentweaver_home() / "docker-compose.yml")


def default_codex_home_dir() -> Path:
    return agentweaver_home() / ".codex-home"


def ensure_runtime_bind_path(path: Path, *, is_dir: bool) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    if is_dir:
        path.mkdir(parents=True, exist_ok=True)
    else:
        path.touch(exist_ok=True)
    return path


def default_host_ssh_dir() -> Path:
    candidate = Path.home() / ".ssh"
    if candidate.is_dir():
        return candidate
    return ensure_runtime_bind_path(agentweaver_home() / ".runtime" / "ssh", is_dir=True)


def default_host_gitconfig() -> Path:
    candidate = Path.home() / ".gitconfig"
    if candidate.is_file():
        return candidate
    return ensure_runtime_bind_path(agentweaver_home() / ".runtime" / "gitconfig", is_dir=False)


def docker_runtime_env() -> dict[str, str]:
    env = os.environ.copy()
    env.setdefault("AGENTWEAVER_HOME", str(agentweaver_home()))
    env.setdefault("PROJECT_DIR", str(Path.cwd().resolve()))

    codex_home_dir = Path(env.get("CODEX_HOME_DIR", "")).expanduser() if env.get("CODEX_HOME_DIR") else default_codex_home_dir()
    ensure_runtime_bind_path(codex_home_dir, is_dir=True)
    env.setdefault("CODEX_HOME_DIR", str(codex_home_dir))

    env.setdefault("HOST_SSH_DIR", str(default_host_ssh_dir()))
    env.setdefault("HOST_GITCONFIG", str(default_host_gitconfig()))

    if hasattr(os, "getuid"):
        env.setdefault("LOCAL_UID", str(os.getuid()))
    else:
        env.setdefault("LOCAL_UID", "1000")
    if hasattr(os, "getgid"):
        env.setdefault("LOCAL_GID", str(os.getgid()))
    else:
        env.setdefault("LOCAL_GID", "1000")

    return env


def usage() -> str:
    return """Usage:
  ./agentweaver.py <jira-browse-url|jira-issue-key>
  ./agentweaver.py --force <jira-browse-url|jira-issue-key>
  ./agentweaver.py plan [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  ./agentweaver.py implement [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  ./agentweaver.py review [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  ./agentweaver.py review-fix [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  ./agentweaver.py test [--dry] [--verbose] <jira-browse-url|jira-issue-key>
  ./agentweaver.py test-fix [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  ./agentweaver.py test-linter-fix [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  ./agentweaver.py auto [--dry] [--verbose] [--prompt <text>] <jira-browse-url|jira-issue-key>
  ./agentweaver.py auto [--dry] [--verbose] [--prompt <text>] --from <phase> <jira-browse-url|jira-issue-key>
  ./agentweaver.py auto --help-phases
  ./agentweaver.py auto-status <jira-browse-url|jira-issue-key>
  ./agentweaver.py auto-reset <jira-browse-url|jira-issue-key>

Interactive Mode:
  When started with only a Jira task, the script opens an interactive shell.
  Available slash commands: /plan, /implement, /review, /review-fix, /test, /test-fix, /test-linter-fix, /auto, /auto-status, /auto-reset, /help, /exit

Flags:
  --force         In interactive mode, force refresh Jira task and task summary
  --dry           Fetch Jira task, but print docker/codex/claude commands
                  instead of executing them
  --verbose       Show live stdout/stderr of launched commands
  --prompt        Extra prompt text appended to the base prompt

Required environment variables:
  JIRA_API_KEY    Jira API key used in Authorization: Bearer <token> for plan

Optional environment variables:
  JIRA_BASE_URL   Jira base URL like https://jira.example.ru
                  Required when passing only a Jira issue key like DEMO-3288
  AGENTWEAVER_HOME
                  Path to AgentWeaver home with docker-compose.yml and runtime data
                  Defaults to the directory that contains agentweaver.py
  DOCKER_COMPOSE_BIN
                  Explicit docker compose command, for example "docker compose"
                  or "docker-compose"
  CODEX_BIN       Explicit path to codex binary
  CODEX_MODEL     Codex model for local and docker exec runs, defaults to "gpt-5.4"
  CLAUDE_BIN      Explicit path to claude binary
  CLAUDE_REVIEW_MODEL
                  Claude model for review runs, defaults to "opus"
  CLAUDE_SUMMARY_MODEL
                  Claude model for summary runs, defaults to "haiku"
"""


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(add_help=False, usage=usage())
    parser.add_argument("--help", "-h", action="store_true")
    subparsers = parser.add_subparsers(dest="command")

    for command_name in COMMANDS:
        subparser = subparsers.add_parser(command_name, add_help=False)
        subparser.add_argument("--dry", action="store_true")
        subparser.add_argument("--verbose", action="store_true")
        subparser.add_argument("--prompt")
        subparser.add_argument("--help", "-h", action="store_true")
        if command_name == "auto":
            subparser.add_argument("--from", dest="auto_from_phase")
            subparser.add_argument("--help-phases", action="store_true")
        subparser.add_argument("jira_ref", nargs="?")

    return parser


def require_cmd(cmd_name: str) -> None:
    if shutil.which(cmd_name) is None:
        raise TaskRunnerError(f"Missing required command: {cmd_name}")


def find_cmd_path(cmd_name: str, env_var_name: str) -> str | None:
    configured_path = os.environ.get(env_var_name)
    if configured_path and os.access(configured_path, os.X_OK):
        return configured_path

    candidate = shutil.which(cmd_name)
    if candidate:
        return candidate

    try:
        result = subprocess.run(
            ["bash", "-ic", f"type -a -- {shlex.quote(cmd_name)}"],
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return None

    if result.returncode != 0:
        return None

    for line in result.stdout.splitlines():
        line = line.strip()
        if line.startswith(f"{cmd_name} is aliased to "):
            alias_value = line.split(" is aliased to ", 1)[1].strip("`'")
            if os.access(alias_value, os.X_OK):
                return alias_value
            continue
        if line.startswith("/") and os.access(line, os.X_OK):
            return line

    return None


def resolve_cmd(cmd_name: str, env_var_name: str) -> str:
    candidate = find_cmd_path(cmd_name, env_var_name)
    if candidate:
        return candidate
    raise TaskRunnerError(f"Missing required command: {cmd_name}")


def require_docker_compose() -> None:
    require_cmd("docker")
    result = subprocess.run(
        ["docker", "compose", "version"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if result.returncode != 0:
        raise TaskRunnerError("Missing required docker compose plugin")


def resolve_docker_compose_cmd() -> list[str]:
    configured = os.environ.get("DOCKER_COMPOSE_BIN", "").strip()
    if configured:
        parts = shlex.split(configured)
        if not parts:
            raise TaskRunnerError("DOCKER_COMPOSE_BIN is set but empty.")
        executable = parts[0]
        if os.path.isabs(executable):
            if os.access(executable, os.X_OK):
                return parts
        elif shutil.which(executable):
            return parts
        raise TaskRunnerError(f"Configured docker compose command is not executable: {configured}")

    if shutil.which("docker-compose"):
        return ["docker-compose"]

    require_docker_compose()
    return ["docker", "compose"]


def next_review_iteration_for_task(workdir: Path, task_key: str) -> int:
    max_index = 0
    for entry in workdir.iterdir():
        if not entry.is_file():
            continue
        match = REVIEW_FILE_RE.match(entry.name) or REVIEW_REPLY_FILE_RE.match(entry.name)
        if match and match.group(1) == task_key:
            max_index = max(max_index, int(match.group(2)))
    return max_index + 1


def latest_review_reply_iteration(workdir: Path, task_key: str) -> int | None:
    max_index: int | None = None
    for entry in workdir.iterdir():
        if not entry.is_file():
            continue
        match = REVIEW_REPLY_FILE_RE.match(entry.name)
        if match and match.group(1) == task_key:
            current = int(match.group(2))
            max_index = current if max_index is None else max(max_index, current)
    return max_index


def format_command(argv: list[str], env: dict[str, str] | None = None) -> str:
    env_prefix = ""
    if env:
        env_prefix = " ".join(
            f"{key}={shlex.quote(value)}"
            for key, value in env.items()
            if os.environ.get(key) != value
        )
        if env_prefix:
            env_prefix = f"{env_prefix} "
    return f"{env_prefix}{shlex.join(argv)}"


def format_duration(seconds: float) -> str:
    total_seconds = max(0, int(seconds))
    minutes, secs = divmod(total_seconds, 60)
    return f"{minutes:02d}:{secs:02d}"


def run_codex_in_docker(
    config: Config,
    docker_compose_cmd: list[str],
    prompt: str,
    *,
    label_text: str,
) -> None:
    docker_env = docker_runtime_env()
    docker_env["CODEX_PROMPT"] = prompt
    docker_env["CODEX_EXEC_FLAGS"] = (
        f"--model {shlex.quote(codex_model())} --dangerously-bypass-approvals-and-sandbox"
    )

    print_info(label_text)
    print_prompt("Codex", prompt)
    run_command(
        docker_compose_cmd
        + [
            "-f",
            config.docker_compose_file,
            "run",
            "--rm",
            "codex-exec",
        ],
        env=docker_env,
        dry_run=config.dry_run,
        verbose=config.verbose,
        label=f"codex:{codex_model()}",
    )


def run_verify_build_in_docker(
    config: Config,
    docker_compose_cmd: list[str],
    *,
    label_text: str,
) -> None:
    print_info(label_text)
    try:
        run_command(
            docker_compose_cmd
            + [
                "-f",
                config.docker_compose_file,
                "run",
                "--rm",
                "verify-build",
            ],
            env=docker_runtime_env(),
            dry_run=config.dry_run,
            verbose=False,
            label="verify-build",
            print_failure_output=False,
        )
    except subprocess.CalledProcessError as exc:
        print_error(f"Build verification failed with exit code {exc.returncode}")
        if not config.dry_run:
            print_summary(
                "Build Failure Summary",
                summarize_build_failure(config, getattr(exc, "output", "") or ""),
            )
        raise


def print_prompt(tool_name: str, prompt: str) -> None:
    console.print(Panel(prompt, title=f"{tool_name} Prompt", border_style="blue"))


def print_info(message: str) -> None:
    console.print(f"[bold cyan]{message}[/]")


def print_error(message: str) -> None:
    error_console.print(f"[bold red]{message}[/]")


def print_summary(title: str, text: str) -> None:
    console.print(Panel(text.strip() or "Empty summary", title=title, border_style="yellow"))


def print_ready_to_merge() -> None:
    console.print(
        Panel(
            "[bold green]Изменения готовы к merge[/]\nФайл ready-to-merge.md создан.",
            title="Ready To Merge",
            border_style="green",
        )
    )


def print_auto_complete() -> None:
    console.print(
        Panel(
            "[bold green]Auto pipeline finished[/]",
            title="Auto",
            border_style="green",
        )
    )


def print_auto_reset(config: Config, removed: bool) -> None:
    message = (
        f"State file {auto_state_file(config.task_key)} removed."
        if removed
        else "No auto state file found."
    )
    console.print(Panel(message, title="Auto Reset", border_style="yellow"))


def print_auto_missing_state(config: Config) -> None:
    console.print(
        Panel(
            f"No auto state file found for {config.task_key}.",
            title="Auto Status",
            border_style="yellow",
        )
    )


def print_auto_rewind(phase_id: str) -> None:
    console.print(
        Panel(
            f"Auto pipeline will continue from phase: {phase_id}",
            title="Auto Resume",
            border_style="yellow",
        )
    )


def codex_model() -> str:
    return os.environ.get("CODEX_MODEL", DEFAULT_CODEX_MODEL).strip() or DEFAULT_CODEX_MODEL


def claude_review_model() -> str:
    return os.environ.get("CLAUDE_REVIEW_MODEL", DEFAULT_CLAUDE_REVIEW_MODEL).strip() or DEFAULT_CLAUDE_REVIEW_MODEL


def claude_summary_model() -> str:
    return os.environ.get("CLAUDE_SUMMARY_MODEL", DEFAULT_CLAUDE_SUMMARY_MODEL).strip() or DEFAULT_CLAUDE_SUMMARY_MODEL


def truncate_text(text: str, max_chars: int = 12000) -> str:
    text = text.strip()
    if len(text) <= max_chars:
        return text
    return text[-max_chars:]


def fallback_build_failure_summary(output: str) -> str:
    lines = [line.strip() for line in output.splitlines() if line.strip()]
    tail = lines[-8:] if lines else ["No build output captured."]
    return "Не удалось получить summary через Claude.\n\nПоследние строки лога:\n" + "\n".join(tail)


def summarize_build_failure(config: Config, output: str) -> str:
    if not output.strip():
        return "Build verification failed, but no output was captured."

    try:
        claude_cmd = resolve_cmd("claude", "CLAUDE_BIN")
    except TaskRunnerError:
        return fallback_build_failure_summary(output)

    prompt = (
        "Ниже лог упавшей build verification.\n"
        "Сделай краткое резюме на русском языке, без воды.\n"
        "Нужно обязательно выделить:\n"
        "1. Где именно упало.\n"
        "2. Главную причину падения.\n"
        "3. Что нужно исправить дальше, если это очевидно.\n"
        "Ответ дай максимум 5 короткими пунктами.\n\n"
        f"Лог:\n{truncate_text(output)}"
    )

    print_info(f"Summarizing build failure with Claude ({claude_summary_model()})")
    try:
        result = subprocess.run(
            [
                claude_cmd,
                "--model",
                claude_summary_model(),
                "-p",
                prompt,
            ],
            capture_output=True,
            text=True,
            check=True,
            env=os.environ.copy(),
        )
    except (OSError, subprocess.CalledProcessError):
        return fallback_build_failure_summary(output)

    summary = result.stdout.strip()
    return summary or fallback_build_failure_summary(output)


def run_command(
    argv: list[str],
    env: dict[str, str] | None = None,
    dry_run: bool = False,
    verbose: bool = False,
    label: str | None = None,
    print_failure_output: bool = True,
) -> None:
    if dry_run:
        console.print(format_command(argv, env))
        return

    if verbose:
        subprocess.run(argv, check=True, env=env)
        return

    process = subprocess.Popen(
        argv,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    output_chunks: list[str] = []

    def collect_output() -> None:
        assert process.stdout is not None
        for chunk in process.stdout:
            output_chunks.append(chunk)

    reader = threading.Thread(target=collect_output, daemon=True)
    reader.start()

    started_at = time.monotonic()
    status_label = label or (Path(argv[0]).name or argv[0])
    with console.status("", spinner="dots") as status:
        while process.poll() is None:
            elapsed = format_duration(time.monotonic() - started_at)
            status.update(f"[cyan]{status_label}[/] [dim]{elapsed}[/]")
            time.sleep(0.2)

    reader.join()
    elapsed = format_duration(time.monotonic() - started_at)
    console.print(f"[green]Done[/] {elapsed}")

    output = "".join(output_chunks)
    if process.returncode != 0:
        if output and print_failure_output:
            sys.stderr.write(output)
            if not output.endswith("\n"):
                sys.stderr.write("\n")
        raise subprocess.CalledProcessError(process.returncode or 1, argv, output=output)


def build_config(
    command: str,
    jira_ref: str,
    *,
    review_fix_points: str | None = None,
    extra_prompt: str | None = None,
    auto_from_phase: str | None = None,
    dry_run: bool = False,
    verbose: bool = False,
) -> Config:
    if command not in COMMANDS:
        raise TaskRunnerError(f"Unsupported command: {command}")

    jira_issue_key = extract_issue_key(jira_ref)
    jira_browse_url = build_jira_browse_url(jira_ref)
    jira_api_url = build_jira_api_url(jira_ref)
    jira_task_file = f"./{jira_issue_key}.json"

    return Config(
        command=command,
        jira_ref=jira_ref,
        review_fix_points=review_fix_points,
        extra_prompt=extra_prompt,
        auto_from_phase=validate_auto_phase_id(auto_from_phase) if auto_from_phase else None,
        dry_run=dry_run,
        verbose=verbose,
        docker_compose_file=default_docker_compose_file(),
        docker_compose_cmd=[],
        codex_cmd=os.environ.get("CODEX_BIN", "codex"),
        claude_cmd=os.environ.get("CLAUDE_BIN", "claude"),
        jira_issue_key=jira_issue_key,
        task_key=jira_issue_key,
        jira_browse_url=jira_browse_url,
        jira_api_url=jira_api_url,
        jira_task_file=jira_task_file,
    )


def check_prerequisites(config: Config) -> tuple[str, str, list[str]]:
    codex_cmd = config.codex_cmd
    claude_cmd = config.claude_cmd
    docker_compose_cmd = config.docker_compose_cmd

    if config.command in {"plan", "review"}:
        codex_cmd = resolve_cmd("codex", "CODEX_BIN")

    if config.command == "review":
        claude_cmd = resolve_cmd("claude", "CLAUDE_BIN")

    if config.command in {"implement", "review-fix", "test", "test-fix", "test-linter-fix"}:
        docker_compose_cmd = resolve_docker_compose_cmd()
        if not Path(config.docker_compose_file).is_file():
            raise TaskRunnerError(f"docker-compose file not found: {config.docker_compose_file}")

    return codex_cmd, claude_cmd, docker_compose_cmd


def build_phase_config(base_config: Config, command: str) -> Config:
    return replace(base_config, command=command)


def append_prompt_text(base_prompt: str | None, suffix: str) -> str:
    if not base_prompt or not base_prompt.strip():
        return suffix
    return f"{base_prompt.strip()}\n{suffix}"


def config_for_auto_step(base_config: Config, step: AutoStepState) -> Config:
    step_config = build_phase_config(base_config, step.command)
    if step.command == "review-fix":
        step_config = replace(
            step_config,
            extra_prompt=append_prompt_text(base_config.extra_prompt, AUTO_REVIEW_FIX_EXTRA_PROMPT),
        )
    return step_config


def rewind_auto_pipeline_state(state: AutoPipelineState, phase_id: str) -> None:
    target_phase_id = validate_auto_phase_id(phase_id)
    phase_seen = False
    for step in state.steps:
        if step.id == target_phase_id:
            phase_seen = True
        if phase_seen:
            step.status = "pending"
            step.started_at = None
            step.finished_at = None
            step.return_code = None
            step.note = None
        else:
            step.status = "done"
            step.return_code = 0
            if step.finished_at is None:
                step.finished_at = now_iso8601()
    state.status = "pending"
    state.current_step = None
    state.last_error = None


def run_auto_pipeline_dry_run(config: Config) -> None:
    print_info("Dry-run auto pipeline: plan -> implement -> test -> review/review-fix/test")
    execute_command(build_phase_config(config, "plan"))
    execute_command(build_phase_config(config, "implement"), run_followup_verify=False)
    execute_command(build_phase_config(config, "test"))
    for iteration in range(1, AUTO_MAX_REVIEW_ITERATIONS + 1):
        print_info(f"Dry-run auto review iteration {iteration}/{AUTO_MAX_REVIEW_ITERATIONS}")
        execute_command(build_phase_config(config, "review"))
        execute_command(
            replace(
                build_phase_config(config, "review-fix"),
                extra_prompt=append_prompt_text(config.extra_prompt, AUTO_REVIEW_FIX_EXTRA_PROMPT),
            ),
            run_followup_verify=False,
        )
        execute_command(build_phase_config(config, "test"))


def run_auto_pipeline(config: Config) -> None:
    if config.dry_run:
        run_auto_pipeline_dry_run(config)
        return

    state = load_auto_pipeline_state(config)
    if state is None:
        state = create_auto_pipeline_state(config)
    if config.auto_from_phase:
        rewind_auto_pipeline_state(state, config.auto_from_phase)
        print_auto_rewind(config.auto_from_phase)
        save_auto_pipeline_state(state)
    elif auto_state_file(config.task_key).is_file() is False:
        save_auto_pipeline_state(state)

    print_info("Running auto pipeline with persisted state")
    while True:
        step = next_auto_step(state)
        if step is None:
            if any(existing.status == "failed" for existing in state.steps):
                state.status = "blocked"
            elif any(existing.status == "skipped" for existing in state.steps):
                state.status = "completed"
            else:
                state.status = "max-iterations-reached"
            state.current_step = None
            save_auto_pipeline_state(state)
            if state.status == "completed":
                print_auto_complete()
            else:
                print_info(f"Auto pipeline finished with status: {state.status}")
            return

        state.status = "running"
        state.current_step = step.id
        step.status = "running"
        step.started_at = now_iso8601()
        step.finished_at = None
        step.return_code = None
        step.note = None
        state.last_error = None
        save_auto_pipeline_state(state)

        try:
            print_info(f"Running auto step: {step.id}")
            result = execute_command(
                config_for_auto_step(config, step),
                run_followup_verify=False if step.command in {"implement", "review-fix"} else True,
            )
            step.status = "done"
            step.finished_at = now_iso8601()
            step.return_code = 0

            if step.command == "review" and result:
                skip_auto_steps_after_ready_to_merge(state, step.id)
                state.status = "completed"
                state.current_step = None
                save_auto_pipeline_state(state)
                print_auto_complete()
                return
        except subprocess.CalledProcessError as exc:
            step.status = "failed"
            step.finished_at = now_iso8601()
            step.return_code = exc.returncode or 1
            state.status = "blocked"
            state.current_step = step.id
            state.last_error = {
                "step": step.id,
                "return_code": exc.returncode or 1,
                "message": "command failed",
            }
            save_auto_pipeline_state(state)
            raise

        save_auto_pipeline_state(state)


def execute_command(config: Config, *, run_followup_verify: bool = True) -> bool:
    if config.command == "auto":
        run_auto_pipeline(config)
        return False
    if config.command == "auto-status":
        state = load_auto_pipeline_state(config)
        if state is None:
            print_auto_missing_state(config)
            return False
        print_auto_state(state)
        return False
    if config.command == "auto-reset":
        removed = reset_auto_pipeline_state(config)
        print_auto_reset(config, removed)
        return False

    codex_cmd, claude_cmd, docker_compose_cmd = check_prerequisites(config)

    os.environ["JIRA_BROWSE_URL"] = config.jira_browse_url
    os.environ["JIRA_API_URL"] = config.jira_api_url
    os.environ["JIRA_TASK_FILE"] = config.jira_task_file

    plan_prompt = format_prompt(
        PLAN_PROMPT_TEMPLATE.format(
            jira_task_file=config.jira_task_file,
            design_file=design_file(config.task_key),
            plan_file=plan_file(config.task_key),
            qa_file=qa_file(config.task_key),
        ),
        config.extra_prompt,
    )
    implement_prompt = format_prompt(
        IMPLEMENT_PROMPT_TEMPLATE.format(
            design_file=design_file(config.task_key),
            plan_file=plan_file(config.task_key),
        ),
        config.extra_prompt,
    )
    test_fix_prompt = format_prompt(TEST_FIX_PROMPT_TEMPLATE, config.extra_prompt)
    test_linter_fix_prompt = format_prompt(TEST_LINTER_FIX_PROMPT_TEMPLATE, config.extra_prompt)

    if config.command == "plan":
        if config.verbose:
            console.print(f"Fetching Jira issue from browse URL: {config.jira_browse_url}")
            console.print(f"Resolved Jira API URL: {config.jira_api_url}")
            console.print(f"Saving Jira issue JSON to: {config.jira_task_file}")
        fetch_jira_issue(config.jira_api_url, config.jira_task_file)
        print_info("Running Codex planning mode")
        print_prompt("Codex", plan_prompt)
        run_command(
            [codex_cmd, "exec", "--model", codex_model(), "--full-auto", plan_prompt],
            env=os.environ.copy(),
            dry_run=config.dry_run,
            verbose=config.verbose,
            label=f"codex:{codex_model()}",
        )
        require_artifacts(
            plan_artifacts(config.task_key),
            "Plan mode did not produce the required artifacts.",
        )
        return False

    if config.command == "implement":
        require_jira_task_file(config.jira_task_file)
        require_artifacts(
            plan_artifacts(config.task_key),
            "Implement mode requires plan artifacts from the planning phase.",
        )
        run_codex_in_docker(
            config,
            docker_compose_cmd,
            implement_prompt,
            label_text="Running Codex implementation mode in isolated Docker",
        )
        if run_followup_verify:
            run_verify_build_in_docker(
                config,
                docker_compose_cmd,
                label_text="Running build verification in isolated Docker",
            )
        return False

    if config.command == "review":
        require_jira_task_file(config.jira_task_file)
        require_artifacts(
            plan_artifacts(config.task_key),
            "Review mode requires plan artifacts from the planning phase.",
        )
        iteration = next_review_iteration_for_task(Path.cwd(), config.task_key)
        review_file = artifact_file("review", config.task_key, iteration)
        review_reply_file = artifact_file("review-reply", config.task_key, iteration)
        review_summary_file = artifact_file("review-summary", config.task_key, iteration)
        review_reply_summary_file = artifact_file("review-reply-summary", config.task_key, iteration)
        claude_prompt = format_prompt(
            REVIEW_PROMPT_TEMPLATE.format(
                jira_task_file=config.jira_task_file,
                design_file=design_file(config.task_key),
                plan_file=plan_file(config.task_key),
                review_file=review_file,
            ),
            config.extra_prompt,
        )
        codex_reply_prompt = format_prompt(
            REVIEW_REPLY_PROMPT_TEMPLATE.format(
                review_file=review_file,
                jira_task_file=config.jira_task_file,
                design_file=design_file(config.task_key),
                plan_file=plan_file(config.task_key),
                review_reply_file=review_reply_file,
            ),
            config.extra_prompt,
        )

        print_info(f"Running Claude review mode (iteration {iteration})")
        print_prompt("Claude", claude_prompt)
        run_command(
            [
                claude_cmd,
                "--model",
                claude_review_model(),
                "-p",
                "--allowedTools=Read,Write,Edit",
                "--output-format",
                "stream-json",
                "--verbose",
                "--include-partial-messages",
                claude_prompt,
            ],
            env=os.environ.copy(),
            dry_run=config.dry_run,
            verbose=config.verbose,
            label=f"claude:{claude_review_model()}",
        )
        if not config.dry_run:
            require_artifacts(
                [review_file],
                "Claude review did not produce the required review artifact.",
            )
            review_summary_prompt = REVIEW_SUMMARY_PROMPT_TEMPLATE.format(
                review_file=review_file,
                review_summary_file=review_summary_file,
            )
            review_summary_text = run_claude_summary(
                claude_cmd,
                review_summary_file,
                review_summary_prompt,
                verbose=config.verbose,
            )
            print_summary("Claude Comments", review_summary_text)
        print_info(f"Running Codex review reply mode (iteration {iteration})")
        print_prompt("Codex", codex_reply_prompt)
        run_command(
            [codex_cmd, "exec", "--model", codex_model(), "--full-auto", codex_reply_prompt],
            env=os.environ.copy(),
            dry_run=config.dry_run,
            verbose=config.verbose,
            label=f"codex:{codex_model()}",
        )
        ready_to_merge = False
        if not config.dry_run:
            require_artifacts(
                [review_reply_file],
                "Codex review reply did not produce the required review-reply artifact.",
            )
            review_reply_summary_prompt = REVIEW_REPLY_SUMMARY_PROMPT_TEMPLATE.format(
                review_reply_file=review_reply_file,
                review_reply_summary_file=review_reply_summary_file,
            )
            review_reply_summary_text = run_claude_summary(
                claude_cmd,
                review_reply_summary_file,
                review_reply_summary_prompt,
                verbose=config.verbose,
            )
            print_summary("Codex Reply Summary", review_reply_summary_text)
            if Path(READY_TO_MERGE_FILE).is_file():
                print_ready_to_merge()
                ready_to_merge = True
        return ready_to_merge

    if config.command == "review-fix":
        require_jira_task_file(config.jira_task_file)
        require_artifacts(
            plan_artifacts(config.task_key),
            "Review-fix mode requires plan artifacts from the planning phase.",
        )
        latest_iteration = latest_review_reply_iteration(Path.cwd(), config.task_key)
        if latest_iteration is None:
            raise TaskRunnerError(
                f"Review-fix mode requires at least one review-reply-{config.task_key}-N.md artifact."
            )

        review_reply_file = artifact_file("review-reply", config.task_key, latest_iteration)
        review_fix_file = artifact_file("review-fix", config.task_key, latest_iteration)
        review_fix_prompt = format_prompt(
            REVIEW_FIX_PROMPT_TEMPLATE.format(
                review_reply_file=review_reply_file,
                items=config.review_fix_points,
                review_fix_file=review_fix_file,
            ),
            config.extra_prompt,
        )

        run_codex_in_docker(
            config,
            docker_compose_cmd,
            review_fix_prompt,
            label_text=f"Running Codex review-fix mode in isolated Docker (iteration {latest_iteration})",
        )
        if not config.dry_run:
            require_artifacts(
                [review_fix_file],
                "Review-fix mode did not produce the required review-fix artifact.",
            )
        if run_followup_verify:
            run_verify_build_in_docker(
                config,
                docker_compose_cmd,
                label_text="Running build verification in isolated Docker",
            )
        return False

    if config.command == "test":
        require_jira_task_file(config.jira_task_file)
        require_artifacts(
            plan_artifacts(config.task_key),
            "Test mode requires plan artifacts from the planning phase.",
        )
        run_verify_build_in_docker(
            config,
            docker_compose_cmd,
            label_text="Running build verification in isolated Docker",
        )
        return False

    if config.command == "test-fix":
        require_jira_task_file(config.jira_task_file)
        require_artifacts(
            plan_artifacts(config.task_key),
            "Test-fix mode requires plan artifacts from the planning phase.",
        )
        run_codex_in_docker(
            config,
            docker_compose_cmd,
            test_fix_prompt,
            label_text="Running Codex test-fix mode in isolated Docker",
        )
        return False

    if config.command == "test-linter-fix":
        require_jira_task_file(config.jira_task_file)
        require_artifacts(
            plan_artifacts(config.task_key),
            "Test-linter-fix mode requires plan artifacts from the planning phase.",
        )
        run_codex_in_docker(
            config,
            docker_compose_cmd,
            test_linter_fix_prompt,
            label_text="Running Codex test-linter-fix mode in isolated Docker",
        )
        return False

    raise TaskRunnerError(f"Unsupported command: {config.command}")


def run_claude_summary(
    claude_cmd: str,
    output_file: str,
    prompt: str,
    *,
    verbose: bool = False,
) -> str:
    print_info(f"Preparing summary in {output_file}")
    print_prompt("Claude", prompt)
    run_command(
        [
            claude_cmd,
            "--model",
            claude_summary_model(),
            "-p",
            "--allowedTools=Read,Write,Edit",
            prompt,
        ],
        env=os.environ.copy(),
        dry_run=False,
        verbose=verbose,
        label=f"claude:{claude_summary_model()}",
    )
    require_artifacts([output_file], f"Claude summary did not produce {output_file}.")
    summary_text = Path(output_file).read_text(encoding="utf-8").strip()
    return summary_text


def summarize_task(jira_ref: str) -> tuple[str, str]:
    config = build_config("plan", jira_ref)
    claude_cmd = resolve_cmd("claude", "CLAUDE_BIN")

    fetch_jira_issue(config.jira_api_url, config.jira_task_file)

    summary_prompt = TASK_SUMMARY_PROMPT_TEMPLATE.format(
        jira_task_file=config.jira_task_file,
        task_summary_file=task_summary_file(config.task_key),
    )

    summary_text = run_claude_summary(claude_cmd, task_summary_file(config.task_key), summary_prompt)
    return config.jira_issue_key, summary_text


def resolve_task_identity(jira_ref: str) -> tuple[str, str]:
    config = build_config("plan", jira_ref)
    summary_path = Path(task_summary_file(config.task_key))
    summary_text = summary_path.read_text(encoding="utf-8").strip() if summary_path.is_file() else ""
    return config.jira_issue_key, summary_text


def parse_cli_args(argv: list[str]) -> argparse.Namespace:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.help:
        console.print(usage())
        raise SystemExit(0)

    if not getattr(args, "command", None):
        console.print(usage(), file=sys.stderr)
        raise SystemExit(1)

    if getattr(args, "help", False) and not getattr(args, "jira_ref", None):
        console.print(usage())
        raise SystemExit(0)

    if getattr(args, "command", None) == "auto" and getattr(args, "help_phases", False):
        print_auto_phases_help()
        raise SystemExit(0)

    if not args.jira_ref:
        console.print(usage(), file=sys.stderr)
        raise SystemExit(1)

    return args


def build_config_from_args(args: argparse.Namespace) -> Config:
    return build_config(
        args.command,
        args.jira_ref,
        extra_prompt=getattr(args, "prompt", None),
        auto_from_phase=getattr(args, "auto_from_phase", None),
        dry_run=args.dry,
        verbose=args.verbose,
    )


def interactive_help() -> None:
    console.print(
        Panel(
            "/plan [extra prompt]\n"
            "/implement [extra prompt]\n"
            "/review [extra prompt]\n"
            "/review-fix [extra prompt]\n"
            "/test\n"
            "/test-fix [extra prompt]\n"
            "/test-linter-fix [extra prompt]\n"
            "/auto [extra prompt]\n"
            "/auto --from <phase> [extra prompt]\n"
            "/auto-status\n"
            "/auto-reset\n"
            "/help auto\n"
            "/help\n"
            "/exit",
            title="Interactive Commands",
            border_style="magenta",
        )
    )


def parse_interactive_command(line: str, jira_ref: str) -> Config | None:
    try:
        parts = shlex.split(line)
    except ValueError as exc:
        raise TaskRunnerError(f"Cannot parse command: {exc}") from exc

    if not parts:
        return None

    command = parts[0]
    if not command.startswith("/"):
        raise TaskRunnerError("Interactive mode expects slash commands. Use /help.")

    command_name = command[1:]
    if command_name == "help":
        if len(parts) > 1 and parts[1] in {"auto", "phases"}:
            print_auto_phases_help()
            return None
        interactive_help()
        return None
    if command_name in {"exit", "quit"}:
        raise EOFError
    if command_name not in COMMANDS:
        raise TaskRunnerError(f"Unknown command: {command}")

    if command_name == "auto":
        auto_from_phase = None
        extra_parts = parts[1:]
        if extra_parts[:1] == ["--from"]:
            if len(extra_parts) < 2:
                raise TaskRunnerError("auto --from requires a phase name. Use /help auto.")
            auto_from_phase = extra_parts[1]
            extra_parts = extra_parts[2:]
        return build_config(
            command_name,
            jira_ref,
            extra_prompt=" ".join(extra_parts) or None,
            auto_from_phase=auto_from_phase,
        )

    return build_config(command_name, jira_ref, extra_prompt=" ".join(parts[1:]) or None)


def run_interactive(jira_ref: str, *, force_refresh: bool = False) -> int:
    config = build_config("plan", jira_ref)
    jira_task_path = Path(config.jira_task_file)

    if force_refresh or not jira_task_path.is_file():
        issue_key, summary_text = summarize_task(jira_ref)
    else:
        issue_key, summary_text = resolve_task_identity(jira_ref)

    HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
    bindings = KeyBindings()

    @bindings.add("tab")
    def _(event) -> None:
        buffer = event.app.current_buffer
        if buffer.complete_state:
            buffer.complete_next()
        else:
            buffer.start_completion(select_first=True)

    session = PromptSession(
        completer=WordCompleter(
            [
                "/plan",
                "/implement",
                "/review",
                "/review-fix",
                "/test",
                "/test-fix",
                "/test-linter-fix",
                "/auto",
                "/auto-status",
                "/auto-reset",
                "/help",
                "/exit",
            ],
            ignore_case=True,
            pattern=re.compile(r"[/a-zA-Z0-9_-]+"),
        ),
        history=FileHistory(str(HISTORY_FILE)),
        key_bindings=bindings,
        complete_while_typing=False,
        style=Style.from_dict({"prompt": "bold #5f87ff"}),
    )

    console.print(
        Panel(
            (
                f"Interactive mode for [bold]{issue_key}[/]\n"
                f"{summary_text}\n\n"
                "Use /help to see commands."
            )
            if summary_text
            else (
                f"Interactive mode for [bold]{issue_key}[/]\n"
                "Using existing Jira task file.\n\n"
                "Use /help to see commands."
            ),
            title="AgentWeaver",
            border_style="green",
        )
    )

    while True:
        try:
            line = session.prompt([("class:prompt", "agentweaver> ")])
            config = parse_interactive_command(line, jira_ref)
            if config is None:
                continue
            execute_command(config)
        except EOFError:
            console.print("[cyan]Bye[/]")
            return 0
        except KeyboardInterrupt:
            console.print()
            continue
        except TaskRunnerError as exc:
            print_error(str(exc))
        except subprocess.CalledProcessError as exc:
            print_error(f"Command failed with exit code {exc.returncode}")


def main(argv: list[str] | None = None) -> int:
    load_env_file(Path(".env"))
    argv = list(sys.argv[1:] if argv is None else argv)
    force_refresh = False

    if argv and argv[0] == "--force":
        force_refresh = True
        argv = argv[1:]

    try:
        if len(argv) == 1 and not argv[0].startswith("-") and argv[0] not in COMMANDS:
            return run_interactive(argv[0], force_refresh=force_refresh)

        args = parse_cli_args(argv)
        config = build_config_from_args(args)
        execute_command(config)
    except TaskRunnerError as exc:
        print_error(str(exc))
        return 1
    except subprocess.CalledProcessError as exc:
        print_error(f"Command failed with exit code {exc.returncode}")
        return exc.returncode or 1
    except SystemExit as exc:
        return int(exc.code) if isinstance(exc.code, int) else 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
