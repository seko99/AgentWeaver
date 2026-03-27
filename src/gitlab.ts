import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { TaskRunnerError } from "./errors.js";

const MERGE_REQUEST_PATH_RE = /^(?<projectPath>.+?)\/-\/merge_requests\/(?<iid>\d+)(?:\/.*)?$/;

type GitLabMergeRequestRef = {
  apiBaseUrl: string;
  mergeRequestUrl: string;
  projectPath: string;
  mergeRequestIid: number;
};

type GitLabReviewFetchTarget = GitLabMergeRequestRef & {
  discussionsApiUrl: string;
};

type GitLabDiscussionNote = {
  id?: number;
  body?: string;
  system?: boolean;
  resolvable?: boolean;
  resolved?: boolean;
  author?: {
    username?: string;
    name?: string;
  };
  created_at?: string;
  position?: {
    new_path?: string;
    old_path?: string;
    new_line?: number;
    old_line?: number;
  } | null;
};

type GitLabDiscussion = {
  id?: string;
  individual_note?: boolean;
  notes?: GitLabDiscussionNote[];
};

type GitLabReviewComment = {
  id: string;
  discussion_id: string;
  body: string;
  author: string;
  created_at: string;
  system: boolean;
  resolvable: boolean;
  resolved: boolean;
  file_path: string | null;
  new_line: number | null;
  old_line: number | null;
};

type GitLabReviewArtifact = {
  summary: string;
  merge_request_url: string;
  project_path: string;
  merge_request_iid: number;
  fetched_at: string;
  comments: GitLabReviewComment[];
};

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function normalizeProjectPath(value: string): string {
  return value.replace(/^\/+/, "").replace(/\/+$/, "");
}

export function parseGitLabMergeRequestUrl(mergeRequestUrl: string): GitLabMergeRequestRef {
  let parsed: URL;
  try {
    parsed = new URL(normalizeUrl(mergeRequestUrl));
  } catch {
    throw new TaskRunnerError("Expected GitLab merge request URL like https://gitlab.example.com/group/project/-/merge_requests/123");
  }

  const match = MERGE_REQUEST_PATH_RE.exec(parsed.pathname);
  const projectPath = normalizeProjectPath(match?.groups?.projectPath ?? "");
  const iidRaw = match?.groups?.iid;
  if (!projectPath || !iidRaw) {
    throw new TaskRunnerError("Expected GitLab merge request URL like https://gitlab.example.com/group/project/-/merge_requests/123");
  }

  return {
    apiBaseUrl: `${parsed.protocol}//${parsed.host}/api/v4`,
    mergeRequestUrl: `${parsed.protocol}//${parsed.host}${parsed.pathname}`,
    projectPath,
    mergeRequestIid: Number.parseInt(iidRaw, 10),
  };
}

export function buildGitLabReviewFetchTarget(mergeRequestUrl: string): GitLabReviewFetchTarget {
  const mergeRequestRef = parseGitLabMergeRequestUrl(mergeRequestUrl);
  return {
    ...mergeRequestRef,
    discussionsApiUrl: `${mergeRequestRef.apiBaseUrl}/projects/${encodeURIComponent(mergeRequestRef.projectPath)}/merge_requests/${mergeRequestRef.mergeRequestIid}/discussions`,
  };
}

async function fetchDiscussionPage(
  target: GitLabReviewFetchTarget,
  page: number,
  token: string,
): Promise<{ discussions: GitLabDiscussion[]; nextPage: number | null }> {
  const apiUrl = `${target.discussionsApiUrl}?per_page=100&page=${page}`;
  const response = await fetch(apiUrl, {
    headers: {
      "PRIVATE-TOKEN": token,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new TaskRunnerError(
      [
        `Failed to fetch GitLab merge request discussions: HTTP ${response.status}`,
        `MR URL: ${target.mergeRequestUrl}`,
        `GitLab project path: ${target.projectPath}`,
        `GitLab merge request IID: ${target.mergeRequestIid}`,
        `GitLab discussions API URL: ${apiUrl}`,
      ].join("\n"),
    );
  }

  const nextPageHeader = response.headers.get("x-next-page");
  const nextPage = nextPageHeader && nextPageHeader.trim().length > 0 ? Number.parseInt(nextPageHeader, 10) : null;
  const discussions = (await response.json()) as GitLabDiscussion[];
  return { discussions, nextPage: Number.isNaN(nextPage ?? Number.NaN) ? null : nextPage };
}

async function fetchMergeRequestDiscussions(
  target: GitLabReviewFetchTarget,
  token: string,
): Promise<GitLabDiscussion[]> {
  const discussions: GitLabDiscussion[] = [];
  let page = 1;
  while (true) {
    const chunk = await fetchDiscussionPage(target, page, token);
    discussions.push(...chunk.discussions);
    if (!chunk.nextPage) {
      return discussions;
    }
    page = chunk.nextPage;
  }
}

function normalizeDiscussionNotes(discussions: GitLabDiscussion[]): GitLabReviewComment[] {
  return discussions.flatMap((discussion) => {
    const discussionId = String(discussion.id ?? "");
    if (!discussionId) {
      return [];
    }
    return (discussion.notes ?? [])
      .filter((note) => typeof note.body === "string" && note.body.trim().length > 0)
      .filter((note) => note.system !== true)
      .map((note) => ({
        id: String(note.id ?? `${discussionId}-${note.created_at ?? "unknown"}`),
        discussion_id: discussionId,
        body: note.body?.trim() ?? "",
        author: note.author?.username?.trim() || note.author?.name?.trim() || "unknown",
        created_at: note.created_at ?? new Date(0).toISOString(),
        system: Boolean(note.system),
        resolvable: Boolean(note.resolvable),
        resolved: Boolean(note.resolved),
        file_path: note.position?.new_path ?? note.position?.old_path ?? null,
        new_line: typeof note.position?.new_line === "number" ? note.position.new_line : null,
        old_line: typeof note.position?.old_line === "number" ? note.position.old_line : null,
      }));
  });
}

function buildGitLabReviewMarkdown(artifact: GitLabReviewArtifact): string {
  const lines = [
    "# GitLab Review",
    "",
    `- MR: ${artifact.merge_request_url}`,
    `- Project: ${artifact.project_path}`,
    `- IID: ${artifact.merge_request_iid}`,
    `- Fetched at: ${artifact.fetched_at}`,
    `- Comments: ${artifact.comments.length}`,
    "",
  ];

  if (artifact.comments.length === 0) {
    lines.push("Код-ревью комментариев не найдено.");
    return lines.join("\n");
  }

  artifact.comments.forEach((comment, index) => {
    lines.push(`## Comment ${index + 1}`);
    lines.push(`- Author: ${comment.author}`);
    lines.push(`- Created at: ${comment.created_at}`);
    lines.push(`- Discussion: ${comment.discussion_id}`);
    if (comment.file_path) {
      const location = [comment.file_path, comment.new_line ?? comment.old_line].filter((item) => item !== null).join(":");
      lines.push(`- Location: ${location}`);
    }
    if (comment.resolvable) {
      lines.push(`- Resolved: ${comment.resolved ? "yes" : "no"}`);
    }
    lines.push("");
    lines.push(comment.body);
    lines.push("");
  });

  return lines.join("\n");
}

export async function fetchGitLabReview(
  mergeRequestUrl: string,
  outputFile: string,
  outputJsonFile: string,
): Promise<GitLabReviewArtifact> {
  const token = process.env.GITLAB_TOKEN?.trim();
  if (!token) {
    throw new TaskRunnerError("GITLAB_TOKEN is required for gitlab-review flow.");
  }

  const target = buildGitLabReviewFetchTarget(mergeRequestUrl);
  const discussions = await fetchMergeRequestDiscussions(target, token);
  const comments = normalizeDiscussionNotes(discussions);
  const fetchedAt = new Date().toISOString();
  const artifact: GitLabReviewArtifact = {
    summary: comments.length > 0 ? `Fetched ${comments.length} GitLab review comments.` : "No GitLab review comments found.",
    merge_request_url: target.mergeRequestUrl,
    project_path: target.projectPath,
    merge_request_iid: target.mergeRequestIid,
    fetched_at: fetchedAt,
    comments,
  };

  mkdirSync(path.dirname(outputFile), { recursive: true });
  mkdirSync(path.dirname(outputJsonFile), { recursive: true });
  await writeFile(outputJsonFile, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await writeFile(outputFile, `${buildGitLabReviewMarkdown(artifact)}\n`, "utf8");
  return artifact;
}
