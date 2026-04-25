import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { buildLogicalKeyForPayload } from "../../artifact-manifest.js";
import { TaskRunnerError } from "../../errors.js";
import { loadProjectPlaybook } from "../../runtime/playbook.js";
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

type PlaybookWriteStatus =
  | "written"
  | "skipped_valid_existing"
  | "blocked"
  | "not_accepted"
  | "dry_run_written"
  | "invalid_manifest"
  | "partial_manifest"
  | "missing_playbook"
  | "failed";

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
  finalManifestFile: string;
};

function readJson<T>(filePath: string): T {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch (error) {
    throw new TaskRunnerError(`Failed to read JSON from ${filePath}: ${(error as Error).message}`);
  }
}

function finalPlaybookPaths(cwd: string): {
  dir: string;
  manifestFile: string;
  projectFile: string;
  practiceFile: string;
  exampleFile: string;
  templateFile: string;
} {
  const dir = path.join(cwd, ".agentweaver", "playbook");
  return {
    dir,
    manifestFile: path.join(dir, "manifest.yaml"),
    projectFile: path.join(dir, "project.md"),
    practiceFile: path.join(dir, "practices", "generated-rules.md"),
    exampleFile: path.join(dir, "examples", "generated-example.md"),
    templateFile: path.join(dir, "templates", "default.md"),
  };
}

function detectExistingState(cwd: string, manifestFile: string): { status: "absent" | "accepted" | "blocked"; blockedPaths: string[]; message: string } {
  if (!existsSync(manifestFile)) {
    return { status: "absent", blockedPaths: [], message: "No manifest-based playbook exists." };
  }
  try {
    loadProjectPlaybook(cwd);
    return { status: "accepted", blockedPaths: [manifestFile], message: "A valid manifest-based playbook already exists." };
  } catch (error) {
    return {
      status: "blocked",
      blockedPaths: [manifestFile],
      message: `Existing manifest-based playbook is invalid or partial: ${(error as Error).message}`,
    };
  }
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
    "# Project playbook",
    "",
    String(finalPlaybook.summary ?? ""),
    "",
    "## Required rules",
    ...(rules.length === 0
      ? ["- No accepted required rules."]
      : rules.map((rule) => `- ${rule.title}: ${rule.rule}\n  Evidence: ${rule.evidence_paths.join(", ")}`)),
    "",
  ].join("\n");
}

function yamlStringArray(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0))).sort();
}

function quotedYamlString(value: string): string {
  return JSON.stringify(value);
}

function yamlList(values: string[], indent = ""): string[] {
  return values.length > 0 ? values.map((value) => `${indent}- ${quotedYamlString(value)}`) : [`${indent}[]`];
}

function renderPracticeMarkdown(draft: PlaybookDraftArtifact): string {
  const body = draft.accepted_rules.length === 0
    ? "No accepted project rules were generated."
    : draft.accepted_rules.map((rule) => `## ${rule.title}\n\n${rule.rule}\n\nEvidence: ${rule.evidence_paths.join(", ")}`).join("\n\n");
  return [
    "---",
    'id: "practice.generated-rules"',
    'title: "Generated project rules"',
    "phases:",
    ...yamlList(["plan", "design_review", "implement", "review", "repair"], "  "),
    "priority: 10",
    'severity: "must"',
    "related_practices: []",
    "related_examples: []",
    "---",
    "",
    body,
    "",
  ].join("\n");
}

function renderExampleMarkdown(): string {
  return [
    "---",
    'id: "example.generated-guidance"',
    'title: "Generated guidance reference"',
    "phases:",
    ...yamlList(["plan", "design_review", "implement", "review", "repair"], "  "),
    "priority: 0",
    'severity: "info"',
    "related_practices:",
    ...yamlList(["practice.generated-rules"], "  "),
    "related_examples: []",
    "---",
    "",
    "Use this entry as a reference marker for generated playbook guidance.",
    "",
  ].join("\n");
}

function renderManifest(draft: PlaybookDraftArtifact): string {
  const evidence = yamlStringArray([
    ...(Array.isArray(draft.evidence_paths) ? draft.evidence_paths : []),
    ...draft.accepted_rules.flatMap((rule) => rule.evidence_paths),
  ]);
  return [
    "version: 1",
    "project:",
    '  name: "Generated Project Playbook"',
    "context_budgets:",
    "  plan: 1200",
    "  design_review: 1000",
    "  implement: 1400",
    "  review: 1000",
    "  repair: 1000",
    "practices:",
    "  paths:",
    ...yamlList(["practices/generated-rules.md"], "    "),
    "  globs: []",
    "examples:",
    "  paths:",
    ...yamlList(["examples/generated-example.md"], "    "),
    "  globs: []",
    "templates:",
    "  paths:",
    ...yamlList(["templates/default.md"], "    "),
    "  globs: []",
    "always_include:",
    ...yamlList(["project.md"], "  "),
    "selection:",
    "  include_examples: true",
    "  max_examples: 1",
    "evidence_paths:",
    ...yamlList(evidence, "  "),
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
    const { dir, manifestFile, projectFile, practiceFile, exampleFile, templateFile } = finalPlaybookPaths(context.cwd);
    const intendedFiles = [manifestFile, projectFile, practiceFile, exampleFile, templateFile];
    const answers = existsSync(params.answersJsonFile) ? readJson<PlaybookAnswersArtifact>(params.answersJsonFile) : {};
    const accepted = answers.final_write_accepted === true;
    let result: PlaybookWriteResult;

    if (!accepted) {
      result = baseResult("not_accepted", "Final playbook write was not accepted in playbook-answers.json.", intendedFiles);
      writeResult(params.writeResultJsonFile, result);
      return { value: { ...result, finalJsonFile: manifestFile, finalMarkdownFile: projectFile, finalManifestFile: manifestFile }, outputs: outputSpecs(context.issueKey, params.writeResultJsonFile) };
    }

    if (context.dryRun) {
      result = baseResult("dry_run_written", "Dry-run mode accepted the generated manifest layout but did not write final playbook files.", intendedFiles);
      writeResult(params.writeResultJsonFile, result);
      return { value: { ...result, finalJsonFile: manifestFile, finalMarkdownFile: projectFile, finalManifestFile: manifestFile }, outputs: outputSpecs(context.issueKey, params.writeResultJsonFile) };
    }

    const existing = detectExistingState(context.cwd, manifestFile);
    if (existing.status === "accepted") {
      result = {
        ...baseResult("skipped_valid_existing", existing.message, intendedFiles),
        skipped_files: intendedFiles,
        existing_playbook_path: manifestFile,
      };
      writeResult(params.writeResultJsonFile, result);
      return { value: { ...result, finalJsonFile: manifestFile, finalMarkdownFile: projectFile, finalManifestFile: manifestFile }, outputs: outputSpecs(context.issueKey, params.writeResultJsonFile) };
    }
    if (existing.status === "blocked") {
      result = {
        ...baseResult("blocked", existing.message, intendedFiles),
        blocked_paths: existing.blockedPaths,
      };
      writeResult(params.writeResultJsonFile, result);
      return { value: { ...result, finalJsonFile: manifestFile, finalMarkdownFile: projectFile, finalManifestFile: manifestFile }, outputs: outputSpecs(context.issueKey, params.writeResultJsonFile) };
    }

    validateStructuredArtifact(params.draftJsonFile, "playbook-draft/v1");
    const draft = readJson<PlaybookDraftArtifact>(params.draftJsonFile);
    const finalPlaybook = toFinalPlaybook(draft, params.draftJsonFile);
    mkdirSync(dir, { recursive: true });
    mkdirSync(path.dirname(practiceFile), { recursive: true });
    mkdirSync(path.dirname(exampleFile), { recursive: true });
    mkdirSync(path.dirname(templateFile), { recursive: true });
    writeFileSync(manifestFile, renderManifest(draft), "utf8");
    writeFileSync(projectFile, renderFinalMarkdown(finalPlaybook), "utf8");
    writeFileSync(practiceFile, renderPracticeMarkdown(draft), "utf8");
    writeFileSync(exampleFile, renderExampleMarkdown(), "utf8");
    writeFileSync(templateFile, "# Default Template\n", "utf8");
    loadProjectPlaybook(context.cwd);
    result = {
      ...baseResult("written", "Accepted playbook was written to the canonical manifest.yaml layout.", intendedFiles),
      written_files: intendedFiles,
    };
    writeResult(params.writeResultJsonFile, result);
    return { value: { ...result, finalJsonFile: manifestFile, finalMarkdownFile: projectFile, finalManifestFile: manifestFile }, outputs: outputSpecs(context.issueKey, params.writeResultJsonFile) };
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
