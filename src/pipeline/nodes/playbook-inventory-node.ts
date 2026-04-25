import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { buildLogicalKeyForPayload } from "../../artifact-manifest.js";
import { validateStructuredArtifactValue } from "../../structured-artifacts.js";
import { collectRepoInventory, renderRepoInventoryMarkdown } from "../../playbook/repo-inventory.js";
import type { PipelineNodeDefinition } from "../types.js";

export type PlaybookInventoryNodeParams = {
  outputJsonFile: string;
  outputFile: string;
};

export type PlaybookInventoryNodeResult = {
  summary: string;
  outputJsonFile: string;
  outputFile: string;
  evidenceCount: number;
};

export const playbookInventoryNode: PipelineNodeDefinition<
  PlaybookInventoryNodeParams,
  PlaybookInventoryNodeResult
> = {
  kind: "playbook-inventory",
  version: 1,
  async run(context, params) {
    const inventory = collectRepoInventory(context.cwd);
    validateStructuredArtifactValue(inventory, "repo-inventory/v1", params.outputJsonFile);
    mkdirSync(path.dirname(params.outputJsonFile), { recursive: true });
    mkdirSync(path.dirname(params.outputFile), { recursive: true });
    writeFileSync(params.outputJsonFile, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
    writeFileSync(params.outputFile, renderRepoInventoryMarkdown(inventory), "utf8");
    return {
      value: {
        summary: inventory.summary,
        outputJsonFile: params.outputJsonFile,
        outputFile: params.outputFile,
        evidenceCount: inventory.evidence.length,
      },
      outputs: [
        {
          kind: "artifact",
          path: params.outputJsonFile,
          required: true,
          manifest: {
            publish: true,
            logicalKey: buildLogicalKeyForPayload(context.issueKey, params.outputJsonFile),
            payloadFamily: "structured-json",
            schemaId: "repo-inventory/v1",
            schemaVersion: 1,
          },
        },
        {
          kind: "artifact",
          path: params.outputFile,
          required: true,
          manifest: {
            publish: true,
            logicalKey: buildLogicalKeyForPayload(context.issueKey, params.outputFile),
            payloadFamily: "markdown",
            schemaId: "markdown/v1",
            schemaVersion: 1,
          },
        },
      ],
    };
  },
};
