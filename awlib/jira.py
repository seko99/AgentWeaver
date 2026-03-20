from __future__ import annotations

import os
import re
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from awlib.errors import TaskRunnerError


ISSUE_KEY_RE = re.compile(r"^[A-Z][A-Z0-9_]*-[0-9]+$")


def extract_issue_key(jira_ref: str) -> str:
    normalized_ref = jira_ref.rstrip("/")
    if "://" in normalized_ref:
        issue_key = normalized_ref.rsplit("/", 1)[-1]
        if "/browse/" not in normalized_ref or not issue_key:
            raise TaskRunnerError(
                "Expected Jira browse URL like https://jira.example.ru/browse/DEMO-3288"
            )
        return issue_key

    issue_key = normalized_ref
    if not ISSUE_KEY_RE.match(issue_key):
        raise TaskRunnerError(
            "Expected Jira issue key like DEMO-3288 or browse URL like https://jira.example.ru/browse/DEMO-3288"
        )
    return issue_key


def build_jira_browse_url(jira_ref: str) -> str:
    if "://" in jira_ref:
        return jira_ref.rstrip("/")

    base_url = os.environ.get("JIRA_BASE_URL", "").rstrip("/")
    if not base_url:
        raise TaskRunnerError("JIRA_BASE_URL is required when passing only a Jira issue key.")

    return f"{base_url}/browse/{extract_issue_key(jira_ref)}"


def build_jira_api_url(jira_ref: str) -> str:
    browse_url = build_jira_browse_url(jira_ref)
    issue_key = extract_issue_key(jira_ref)
    base_url = browse_url.rsplit("/browse/", 1)[0]
    return f"{base_url}/rest/api/2/issue/{issue_key}"


def fetch_jira_issue(jira_api_url: str, jira_task_file: str) -> None:
    jira_api_key = os.environ.get("JIRA_API_KEY")
    if not jira_api_key:
        raise TaskRunnerError("JIRA_API_KEY is required for plan mode.")

    request = Request(
        jira_api_url,
        headers={
            "Authorization": f"Bearer {jira_api_key}",
            "Accept": "application/json",
        },
    )

    try:
        with urlopen(request) as response:
            Path(jira_task_file).write_bytes(response.read())
    except HTTPError as exc:
        raise TaskRunnerError(f"Failed to fetch Jira issue: HTTP {exc.code}") from exc
    except URLError as exc:
        raise TaskRunnerError(f"Failed to fetch Jira issue: {exc.reason}") from exc


def require_jira_task_file(jira_task_file: str) -> None:
    if not Path(jira_task_file).is_file():
        raise TaskRunnerError(
            f"Jira issue JSON not found: {jira_task_file}\nRun plan mode first to download the Jira task."
        )
