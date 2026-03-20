from __future__ import annotations

import re
from pathlib import Path

from awlib.errors import TaskRunnerError


REVIEW_FILE_RE = re.compile(r"^review-(.+)-(\d+)\.md$")
REVIEW_REPLY_FILE_RE = re.compile(r"^review-reply-(.+)-(\d+)\.md$")
READY_TO_MERGE_FILE = "ready-to-merge.md"


def artifact_file(prefix: str, task_key: str, iteration: int) -> str:
    return f"{prefix}-{task_key}-{iteration}.md"


def design_file(task_key: str) -> str:
    return artifact_file("design", task_key, 1)


def plan_file(task_key: str) -> str:
    return artifact_file("plan", task_key, 1)


def qa_file(task_key: str) -> str:
    return artifact_file("qa", task_key, 1)


def task_summary_file(task_key: str) -> str:
    return artifact_file("task", task_key, 1)


def plan_artifacts(task_key: str) -> tuple[str, ...]:
    return (design_file(task_key), plan_file(task_key), qa_file(task_key))


def require_artifacts(paths: tuple[str, ...] | list[str], message: str) -> None:
    missing = [path for path in paths if not Path(path).is_file()]
    if missing:
        raise TaskRunnerError(f"{message}\nMissing files: {', '.join(missing)}")
