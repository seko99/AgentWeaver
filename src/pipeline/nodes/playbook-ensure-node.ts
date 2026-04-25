import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { buildLogicalKeyForPayload } from "../../artifact-manifest.js";
import { loadProjectPlaybook, PLAYBOOK_DIR, PLAYBOOK_MANIFEST } from "../../runtime/playbook.js";
import { validateStructuredArtifactValue } from "../../structured-artifacts.js";
import type { PipelineNodeDefinition } from "../types.js";

type PlaybookEnsureStatus =
  | "skipped_valid_existing"
  | "blocked"
  | "missing_playbook"
  | "invalid_manifest"
  | "dry_run_written";

type PlaybookEnsureResult = {
  status: PlaybookEnsureStatus;
  message: string;
  written_files: string[];
  skipped_files: string[];
  existing_playbook_path: string;
  intended_files: string[];
  blocked_paths: string[];
  shouldRunPlaybookInit: boolean;
  manifestPath: string;
};

export type PlaybookEnsureNodeParams = {
  writeResultJsonFile: string;
  acceptPlaybookDraft?: boolean;
  verifyAfterInit?: boolean;
};

function readWriteStatus(filePath: string): string | null {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as { status?: unknown };
    return typeof parsed.status === "string" ? parsed.status : null;
  } catch {
    return null;
  }
}

function writeResult(scopeKey: string, filePath: string, result: PlaybookEnsureResult) {
  const artifact = {
    status: result.status,
    message: result.message,
    written_files: result.written_files,
    skipped_files: result.skipped_files,
    existing_playbook_path: result.existing_playbook_path,
    intended_files: result.intended_files,
    blocked_paths: result.blocked_paths,
  };
  validateStructuredArtifactValue(artifact, "playbook-write-result/v1", filePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return [
    {
      kind: "artifact" as const,
      path: filePath,
      required: true,
      manifest: {
        publish: true,
        logicalKey: buildLogicalKeyForPayload(scopeKey, filePath),
        payloadFamily: "structured-json" as const,
        schemaId: "playbook-write-result/v1" as const,
        schemaVersion: 1,
      },
    },
  ];
}

export const playbookEnsureNode: PipelineNodeDefinition<PlaybookEnsureNodeParams, PlaybookEnsureResult> = {
  kind: "playbook-ensure",
  version: 1,
  async run(context, params) {
    const playbookRoot = path.join(context.cwd, PLAYBOOK_DIR);
    const manifestPath = path.join(playbookRoot, PLAYBOOK_MANIFEST);
    const intendedFiles = [manifestPath];
    const priorStatus = params.verifyAfterInit ? readWriteStatus(params.writeResultJsonFile) : null;

    if (!existsSync(manifestPath)) {
      if (params.verifyAfterInit && priorStatus === "dry_run_written") {
        const result: PlaybookEnsureResult = {
          status: "dry_run_written",
          message: "Dry-run playbook generation was accepted; manifest.yaml was not written in dry-run mode.",
          written_files: [],
          skipped_files: [],
          existing_playbook_path: "",
          intended_files: intendedFiles,
          blocked_paths: [],
          shouldRunPlaybookInit: false,
          manifestPath,
        };
        return { value: result, outputs: writeResult(context.issueKey, params.writeResultJsonFile, result) };
      }
      const accepted = params.acceptPlaybookDraft === true;
      const result: PlaybookEnsureResult = {
        status: accepted ? "missing_playbook" : "blocked",
        message: accepted
          ? `Playbook manifest is missing: ${manifestPath}. Running playbook-init because acceptPlaybookDraft is true.`
          : `Playbook manifest is missing: ${manifestPath}. Run 'agentweaver playbook-init --accept-playbook-draft' first, or rerun 'agentweaver auto-common-guided --accept-playbook-draft <jira>' to explicitly accept generated playbook content before planning.`,
        written_files: [],
        skipped_files: [],
        existing_playbook_path: "",
        intended_files: intendedFiles,
        blocked_paths: accepted ? [] : [manifestPath],
        shouldRunPlaybookInit: accepted,
        manifestPath,
      };
      return { value: result, outputs: writeResult(context.issueKey, params.writeResultJsonFile, result) };
    }

    try {
      loadProjectPlaybook(context.cwd);
    } catch (error) {
      const result: PlaybookEnsureResult = {
        status: "invalid_manifest",
        message: `Invalid project playbook ${manifestPath}: ${(error as Error).message}`,
        written_files: [],
        skipped_files: [],
        existing_playbook_path: "",
        intended_files: intendedFiles,
        blocked_paths: [manifestPath],
        shouldRunPlaybookInit: false,
        manifestPath,
      };
      return { value: result, outputs: writeResult(context.issueKey, params.writeResultJsonFile, result) };
    }

    const result: PlaybookEnsureResult = {
      status: "skipped_valid_existing",
      message: `Valid project playbook manifest exists: ${manifestPath}.`,
      written_files: [],
      skipped_files: [manifestPath],
      existing_playbook_path: manifestPath,
      intended_files: intendedFiles,
      blocked_paths: [],
      shouldRunPlaybookInit: false,
      manifestPath,
    };
    return { value: result, outputs: writeResult(context.issueKey, params.writeResultJsonFile, result) };
  },
};
