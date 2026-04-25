import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { buildLogicalKeyForPayload } from "../../artifact-manifest.js";
import { TaskRunnerError } from "../../errors.js";
import { validateStructuredArtifact, validateStructuredArtifactValue } from "../../structured-artifacts.js";
import type { PipelineNodeDefinition } from "../types.js";

type PlaybookAnswersArtifact = {
  final_write_accepted?: unknown;
};

type DraftRule = {
  id: string;
  title: string;
  rule: string;
  evidence_paths: string[];
};

type PlaybookDraftArtifact = {
  summary: string;
  accepted_rules: DraftRule[];
  evidence_paths: string[];
};

type PlaybookWriteStatus = "written" | "skipped" | "blocked" | "not_accepted" | "dry_run";

type PlaybookWriteResult = {
  status: PlaybookWriteStatus;
  message: string;
  written_files: string[];
  skipped_files: string[];
  existing_playbook_path: string;
  intended_files: string[];
  blocked_paths: string[];
};

export type PlaybookWriteNodeParams = {
  draftJsonFile: string;
  answersJsonFile: string;
  writeResultJsonFile: string;
};

export type PlaybookWriteNodeResult = PlaybookWriteResult & {
  finalJsonFile: string;
  finalMarkdownFile: string;
};

function readJson<T>(filePath: string): T {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch (error) {
    throw new TaskRunnerError(`Failed to read JSON from ${filePath}: ${(error as Error).message}`);
  }
}

function finalPlaybookPaths(cwd: string): { dir: string; jsonFile: string; markdownFile: string } {
  const dir = path.join(cwd, ".agentweaver", "playbook");
  return {
    dir,
    jsonFile: path.join(dir, "playbook.json"),
    markdownFile: path.join(dir, "playbook.md"),
  };
}

function detectExistingState(jsonFile: string, markdownFile: string): { status: "absent" | "accepted" | "blocked"; blockedPaths: string[]; message: string } {
  const jsonExists = existsSync(jsonFile);
  const markdownExists = existsSync(markdownFile);
  if (!jsonExists && !markdownExists) {
    return { status: "absent", blockedPaths: [], message: "No canonical playbook files exist." };
  }
  if (jsonExists && markdownExists) {
    try {
      validateStructuredArtifact(jsonFile, "playbook-final/v1");
      return { status: "accepted", blockedPaths: [jsonFile, markdownFile], message: "An accepted playbook already exists." };
    } catch (error) {
      return {
        status: "blocked",
        blockedPaths: [jsonFile, markdownFile],
        message: `Existing playbook metadata is malformed or not accepted: ${(error as Error).message}`,
      };
    }
  }
  return {
    status: "blocked",
    blockedPaths: [jsonFile, markdownFile].filter((filePath) => existsSync(filePath)),
    message: "Partial .agentweaver/playbook state blocks final writes until manually repaired.",
  };
}

function toFinalPlaybook(draft: PlaybookDraftArtifact, draftJsonFile: string): Record<string, unknown> {
  const evidence = Array.from(new Set([
    ...(Array.isArray(draft.evidence_paths) ? draft.evidence_paths : []),
    ...draft.accepted_rules.flatMap((rule) => rule.evidence_paths),
  ])).sort((left, right) => left.localeCompare(right));
  return {
    status: "accepted",
    accepted_at: new Date().toISOString(),
    source_draft_artifact: draftJsonFile,
    summary: draft.summary,
    rules: draft.accepted_rules,
    evidence_paths: evidence,
  };
}

function renderFinalMarkdown(finalPlaybook: Record<string, unknown>): string {
  const rules = Array.isArray(finalPlaybook.rules) ? finalPlaybook.rules as DraftRule[] : [];
  return [
    "# Проектный playbook",
    "",
    String(finalPlaybook.summary ?? ""),
    "",
    "## Обязательные правила",
    ...(rules.length === 0
      ? ["- Нет принятых обязательных правил."]
      : rules.map((rule) => `- ${rule.title}: ${rule.rule}\n  Доказательства: ${rule.evidence_paths.join(", ")}`)),
    "",
  ].join("\n");
}

function writeResult(filePath: string, result: PlaybookWriteResult): void {
  validateStructuredArtifactValue(result, "playbook-write-result/v1", filePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

function baseResult(status: PlaybookWriteStatus, message: string, intendedFiles: string[]): PlaybookWriteResult {
  return {
    status,
    message,
    written_files: [],
    skipped_files: [],
    existing_playbook_path: "",
    intended_files: intendedFiles,
    blocked_paths: [],
  };
}

export const playbookWriteNode: PipelineNodeDefinition<PlaybookWriteNodeParams, PlaybookWriteNodeResult> = {
  kind: "playbook-write",
  version: 1,
  async run(context, params) {
    const { dir, jsonFile, markdownFile } = finalPlaybookPaths(context.cwd);
    const intendedFiles = [jsonFile, markdownFile];
    const answers = existsSync(params.answersJsonFile) ? readJson<PlaybookAnswersArtifact>(params.answersJsonFile) : {};
    const accepted = answers.final_write_accepted === true;
    let result: PlaybookWriteResult;

    if (!accepted) {
      result = baseResult("not_accepted", "Final playbook write was not accepted in playbook-answers.json.", intendedFiles);
      writeResult(params.writeResultJsonFile, result);
      return { value: { ...result, finalJsonFile: jsonFile, finalMarkdownFile: markdownFile }, outputs: outputSpecs(context.issueKey, params.writeResultJsonFile) };
    }

    if (context.dryRun) {
      result = baseResult("dry_run", "Dry-run mode did not write final playbook files.", intendedFiles);
      writeResult(params.writeResultJsonFile, result);
      return { value: { ...result, finalJsonFile: jsonFile, finalMarkdownFile: markdownFile }, outputs: outputSpecs(context.issueKey, params.writeResultJsonFile) };
    }

    const existing = detectExistingState(jsonFile, markdownFile);
    if (existing.status === "accepted") {
      result = {
        ...baseResult("skipped", existing.message, intendedFiles),
        skipped_files: intendedFiles,
        existing_playbook_path: jsonFile,
      };
      writeResult(params.writeResultJsonFile, result);
      return { value: { ...result, finalJsonFile: jsonFile, finalMarkdownFile: markdownFile }, outputs: outputSpecs(context.issueKey, params.writeResultJsonFile) };
    }
    if (existing.status === "blocked") {
      result = {
        ...baseResult("blocked", existing.message, intendedFiles),
        blocked_paths: existing.blockedPaths,
      };
      writeResult(params.writeResultJsonFile, result);
      return { value: { ...result, finalJsonFile: jsonFile, finalMarkdownFile: markdownFile }, outputs: outputSpecs(context.issueKey, params.writeResultJsonFile) };
    }

    validateStructuredArtifact(params.draftJsonFile, "playbook-draft/v1");
    const draft = readJson<PlaybookDraftArtifact>(params.draftJsonFile);
    const finalPlaybook = toFinalPlaybook(draft, params.draftJsonFile);
    validateStructuredArtifactValue(finalPlaybook, "playbook-final/v1", jsonFile);
    mkdirSync(dir, { recursive: true });
    writeFileSync(jsonFile, `${JSON.stringify(finalPlaybook, null, 2)}\n`, "utf8");
    writeFileSync(markdownFile, renderFinalMarkdown(finalPlaybook), "utf8");
    result = {
      ...baseResult("written", "Accepted playbook was written to the canonical final layout.", intendedFiles),
      written_files: intendedFiles,
    };
    writeResult(params.writeResultJsonFile, result);
    return { value: { ...result, finalJsonFile: jsonFile, finalMarkdownFile: markdownFile }, outputs: outputSpecs(context.issueKey, params.writeResultJsonFile) };
  },
};

function outputSpecs(scopeKey: string, writeResultJsonFile: string) {
  return [
    {
      kind: "artifact" as const,
      path: writeResultJsonFile,
      required: true,
      manifest: {
        publish: true,
        logicalKey: buildLogicalKeyForPayload(scopeKey, writeResultJsonFile),
        payloadFamily: "structured-json" as const,
        schemaId: "playbook-write-result/v1",
        schemaVersion: 1,
      },
    },
  ];
}
