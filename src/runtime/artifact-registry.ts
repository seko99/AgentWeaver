import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  buildArtifactId,
  buildLogicalKeyForPayload,
  buildPublicationKey,
  createProducerSummary,
  diagnosticsForManifest,
  inferPayloadContract,
  parseArtifactReference,
  validateArtifactManifest,
  type ArtifactIndexRecord,
  type ArtifactLineageInput,
  type ArtifactManifest,
  type ArtifactPayloadFamily,
} from "../artifact-manifest.js";
import {
  artifactIndexFile,
  artifactManifestSidecarPath,
  ensureScopeWorkspaceDir,
  scopeArtifactsDir,
  scopeWorkspaceDir,
} from "../artifacts.js";
import { TaskRunnerError } from "../errors.js";
import {
  isArtifactPayloadSchemaId,
  validateArtifactPayload,
} from "../structured-artifacts.js";

export type PublishArtifactInput = {
  scopeKey: string;
  runId: string;
  publicationRunId?: string;
  flowId: string;
  phaseId: string;
  stepId: string;
  nodeKind: string;
  nodeVersion: number;
  kind: "artifact" | "file";
  payloadPath: string;
  logicalKey?: string;
  schemaId?: string;
  schemaVersion?: number;
  payloadFamily?: ArtifactPayloadFamily;
  inputs: ArtifactLineageInput[];
  executor?: string;
  model?: string;
};

export type PublishedArtifactRecord = ArtifactIndexRecord & {
  manifest: ArtifactManifest;
};

export type ArtifactRegistry = {
  publish: (input: PublishArtifactInput) => PublishedArtifactRecord;
  resolveArtifact: (scopeKey: string, reference: string) => ArtifactManifest;
  loadManifestByPayloadPath: (payloadPath: string) => ArtifactManifest | null;
  listScopeArtifacts: (scopeKey: string) => PublishedArtifactRecord[];
  rebuildIndex: (scopeKey: string) => PublishedArtifactRecord[];
  resolveLineageInputFromPath: (scopeKey: string, payloadPath: string) => ArtifactLineageInput;
  computeDiagnostics: (manifest: ArtifactManifest) => ReturnType<typeof diagnosticsForManifest>;
};

function nowIso8601(): string {
  return new Date().toISOString();
}

function historyDir(scopeKey: string): string {
  return path.join(scopeArtifactsDir(scopeKey), "manifest-history");
}

function historyManifestPath(scopeKey: string, artifactId: string): string {
  return path.join(historyDir(scopeKey), `${encodeURIComponent(artifactId)}.manifest.json`);
}

function scopeKeyFromPayloadPath(payloadPath: string): string | null {
  const scopeMarker = `${path.sep}.agentweaver${path.sep}scopes${path.sep}`;
  const markerIndex = payloadPath.lastIndexOf(scopeMarker);
  if (markerIndex < 0) {
    return null;
  }
  const scopePart = payloadPath.slice(markerIndex + scopeMarker.length);
  return scopePart.split(path.sep)[0] || null;
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
}

function computeContentHash(payloadPath: string): string {
  const hash = createHash("sha256");
  hash.update(readFileSync(payloadPath));
  return `sha256:${hash.digest("hex")}`;
}

function toIndexRecord(manifest: ArtifactManifest): ArtifactIndexRecord {
  const producerSummary = manifest.producer.summary ?? createProducerSummary(manifest.producer);
  return {
    artifact_id: manifest.artifact_id,
    logical_key: manifest.logical_key,
    payload_path: manifest.payload_path,
    manifest_path: manifest.manifest_path,
    version: manifest.version,
    status: manifest.status,
    schema_id: manifest.schema_id,
    schema_version: manifest.schema_version,
    created_at: manifest.created_at,
    content_hash: manifest.content_hash,
    producer_summary: producerSummary,
    ...(manifest.supersedes ? { supersedes: manifest.supersedes } : {}),
    is_latest: manifest.status === "ready",
  };
}

function tryLoadManifest(filePath: string): ArtifactManifest | null {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as ArtifactManifest;
    validateArtifactManifest(parsed, filePath);
    return parsed;
  } catch {
    return null;
  }
}

function collectManifestFiles(rootDir: string): string[] {
  if (!existsSync(rootDir)) {
    return [];
  }
  const queue = [rootDir];
  const files: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    const entries = readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "restart-archives") {
          continue;
        }
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && fullPath.endsWith(".manifest.json")) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

function collectScopeManifests(scopeKey: string): ArtifactManifest[] {
  const allPaths = [
    ...collectManifestFiles(scopeWorkspaceDir(scopeKey)),
    ...collectManifestFiles(historyDir(scopeKey)),
  ];
  const manifests = new Map<string, ArtifactManifest>();
  for (const filePath of allPaths) {
    const manifest = tryLoadManifest(filePath);
    if (!manifest) {
      continue;
    }
    manifests.set(manifest.artifact_id, manifest);
  }
  return Array.from(manifests.values()).sort((left, right) => {
    if (left.logical_key !== right.logical_key) {
      return left.logical_key.localeCompare(right.logical_key);
    }
    return left.version - right.version;
  });
}

function writeManifestSidecar(manifest: ArtifactManifest): void {
  writeJsonAtomic(manifest.manifest_path, manifest);
}

function writeManifestHistory(scopeKey: string, manifest: ArtifactManifest): void {
  writeJsonAtomic(historyManifestPath(scopeKey, manifest.artifact_id), manifest);
}

function isRegistryTempFile(scopeKey: string, filePath: string): boolean {
  const relativePath = path.relative(scopeWorkspaceDir(scopeKey), filePath);
  if (relativePath.startsWith("..")) {
    return false;
  }
  if (/\.manifest\.json\.tmp-[^/\\]+$/.test(relativePath)) {
    return true;
  }
  return relativePath.startsWith(`${path.join(".artifacts", path.basename(artifactIndexFile(scopeKey)))}.tmp-`);
}

function removeStaleTempFiles(scopeKey: string): void {
  const workspaceDir = scopeWorkspaceDir(scopeKey);
  if (!existsSync(workspaceDir)) {
    return;
  }
  const queue = [workspaceDir];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    const entries = readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && isRegistryTempFile(scopeKey, fullPath)) {
        rmSync(fullPath, { force: true });
      }
    }
  }
}

function indexRecordEquals(left: ArtifactIndexRecord, right: ArtifactIndexRecord): boolean {
  return left.artifact_id === right.artifact_id
    && left.logical_key === right.logical_key
    && left.payload_path === right.payload_path
    && left.manifest_path === right.manifest_path
    && left.version === right.version
    && left.status === right.status
    && left.schema_id === right.schema_id
    && left.schema_version === right.schema_version
    && left.created_at === right.created_at
    && left.content_hash === right.content_hash
    && left.producer_summary === right.producer_summary
    && left.supersedes === right.supersedes
    && left.is_latest === right.is_latest;
}

function selectLatestReadyManifest(manifests: ArtifactManifest[]): ArtifactManifest | null {
  return manifests
    .filter((manifest) => manifest.status === "ready")
    .sort((left, right) => right.version - left.version)[0] ?? null;
}

function selectNewestManifest(manifests: ArtifactManifest[]): ArtifactManifest | null {
  return manifests
    .slice()
    .sort((left, right) => right.version - left.version)[0] ?? null;
}

function buildScopeRecords(
  scopeKey: string,
  computeDiagnostics: (manifest: ArtifactManifest) => ReturnType<typeof diagnosticsForManifest>,
): PublishedArtifactRecord[] {
  const manifests = collectScopeManifests(scopeKey).map((manifest) => ({
    ...manifest,
    diagnostics: computeDiagnostics(manifest),
  }));
  const latestByLogicalKey = new Map<string, string>();
  for (const manifest of manifests) {
    if (manifest.status === "ready") {
      latestByLogicalKey.set(manifest.logical_key, manifest.artifact_id);
    }
  }
  return manifests.map((manifest) => ({
    ...toIndexRecord(manifest),
    is_latest: latestByLogicalKey.get(manifest.logical_key) === manifest.artifact_id,
    manifest,
  }));
}

function readIndexProjection(scopeKey: string): ArtifactIndexRecord[] | null {
  const indexPath = artifactIndexFile(scopeKey);
  if (!existsSync(indexPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(indexPath, "utf8")) as { records?: ArtifactIndexRecord[] };
    return Array.isArray(parsed.records) ? parsed.records : null;
  } catch {
    return null;
  }
}

function syncIndexProjection(scopeKey: string, records: PublishedArtifactRecord[]): void {
  const projected = records.map(({ manifest: _manifest, ...record }) => record);
  const current = readIndexProjection(scopeKey);
  if (!current && projected.length === 0) {
    return;
  }
  const needsRewrite = !current
    || current.length !== projected.length
    || current.some((record, index) => !indexRecordEquals(record, projected[index] as ArtifactIndexRecord));

  if (!needsRewrite) {
    return;
  }

  writeJsonAtomic(
    artifactIndexFile(scopeKey),
    {
      scope: scopeKey,
      generated_at: nowIso8601(),
      records: projected,
    },
  );
}

export function createArtifactRegistry(): ArtifactRegistry {
  return {
    publish(input) {
      ensureScopeWorkspaceDir(input.scopeKey);
      removeStaleTempFiles(input.scopeKey);
      const sidecarPath = artifactManifestSidecarPath(input.payloadPath);
      const manifests = collectScopeManifests(input.scopeKey);
      const logicalKey = input.logicalKey ?? buildLogicalKeyForPayload(input.scopeKey, input.payloadPath);
      const publicationKey = buildPublicationKey({
        runId: input.runId,
        ...(input.publicationRunId ? { publicationRunId: input.publicationRunId } : {}),
        flowId: input.flowId,
        phaseId: input.phaseId,
        stepId: input.stepId,
        logicalKey,
      });
      const existing = manifests.find((candidate) => candidate.publication_key === publicationKey);
      if (existing) {
        if (existing.payload_path !== input.payloadPath) {
          throw new TaskRunnerError(
            `Manifest publication key collision for ${publicationKey}: ${existing.payload_path} and ${input.payloadPath} resolved to the same logical_key within one step.`,
          );
        }
        return {
          ...toIndexRecord(existing),
          manifest: existing,
        };
      }

      const contract = inferPayloadContract(input.scopeKey, input.payloadPath, {
        ...(input.payloadFamily ? { payloadFamily: input.payloadFamily } : {}),
        ...(input.schemaId ? { schemaId: input.schemaId } : {}),
        ...(input.schemaVersion ? { schemaVersion: input.schemaVersion } : {}),
      });
      const versions = manifests
        .filter((candidate) => candidate.logical_key === logicalKey)
        .sort((left, right) => left.version - right.version);
      const previousLatest = [...versions].reverse().find((candidate) => candidate.status === "ready") ?? versions.at(-1) ?? null;
      const version = (versions.at(-1)?.version ?? 0) + 1;
      const artifactId = buildArtifactId(input.scopeKey, logicalKey, version);
      const manifest: ArtifactManifest = {
        artifact_id: artifactId,
        logical_key: logicalKey,
        scope: input.scopeKey,
        run_id: input.runId,
        flow_id: input.flowId,
        phase_id: input.phaseId,
        step_id: input.stepId,
        kind: input.kind,
        version,
        payload_family: contract.payloadFamily,
        schema_id: contract.schemaId,
        schema_version: contract.schemaVersion,
        created_at: nowIso8601(),
        producer: {
          node: input.nodeKind,
          summary: createProducerSummary({
            node: input.nodeKind,
            ...(input.executor ? { executor: input.executor } : {}),
            ...(input.model ? { model: input.model } : {}),
          }),
          ...(input.executor ? { executor: input.executor } : {}),
          ...(input.model ? { model: input.model } : {}),
        },
        inputs: input.inputs,
        content_hash: computeContentHash(input.payloadPath),
        status: "ready",
        payload_path: input.payloadPath,
        manifest_path: sidecarPath,
        publication_key: publicationKey,
        ...(previousLatest ? { supersedes: previousLatest.artifact_id } : {}),
      };
      validateArtifactManifest(manifest, sidecarPath);

      writeManifestHistory(input.scopeKey, manifest);
      writeManifestSidecar(manifest);
      if (previousLatest) {
        const superseded: ArtifactManifest = {
          ...previousLatest,
          status: "superseded",
          status_reason: `Superseded by ${artifactId}`,
        };
        writeManifestHistory(input.scopeKey, superseded);
        if (previousLatest.manifest_path !== manifest.manifest_path) {
          writeManifestSidecar(superseded);
        }
      }
      this.rebuildIndex(input.scopeKey);
      return {
        ...toIndexRecord(manifest),
        manifest,
      };
    },

    resolveArtifact(scopeKey, reference) {
      removeStaleTempFiles(scopeKey);
      const parsedReference = parseArtifactReference(reference);
      if (!parsedReference) {
        throw new TaskRunnerError(
          `Artifact reference '${reference}' is invalid. Expected an artifact_id or a logical reference in the form <logical_key>@latest or <logical_key>@vN.`,
        );
      }

      const records = buildScopeRecords(scopeKey, this.computeDiagnostics);
      syncIndexProjection(scopeKey, records);
      const manifests = records.map((record) => record.manifest);

      if (parsedReference.kind === "artifact-id") {
        if (parsedReference.parsedId.scopeKey !== scopeKey) {
          throw new TaskRunnerError(
            `Artifact id '${reference}' belongs to scope '${parsedReference.parsedId.scopeKey}', expected '${scopeKey}'.`,
          );
        }
        const manifest = manifests.find((candidate) => candidate.artifact_id === parsedReference.artifactId);
        if (!manifest) {
          throw new TaskRunnerError(`Artifact '${reference}' was not found in scope '${scopeKey}'.`);
        }
        return manifest;
      }

      const candidates = manifests.filter((candidate) => candidate.logical_key === parsedReference.logicalKey);
      if (parsedReference.version === "latest") {
        const manifest = selectLatestReadyManifest(candidates);
        if (!manifest) {
          throw new TaskRunnerError(
            `No ready artifact found for logical reference '${reference}' in scope '${scopeKey}'.`,
          );
        }
        return manifest;
      }

      const manifest = candidates.find((candidate) => candidate.version === parsedReference.version);
      if (!manifest) {
        throw new TaskRunnerError(`Artifact reference '${reference}' was not found in scope '${scopeKey}'.`);
      }
      return manifest;
    },

    loadManifestByPayloadPath(payloadPath) {
      const manifest = tryLoadManifest(artifactManifestSidecarPath(payloadPath));
      const scopeKey = scopeKeyFromPayloadPath(payloadPath);
      if (!scopeKey) {
        return manifest;
      }
      removeStaleTempFiles(scopeKey);
      const records = buildScopeRecords(scopeKey, this.computeDiagnostics);
      syncIndexProjection(scopeKey, records);
      const candidates = records
        .map((record) => record.manifest)
        .filter((candidate) => candidate.payload_path === payloadPath);
      return selectLatestReadyManifest(candidates) ?? selectNewestManifest(candidates) ?? manifest;
    },

    listScopeArtifacts(scopeKey) {
      removeStaleTempFiles(scopeKey);
      const records = buildScopeRecords(scopeKey, this.computeDiagnostics);
      syncIndexProjection(scopeKey, records);
      return records;
    },

    rebuildIndex(scopeKey) {
      removeStaleTempFiles(scopeKey);
      const records = buildScopeRecords(scopeKey, this.computeDiagnostics);
      syncIndexProjection(scopeKey, records);
      return records;
    },

    resolveLineageInputFromPath(scopeKey, payloadPath) {
      const manifest = this.loadManifestByPayloadPath(payloadPath);
      if (!manifest) {
        return {
          source: "external-path",
          path: payloadPath,
        };
      }
      return {
        source: "manifest",
        path: payloadPath,
        artifact_id: manifest.artifact_id,
        logical_key: manifest.logical_key,
        schema_id: manifest.schema_id,
        schema_version: manifest.schema_version,
      };
    },

    computeDiagnostics(manifest) {
      return diagnosticsForManifest(manifest, (schemaId, payloadPath) => {
        if (!isArtifactPayloadSchemaId(schemaId)) {
          throw new Error(`Structured artifact schema is not registered: ${schemaId}`);
        }
        validateArtifactPayload(payloadPath, schemaId);
      });
    },
  };
}
