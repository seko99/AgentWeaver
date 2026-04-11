import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";

import { TaskRunnerError } from "../../errors.js";
import type { PipelineNodeDefinition } from "../types.js";

type GitLabReviewCommentRecord = {
  author?: unknown;
  body?: unknown;
  file_path?: unknown;
  new_line?: unknown;
  old_line?: unknown;
  discussion_id?: unknown;
  created_at?: unknown;
};

type GitLabReviewArtifact = {
  comments?: GitLabReviewCommentRecord[];
};

type ReviewFinding = {
  severity: string;
  title: string;
  description: string;
};

type ReviewFindingsArtifact = {
  summary: string;
  ready_to_merge: boolean;
  findings: ReviewFinding[];
};

export type GitLabReviewArtifactsNodeParams = {
  gitlabReviewJsonFile: string;
  reviewFile: string;
  reviewJsonFile: string;
};

function normalizeMarkdownLanguage(mdLang: "en" | "ru" | null | undefined): "en" | "ru" {
  return mdLang === "en" ? "en" : "ru";
}

function commentLine(comment: GitLabReviewCommentRecord): number | null {
  if (typeof comment.new_line === "number") {
    return comment.new_line;
  }
  if (typeof comment.old_line === "number") {
    return comment.old_line;
  }
  return null;
}

function commentLocation(comment: GitLabReviewCommentRecord): string {
  const filePath = typeof comment.file_path === "string" ? comment.file_path.trim() : "";
  const line = commentLine(comment);
  if (!filePath) {
    return "general";
  }
  return line === null ? filePath : `${filePath}:${line}`;
}

function toReviewFinding(comment: GitLabReviewCommentRecord, index: number): ReviewFinding | null {
  const body = typeof comment.body === "string" ? comment.body.trim() : "";
  if (!body) {
    return null;
  }
  const author = typeof comment.author === "string" ? comment.author.trim() : "unknown";
  const location = commentLocation(comment);
  const preview = body.replace(/\s+/g, " ");
  const titlePreview = preview.length > 72 ? `${preview.slice(0, 69)}...` : preview;
  const discussionId = typeof comment.discussion_id === "string" ? comment.discussion_id.trim() : "";
  const createdAt = typeof comment.created_at === "string" ? comment.created_at.trim() : "";

  return {
    severity: "medium",
    title: `GitLab comment ${index + 1} | ${location} | ${author} | ${titlePreview}`,
    description: [
      `Location: ${location}`,
      `Author: ${author}`,
      discussionId ? `Discussion: ${discussionId}` : "",
      createdAt ? `Created at: ${createdAt}` : "",
      "",
      body,
    ]
      .filter((line) => line.length > 0)
      .join("\n"),
  };
}

function renderReviewMarkdown(artifact: ReviewFindingsArtifact, mdLang: "en" | "ru"): string {
  const lines = [
    "# Review",
    "",
    artifact.summary,
    "",
    `Ready to merge: ${artifact.ready_to_merge ? "yes" : "no"}`,
    "",
  ];

  if (artifact.findings.length === 0) {
    lines.push(mdLang === "en" ? "No findings found." : "Замечаний не найдено.");
    return lines.join("\n");
  }

  artifact.findings.forEach((finding, index) => {
    lines.push(`## Finding ${index + 1}`);
    lines.push(`- Severity: ${finding.severity}`);
    lines.push(`- Title: ${finding.title}`);
    lines.push("");
    lines.push(finding.description);
    lines.push("");
  });

  return lines.join("\n");
}

export const gitlabReviewArtifactsNode: PipelineNodeDefinition<
  GitLabReviewArtifactsNodeParams,
  { findingsCount: number; readyToMerge: boolean }
> = {
  kind: "gitlab-review-artifacts",
  version: 1,
  async run(context, params) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(params.gitlabReviewJsonFile, "utf8"));
    } catch (error) {
      throw new TaskRunnerError(
        `Failed to read GitLab review artifact from ${params.gitlabReviewJsonFile}: ${(error as Error).message}`,
      );
    }

    const gitlabReview = parsed as GitLabReviewArtifact;
    const findings = (Array.isArray(gitlabReview.comments) ? gitlabReview.comments : [])
      .map((comment, index) => toReviewFinding(comment, index))
      .filter((finding): finding is ReviewFinding => finding !== null);

    const artifact: ReviewFindingsArtifact = {
      summary:
        findings.length > 0
          ? `Imported ${findings.length} GitLab code review comments.`
          : "No GitLab code review comments found.",
      ready_to_merge: findings.length === 0,
      findings,
    };
    const mdLang = normalizeMarkdownLanguage(context.mdLang);

    writeFileSync(params.reviewJsonFile, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    writeFileSync(params.reviewFile, `${renderReviewMarkdown(artifact, mdLang)}\n`, "utf8");

    return {
      value: {
        findingsCount: findings.length,
        readyToMerge: artifact.ready_to_merge,
      },
      outputs: [
        { kind: "artifact", path: params.reviewFile, required: true },
        { kind: "artifact", path: params.reviewJsonFile, required: true },
      ],
    };
  },
};
