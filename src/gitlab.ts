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

type GitLabMergeRequestDiffFetchTarget = GitLabMergeRequestRef & {
  mergeRequestApiUrl: string;
  diffsApiUrl: string;
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

type GitLabMergeRequestDetailsResponse = {
  title?: string;
  description?: string;
  state?: string;
  draft?: boolean;
  source_branch?: string;
  target_branch?: string;
  sha?: string;
  web_url?: string;
  created_at?: string;
  updated_at?: string;
  author?: {
    username?: string;
    name?: string;
  };
};

type GitLabMergeRequestDiffResponse = {
  old_path?: string;
  new_path?: string;
  diff?: string;
  new_file?: boolean;
  renamed_file?: boolean;
  deleted_file?: boolean;
  generated_file?: boolean;
  too_large?: boolean;
  collapsed?: boolean;
};

type GitLabMergeRequestDiffFile = {
  old_path: string;
  new_path: string;
  change_type: "added" | "modified" | "deleted" | "renamed";
  new_file: boolean;
  renamed_file: boolean;
  deleted_file: boolean;
  generated_file: boolean;
  too_large: boolean;
  collapsed: boolean;
  diff: string;
};

type GitLabMergeRequestDiffArtifact = {
  summary: string;
  merge_request_url: string;
  project_path: string;
  merge_request_iid: number;
  fetched_at: string;
  merge_request: {
    title: string;
    description: string;
    state: string;
    draft: boolean;
    source_branch: string;
    target_branch: string;
    sha: string;
    author: string;
    created_at: string;
    updated_at: string;
  };
  files: GitLabMergeRequestDiffFile[];
};

type MarkdownLanguage = "en" | "ru" | null | undefined;

function normalizeMarkdownLanguage(mdLang: MarkdownLanguage): "en" | "ru" {
  return mdLang === "en" ? "en" : "ru";
}

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

export function buildGitLabMergeRequestDiffFetchTarget(mergeRequestUrl: string): GitLabMergeRequestDiffFetchTarget {
  const mergeRequestRef = parseGitLabMergeRequestUrl(mergeRequestUrl);
  const mergeRequestApiUrl =
    `${mergeRequestRef.apiBaseUrl}/projects/${encodeURIComponent(mergeRequestRef.projectPath)}` +
    `/merge_requests/${mergeRequestRef.mergeRequestIid}`;
  return {
    ...mergeRequestRef,
    mergeRequestApiUrl,
    diffsApiUrl: `${mergeRequestApiUrl}/diffs`,
  };
}

async function fetchGitLabJson<T>(apiUrl: string, token: string): Promise<{ body: T; headers: Headers }> {
  const response = await fetch(apiUrl, {
    headers: {
      "PRIVATE-TOKEN": token,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new TaskRunnerError(`GitLab API request failed: HTTP ${response.status}\nURL: ${apiUrl}`);
  }

  return {
    body: (await response.json()) as T,
    headers: response.headers,
  };
}

async function fetchDiscussionPage(
  target: GitLabReviewFetchTarget,
  page: number,
  token: string,
): Promise<{ discussions: GitLabDiscussion[]; nextPage: number | null }> {
  const apiUrl = `${target.discussionsApiUrl}?per_page=100&page=${page}`;
  let payload: { body: GitLabDiscussion[]; headers: Headers };
  try {
    payload = await fetchGitLabJson<GitLabDiscussion[]>(apiUrl, token);
  } catch (error) {
    throw new TaskRunnerError(
      [
        `Failed to fetch GitLab merge request discussions: ${(error as Error).message}`,
        `MR URL: ${target.mergeRequestUrl}`,
        `GitLab project path: ${target.projectPath}`,
        `GitLab merge request IID: ${target.mergeRequestIid}`,
        `GitLab discussions API URL: ${apiUrl}`,
      ].join("\n"),
    );
  }

  const nextPageHeader = payload.headers.get("x-next-page");
  const nextPage = nextPageHeader && nextPageHeader.trim().length > 0 ? Number.parseInt(nextPageHeader, 10) : null;
  const discussions = payload.body;
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

function buildGitLabReviewMarkdown(artifact: GitLabReviewArtifact, mdLang?: MarkdownLanguage): string {
  const lang = normalizeMarkdownLanguage(mdLang);
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
    lines.push(lang === "en" ? "No code review comments found." : "Код-ревью комментариев не найдено.");
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

function normalizeMergeRequestAuthor(details: GitLabMergeRequestDetailsResponse): string {
  return details.author?.username?.trim() || details.author?.name?.trim() || "unknown";
}

function normalizeDiffContent(diff: string | undefined, response: GitLabMergeRequestDiffResponse): string {
  const trimmed = diff?.trimEnd() ?? "";
  if (trimmed.length > 0) {
    return trimmed;
  }
  if (response.too_large) {
    return "[Diff omitted by GitLab because it is too large.]";
  }
  if (response.collapsed) {
    return "[Diff omitted by GitLab because it is collapsed.]";
  }
  return "[Diff content is empty.]";
}

function normalizeDiffFiles(diffs: GitLabMergeRequestDiffResponse[]): GitLabMergeRequestDiffFile[] {
  return diffs.map((file, index) => {
    const newPath = file.new_path?.trim() || file.old_path?.trim() || `unknown-file-${index + 1}`;
    const oldPath = file.old_path?.trim() || newPath;
    let changeType: GitLabMergeRequestDiffFile["change_type"] = "modified";
    if (file.new_file) {
      changeType = "added";
    } else if (file.deleted_file) {
      changeType = "deleted";
    } else if (file.renamed_file) {
      changeType = "renamed";
    }

    return {
      old_path: oldPath,
      new_path: newPath,
      change_type: changeType,
      new_file: Boolean(file.new_file),
      renamed_file: Boolean(file.renamed_file),
      deleted_file: Boolean(file.deleted_file),
      generated_file: Boolean(file.generated_file),
      too_large: Boolean(file.too_large),
      collapsed: Boolean(file.collapsed),
      diff: normalizeDiffContent(file.diff, file),
    };
  });
}

async function fetchMergeRequestDetails(
  target: GitLabMergeRequestDiffFetchTarget,
  token: string,
): Promise<GitLabMergeRequestDetailsResponse> {
  try {
    return (await fetchGitLabJson<GitLabMergeRequestDetailsResponse>(target.mergeRequestApiUrl, token)).body;
  } catch (error) {
    throw new TaskRunnerError(
      [
        `Failed to fetch GitLab merge request details: ${(error as Error).message}`,
        `MR URL: ${target.mergeRequestUrl}`,
        `GitLab project path: ${target.projectPath}`,
        `GitLab merge request IID: ${target.mergeRequestIid}`,
        `GitLab merge request API URL: ${target.mergeRequestApiUrl}`,
      ].join("\n"),
    );
  }
}

async function fetchMergeRequestDiffsPage(
  target: GitLabMergeRequestDiffFetchTarget,
  page: number,
  token: string,
): Promise<{ diffs: GitLabMergeRequestDiffResponse[]; nextPage: number | null }> {
  const apiUrl = `${target.diffsApiUrl}?per_page=100&page=${page}`;
  let payload: { body: GitLabMergeRequestDiffResponse[]; headers: Headers };
  try {
    payload = await fetchGitLabJson<GitLabMergeRequestDiffResponse[]>(apiUrl, token);
  } catch (error) {
    throw new TaskRunnerError(
      [
        `Failed to fetch GitLab merge request diffs: ${(error as Error).message}`,
        `MR URL: ${target.mergeRequestUrl}`,
        `GitLab project path: ${target.projectPath}`,
        `GitLab merge request IID: ${target.mergeRequestIid}`,
        `GitLab diffs API URL: ${apiUrl}`,
      ].join("\n"),
    );
  }

  const nextPageHeader = payload.headers.get("x-next-page");
  const nextPage = nextPageHeader && nextPageHeader.trim().length > 0 ? Number.parseInt(nextPageHeader, 10) : null;
  return {
    diffs: payload.body,
    nextPage: Number.isNaN(nextPage ?? Number.NaN) ? null : nextPage,
  };
}

async function fetchMergeRequestDiffs(
  target: GitLabMergeRequestDiffFetchTarget,
  token: string,
): Promise<GitLabMergeRequestDiffResponse[]> {
  const diffs: GitLabMergeRequestDiffResponse[] = [];
  let page = 1;
  while (true) {
    const chunk = await fetchMergeRequestDiffsPage(target, page, token);
    diffs.push(...chunk.diffs);
    if (!chunk.nextPage) {
      return diffs;
    }
    page = chunk.nextPage;
  }
}

function buildGitLabMergeRequestDiffMarkdown(artifact: GitLabMergeRequestDiffArtifact, mdLang?: MarkdownLanguage): string {
  const lang = normalizeMarkdownLanguage(mdLang);
  const lines = [
    "# GitLab MR Diff",
    "",
    `- MR: ${artifact.merge_request_url}`,
    `- Title: ${artifact.merge_request.title}`,
    `- Project: ${artifact.project_path}`,
    `- IID: ${artifact.merge_request_iid}`,
    `- State: ${artifact.merge_request.state}`,
    `- Draft: ${artifact.merge_request.draft ? "yes" : "no"}`,
    `- Author: ${artifact.merge_request.author}`,
    `- Branches: ${artifact.merge_request.source_branch} -> ${artifact.merge_request.target_branch}`,
    `- SHA: ${artifact.merge_request.sha}`,
    `- Fetched at: ${artifact.fetched_at}`,
    `- Files changed: ${artifact.files.length}`,
    "",
  ];

  const description = artifact.merge_request.description.trim();
  if (description) {
    lines.push("## Description", "", description, "");
  }

  if (artifact.files.length === 0) {
    lines.push(lang === "en" ? "No changes found in the diff." : "Изменений в diff не найдено.");
    return lines.join("\n");
  }

  artifact.files.forEach((file, index) => {
    lines.push(`## File ${index + 1}: ${file.new_path}`);
    lines.push(`- Change type: ${file.change_type}`);
    if (file.old_path !== file.new_path) {
      lines.push(`- Old path: ${file.old_path}`);
    }
    if (file.generated_file) {
      lines.push("- Generated: yes");
    }
    if (file.too_large) {
      lines.push("- Too large: yes");
    }
    if (file.collapsed) {
      lines.push("- Collapsed: yes");
    }
    lines.push("", "```diff", file.diff, "```", "");
  });

  return lines.join("\n");
}

export async function fetchGitLabReview(
  mergeRequestUrl: string,
  outputFile: string,
  outputJsonFile: string,
  mdLang?: MarkdownLanguage,
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
  await writeFile(outputFile, `${buildGitLabReviewMarkdown(artifact, mdLang)}\n`, "utf8");
  return artifact;
}

export async function fetchGitLabMergeRequestDiff(
  mergeRequestUrl: string,
  outputFile: string,
  outputJsonFile: string,
  mdLang?: MarkdownLanguage,
): Promise<GitLabMergeRequestDiffArtifact> {
  const token = process.env.GITLAB_TOKEN?.trim();
  if (!token) {
    throw new TaskRunnerError("GITLAB_TOKEN is required for gitlab-diff-review flow.");
  }

  const target = buildGitLabMergeRequestDiffFetchTarget(mergeRequestUrl);
  const [details, diffs] = await Promise.all([fetchMergeRequestDetails(target, token), fetchMergeRequestDiffs(target, token)]);
  const files = normalizeDiffFiles(diffs);
  const fetchedAt = new Date().toISOString();
  const artifact: GitLabMergeRequestDiffArtifact = {
    summary: files.length > 0 ? `Fetched GitLab MR diff with ${files.length} changed files.` : "GitLab MR diff is empty.",
    merge_request_url: target.mergeRequestUrl,
    project_path: target.projectPath,
    merge_request_iid: target.mergeRequestIid,
    fetched_at: fetchedAt,
    merge_request: {
      title: details.title?.trim() || `MR !${target.mergeRequestIid}`,
      description: details.description?.trim() || "",
      state: details.state?.trim() || "unknown",
      draft: Boolean(details.draft),
      source_branch: details.source_branch?.trim() || "unknown",
      target_branch: details.target_branch?.trim() || "unknown",
      sha: details.sha?.trim() || "unknown",
      author: normalizeMergeRequestAuthor(details),
      created_at: details.created_at ?? new Date(0).toISOString(),
      updated_at: details.updated_at ?? new Date(0).toISOString(),
    },
    files,
  };

  mkdirSync(path.dirname(outputFile), { recursive: true });
  mkdirSync(path.dirname(outputJsonFile), { recursive: true });
  await writeFile(outputJsonFile, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await writeFile(outputFile, `${buildGitLabMergeRequestDiffMarkdown(artifact, mdLang)}\n`, "utf8");
  return artifact;
}
