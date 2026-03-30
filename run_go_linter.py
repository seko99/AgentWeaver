#!/usr/bin/env python3

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


ROOT_DIR = Path(os.environ.get("VERIFY_BUILD_ROOT_DIR") or os.getcwd()).resolve()


def log(message: str) -> None:
    print(message, file=sys.stderr)


def strip_ansi(value: str) -> str:
    import re

    return re.sub(r"\x1b\[[0-9;]*m", "", value)


def emit_result(
    ok: bool,
    kind: str,
    stage: str,
    exit_code: int,
    summary: str,
    command: str,
    details: dict[str, object] | None = None,
) -> None:
    payload = {
        "ok": ok,
        "kind": kind,
        "stage": stage,
        "exitCode": exit_code,
        "summary": summary,
        "command": command,
        "details": details or {},
    }
    print(json.dumps(payload, ensure_ascii=False))


def fail(exit_code: int, summary: str, command: str, details: dict[str, object] | None = None) -> "Never":
    emit_result(False, "linter", "run_go_linter", exit_code, summary, command, details)
    raise SystemExit(exit_code)


def require_cmd(command: str) -> None:
    if shutil.which(command):
        return
    fail(
        2,
        f"Missing required command: {command}",
        command,
        {"failedStep": "require_cmd", "missingCommand": command},
    )


def collect_issues(output: str) -> list[str]:
    issues: list[str] = []
    for raw_line in output.splitlines():
        cleaned = strip_ansi(raw_line).rstrip("\r").strip()
        if not cleaned or cleaned.startswith("==>"):
            continue
        issues.append(cleaned)
    return issues


def run_command(argv: list[str]) -> tuple[int, str]:
    completed = subprocess.run(
        argv,
        cwd=ROOT_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        errors="replace",
        check=False,
    )
    output = completed.stdout or ""
    if output:
        print(output, end="" if output.endswith("\n") else "\n", file=sys.stderr)
    return completed.returncode, output


def run_step(label: str, argv: list[str], failed_step: str, summary: str) -> None:
    log(label)
    exit_code, output = run_command(argv)
    if exit_code == 0:
        return

    fail(
        exit_code,
        summary,
        " ".join(argv),
        {
            "failedStep": failed_step,
            "tool": argv[0],
            "raw": output,
            "issues": collect_issues(output),
        },
    )


def main() -> int:
    require_cmd("go")
    require_cmd("golangci-lint")

    os.chdir(ROOT_DIR)

    run_step("==> Generating code (go generate ./...)", ["go", "generate", "./..."], "go-generate", "go generate failed")
    run_step("==> Running linter (golangci-lint run)", ["golangci-lint", "run"], "golangci-lint", "golangci-lint failed")

    emit_result(
        True,
        "linter",
        "run_go_linter",
        0,
        "Linter checks passed",
        "go generate ./... && golangci-lint run",
        {"steps": ["go-generate", "golangci-lint"]},
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
