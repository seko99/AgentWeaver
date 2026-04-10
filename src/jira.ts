import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { TaskRunnerError } from "./errors.js";

const ISSUE_KEY_RE = /^[A-Z][A-Z0-9_]*-[0-9]+$/;
const TEXT_ATTACHMENT_EXTENSIONS = new Set([".md", ".json", ".txt"]);
const DOWNLOAD_ONLY_ATTACHMENT_EXTENSIONS = new Set([".doc"]);
const JIRA_AUTH_MODES = new Set(["auto", "basic", "bearer"]);

type JiraAttachmentRecord = {
  id?: unknown;
  filename?: unknown;
  mimeType?: unknown;
  content?: unknown;
  size?: unknown;
  created?: unknown;
};

type JiraIssueRecord = {
  fields?: {
    attachment?: unknown;
  };
};

type JiraAttachmentManifestItem = {
  id: string;
  fileName: string;
  extension: string;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string | null;
  downloadUrl: string;
  savedPath: string;
  includedInPlanningContext: boolean;
};

type JiraAttachmentManifest = {
  summary: {
    downloadedCount: number;
    planningContextCount: number;
  };
  attachments: JiraAttachmentManifestItem[];
};

export type JiraFetchArtifacts = {
  issueFile: string;
  attachmentsManifestFile?: string;
  attachmentsContextFile?: string;
  downloadedAttachments: number;
  planningContextAttachments: number;
};

type JiraResolvedAuthMode = "basic" | "bearer";

function parseJiraAuthMode(rawMode: string | undefined): "auto" | JiraResolvedAuthMode {
  const mode = rawMode?.trim().toLowerCase() || "auto";
  if (!JIRA_AUTH_MODES.has(mode)) {
    throw new TaskRunnerError("JIRA_AUTH_MODE must be one of: auto, basic, bearer.");
  }
  return mode as "auto" | JiraResolvedAuthMode;
}

export function detectJiraDeployment(url: string): "cloud" | "server" {
  try {
    return new URL(url).hostname.toLowerCase().includes("atlassian") ? "cloud" : "server";
  } catch {
    return url.toLowerCase().includes("atlassian") ? "cloud" : "server";
  }
}

export function resolveJiraAuthMode(url: string): JiraResolvedAuthMode {
  const authMode = parseJiraAuthMode(process.env.JIRA_AUTH_MODE);
  if (authMode !== "auto") {
    return authMode;
  }
  return detectJiraDeployment(url) === "cloud" ? "basic" : "bearer";
}

export function buildJiraAuthHeaders(url: string): Record<string, string> {
  const jiraApiKey = process.env.JIRA_API_KEY?.trim();
  if (!jiraApiKey) {
    throw new TaskRunnerError("JIRA_API_KEY is required for Jira authentication.");
  }

  const authMode = resolveJiraAuthMode(url);
  if (authMode === "bearer") {
    return {
      Authorization: `Bearer ${jiraApiKey}`,
    };
  }

  const jiraUsername = process.env.JIRA_USERNAME?.trim();
  if (!jiraUsername) {
    const host = (() => {
      try {
        return new URL(url).host;
      } catch {
        return "unknown";
      }
    })();
    throw new TaskRunnerError(
      `JIRA_USERNAME is required for Jira Cloud Basic auth (detected from URL host: ${host}).`,
    );
  }
  const encodedCredentials = Buffer.from(`${jiraUsername}:${jiraApiKey}`).toString("base64");
  return {
    Authorization: `Basic ${encodedCredentials}`,
  };
}

function sanitizeAttachmentFileName(fileName: string): string {
  const parsed = path.parse(fileName);
  const baseName = parsed.name
    .trim()
    .replaceAll(/[^a-zA-Z0-9._-]+/g, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^-|-$/g, "");
  const safeBaseName = baseName.length > 0 ? baseName : "attachment";
  const extension = parsed.ext.replaceAll(/[^a-zA-Z0-9.]+/g, "").toLowerCase();
  return `${safeBaseName}${extension}`;
}

function attachmentExtension(fileName: string): string {
  return path.extname(fileName).toLowerCase();
}

function parseJiraAttachments(issueBody: Buffer): JiraAttachmentRecord[] {
  try {
    const parsed = JSON.parse(issueBody.toString("utf8")) as JiraIssueRecord;
    return Array.isArray(parsed.fields?.attachment) ? (parsed.fields.attachment as JiraAttachmentRecord[]) : [];
  } catch {
    return [];
  }
}

async function fetchAuthorizedBuffer(url: string, accept: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: {
      ...buildJiraAuthHeaders(url),
      Accept: accept,
    },
  });

  if (!response.ok) {
    throw new TaskRunnerError(`Failed to fetch Jira resource: HTTP ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function toTextAttachmentContent(fileName: string, body: Buffer): string {
  return [
    `=== Attachment: ${fileName} ===`,
    body.toString("utf8").trimEnd(),
    "",
  ].join("\n");
}

export function extractIssueKey(jiraRef: string): string {
  const normalizedRef = jiraRef.replace(/\/+$/, "");
  if (normalizedRef.includes("://")) {
    const issueKey = normalizedRef.split("/").pop() ?? "";
    if (!normalizedRef.includes("/browse/") || !issueKey) {
      throw new TaskRunnerError(
        "Expected Jira browse URL like https://jira.example.ru/browse/DEMO-3288",
      );
    }
    return issueKey;
  }

  if (!ISSUE_KEY_RE.test(normalizedRef)) {
    throw new TaskRunnerError(
      "Expected Jira issue key like DEMO-3288 or browse URL like https://jira.example.ru/browse/DEMO-3288",
    );
  }
  return normalizedRef;
}

export function buildJiraBrowseUrl(jiraRef: string): string {
  if (jiraRef.includes("://")) {
    return jiraRef.replace(/\/+$/, "");
  }

  const baseUrl = process.env.JIRA_BASE_URL?.replace(/\/+$/, "") ?? "";
  if (!baseUrl) {
    throw new TaskRunnerError("JIRA_BASE_URL is required when passing only a Jira issue key.");
  }

  return `${baseUrl}/browse/${extractIssueKey(jiraRef)}`;
}

export function buildJiraApiUrl(jiraRef: string): string {
  const browseUrl = buildJiraBrowseUrl(jiraRef);
  const issueKey = extractIssueKey(jiraRef);
  const baseUrl = browseUrl.split("/browse/")[0];
  return `${baseUrl}/rest/api/2/issue/${issueKey}`;
}

export async function fetchJiraIssue(
  jiraApiUrl: string,
  jiraTaskFile: string,
  attachmentsManifestFile?: string,
  attachmentsContextFile?: string,
): Promise<JiraFetchArtifacts> {
  const body = await fetchAuthorizedBuffer(jiraApiUrl, "application/json");
  mkdirSync(path.dirname(jiraTaskFile), { recursive: true });
  await writeFile(jiraTaskFile, body);

  const attachments = parseJiraAttachments(body);
  const manifestItems: JiraAttachmentManifestItem[] = [];
  const planningContextChunks: string[] = [];
  const attachmentsDir = attachmentsManifestFile ? path.join(path.dirname(attachmentsManifestFile), "jira-attachments") : null;
  if (attachmentsManifestFile) {
    mkdirSync(path.dirname(attachmentsManifestFile), { recursive: true });
  }
  if (attachmentsContextFile) {
    mkdirSync(path.dirname(attachmentsContextFile), { recursive: true });
  }
  if (attachmentsDir) {
    mkdirSync(attachmentsDir, { recursive: true });
  }

  for (const [index, attachment] of attachments.entries()) {
    const fileName = typeof attachment.filename === "string" ? attachment.filename.trim() : "";
    const downloadUrl = typeof attachment.content === "string" ? attachment.content.trim() : "";
    if (!fileName || !downloadUrl) {
      continue;
    }
    const extension = attachmentExtension(fileName);
    const shouldDownload = TEXT_ATTACHMENT_EXTENSIONS.has(extension) || DOWNLOAD_ONLY_ATTACHMENT_EXTENSIONS.has(extension);
    if (!shouldDownload || !attachmentsDir) {
      continue;
    }

    const safeFileName = `${String(index + 1).padStart(3, "0")}-${sanitizeAttachmentFileName(fileName)}`;
    const savedPath = path.join(attachmentsDir, safeFileName);
    const attachmentBody = await fetchAuthorizedBuffer(downloadUrl, "*/*");
    await writeFile(savedPath, attachmentBody);

    const includedInPlanningContext = TEXT_ATTACHMENT_EXTENSIONS.has(extension);
    if (includedInPlanningContext) {
      planningContextChunks.push(toTextAttachmentContent(fileName, attachmentBody));
    }

    manifestItems.push({
      id: typeof attachment.id === "string" ? attachment.id : String(attachment.id ?? ""),
      fileName,
      extension,
      mimeType: typeof attachment.mimeType === "string" ? attachment.mimeType : null,
      sizeBytes: typeof attachment.size === "number" ? attachment.size : null,
      createdAt: typeof attachment.created === "string" ? attachment.created : null,
      downloadUrl,
      savedPath,
      includedInPlanningContext,
    });
  }

  const manifest: JiraAttachmentManifest = {
    summary: {
      downloadedCount: manifestItems.length,
      planningContextCount: manifestItems.filter((item) => item.includedInPlanningContext).length,
    },
    attachments: manifestItems,
  };

  if (attachmentsManifestFile) {
    await writeFile(attachmentsManifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
  if (attachmentsContextFile) {
    const contextBody =
      planningContextChunks.length > 0
        ? planningContextChunks.join("\n")
        : "No supported text attachments were downloaded from Jira.\n";
    await writeFile(attachmentsContextFile, contextBody, "utf8");
  }

  return {
    issueFile: jiraTaskFile,
    downloadedAttachments: manifest.summary.downloadedCount,
    planningContextAttachments: manifest.summary.planningContextCount,
    ...(attachmentsManifestFile ? { attachmentsManifestFile } : {}),
    ...(attachmentsContextFile ? { attachmentsContextFile } : {}),
  };
}

export function requireJiraTaskFile(jiraTaskFile: string): void {
  if (!existsSync(jiraTaskFile)) {
    throw new TaskRunnerError(
      `Jira issue JSON not found: ${jiraTaskFile}\nRun plan mode first to download the Jira task.`,
    );
  }
}
