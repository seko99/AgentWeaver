import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { TaskRunnerError } from "../errors.js";

const require = createRequire(import.meta.url);

export const PLAYBOOK_DIR = ".agentweaver/playbook";
export const PLAYBOOK_MANIFEST = "manifest.yaml";
export const SUPPORTED_PLAYBOOK_VERSION = 1;
export const SUPPORTED_PLAYBOOK_PHASES = ["plan", "design_review", "implement", "review", "repair"] as const;
export const SUPPORTED_PLAYBOOK_SEVERITIES = ["must", "should", "info"] as const;

export type PlaybookPhase = (typeof SUPPORTED_PLAYBOOK_PHASES)[number];
export type PlaybookSeverity = (typeof SUPPORTED_PLAYBOOK_SEVERITIES)[number];

export interface PlaybookProjectMetadata {
  name: string;
  stack?: string[];
  languages?: string[];
  frameworks?: string[];
}

export interface PlaybookContentPaths {
  paths: string[];
  globs: string[];
}

export interface PlaybookSelectionOptions {
  include_examples?: boolean;
  max_examples?: number;
}

export interface PlaybookManifest {
  version: 1;
  project: PlaybookProjectMetadata;
  context_budgets: Partial<Record<PlaybookPhase, number>>;
  practices: PlaybookContentPaths;
  examples: PlaybookContentPaths;
  templates: PlaybookContentPaths;
  always_include: string[];
  selection: PlaybookSelectionOptions;
}

export interface PlaybookAppliesTo {
  languages?: string[];
  frameworks?: string[];
  globs?: string[];
  keywords?: string[];
}

export interface PlaybookMarkdownMetadata {
  id: string;
  title: string;
  phases: PlaybookPhase[];
  applies_to?: PlaybookAppliesTo;
  priority?: number;
  severity?: PlaybookSeverity;
  related_practices: string[];
  related_examples: string[];
}

export interface PlaybookMarkdownEntry {
  kind: "practice" | "example";
  id: string;
  title: string;
  path: string;
  absolutePath: string;
  body: string;
  metadata: PlaybookMarkdownMetadata;
}

export interface LoadedProjectPlaybook {
  root: string;
  playbookRoot: string;
  manifestPath: string;
  projectPath: string;
  manifest: PlaybookManifest;
  projectMarkdown: string;
  practices: PlaybookMarkdownEntry[];
  examples: PlaybookMarkdownEntry[];
  templates: string[];
  alwaysInclude: string[];
}

type UnknownRecord = Record<string, unknown>;

interface ParsedMarkdown {
  frontmatter: unknown;
  body: string;
}

export function loadProjectPlaybook(projectRoot: string): LoadedProjectPlaybook {
  const root = path.resolve(projectRoot);
  const playbookRoot = path.join(root, PLAYBOOK_DIR);
  const manifestPath = path.join(playbookRoot, PLAYBOOK_MANIFEST);

  if (!existsSync(manifestPath)) {
    throw new TaskRunnerError(
      `Playbook manifest is missing: ${manifestPath}. Add ${PLAYBOOK_DIR}/${PLAYBOOK_MANIFEST}.`,
    );
  }

  const manifest = parsePlaybookManifest(readFile(manifestPath), manifestPath);
  const projectPath = resolvePlaybookFile(playbookRoot, "project.md", `${PLAYBOOK_MANIFEST}: project.md`);
  const practiceFiles = resolveContentFiles(playbookRoot, manifest.practices, "practices");
  const exampleFiles = resolveContentFiles(playbookRoot, manifest.examples, "examples");
  const templateFiles = resolveContentFiles(playbookRoot, manifest.templates, "templates");
  const alwaysIncludeFiles = manifest.always_include.map((entry, index) =>
    resolvePlaybookFile(playbookRoot, entry, `${PLAYBOOK_MANIFEST}: always_include[${index}]`),
  );

  const practices = practiceFiles.map((filePath) => parsePlaybookMarkdownFile(filePath, playbookRoot, "practice"));
  const examples = exampleFiles.map((filePath) => parsePlaybookMarkdownFile(filePath, playbookRoot, "example"));

  validateUniqueIds([...practices, ...examples]);
  validateRelationships([...practices, ...examples]);

  return {
    root,
    playbookRoot,
    manifestPath,
    projectPath,
    manifest,
    projectMarkdown: readFile(projectPath),
    practices,
    examples,
    templates: templateFiles.map((filePath) => toPlaybookRelative(playbookRoot, filePath)),
    alwaysInclude: alwaysIncludeFiles.map((filePath) => toPlaybookRelative(playbookRoot, filePath)),
  };
}

export function parsePlaybookManifest(source: string, filePath = PLAYBOOK_MANIFEST): PlaybookManifest {
  const parsed = parseYaml(source, filePath);
  const manifest = requireRecord(parsed, filePath, "manifest");
  const version = manifest.version;

  if (version !== SUPPORTED_PLAYBOOK_VERSION) {
    throw validationError(
      filePath,
      "version",
      `Unsupported playbook version ${String(version)}. Supported version: ${SUPPORTED_PLAYBOOK_VERSION}.`,
    );
  }

  const project = requireRecord(manifest.project, filePath, "project");
  const normalized: PlaybookManifest = {
    version: SUPPORTED_PLAYBOOK_VERSION,
    project: {
      name: requireString(project.name, filePath, "project.name"),
      ...optionalStringArrayField(project, filePath, "project", "stack"),
      ...optionalStringArrayField(project, filePath, "project", "languages"),
      ...optionalStringArrayField(project, filePath, "project", "frameworks"),
    },
    context_budgets: parseContextBudgets(manifest.context_budgets, filePath),
    practices: parseContentPaths(manifest.practices, filePath, "practices"),
    examples: parseContentPaths(manifest.examples, filePath, "examples"),
    templates: parseContentPaths(manifest.templates, filePath, "templates"),
    always_include: optionalStringArray(manifest.always_include, filePath, "always_include"),
    selection: parseSelection(manifest.selection, filePath),
  };

  return normalized;
}

export function parseMarkdownFrontmatter(source: string, filePath: string): ParsedMarkdown {
  if (!source.startsWith("---\n") && source.trim() !== "---") {
    throw validationError(filePath, "frontmatter", "Markdown file must start with YAML frontmatter delimited by ---. ");
  }

  const closingIndex = source.indexOf("\n---", 4);
  if (closingIndex === -1) {
    throw validationError(filePath, "frontmatter", "Markdown frontmatter is missing the closing --- delimiter.");
  }

  const frontmatterSource = source.slice(4, closingIndex);
  const afterDelimiter = source.slice(closingIndex + 4);
  const body = afterDelimiter.startsWith("\n") ? afterDelimiter.slice(1) : afterDelimiter;

  return {
    frontmatter: parseYaml(frontmatterSource, filePath),
    body,
  };
}

export function validateProjectPlaybook(playbook: LoadedProjectPlaybook): LoadedProjectPlaybook {
  validateUniqueIds([...playbook.practices, ...playbook.examples]);
  validateRelationships([...playbook.practices, ...playbook.examples]);
  return playbook;
}

function parsePlaybookMarkdownFile(
  filePath: string,
  playbookRoot: string,
  kind: "practice" | "example",
): PlaybookMarkdownEntry {
  const { frontmatter, body } = parseMarkdownFrontmatter(readFile(filePath), filePath);
  const metadata = parseMarkdownMetadata(frontmatter, filePath);

  return {
    kind,
    id: metadata.id,
    title: metadata.title,
    path: toPlaybookRelative(playbookRoot, filePath),
    absolutePath: filePath,
    body,
    metadata,
  };
}

function parseMarkdownMetadata(value: unknown, filePath: string): PlaybookMarkdownMetadata {
  const metadata = requireRecord(value, filePath, "frontmatter");
  const parsed: PlaybookMarkdownMetadata = {
    id: requireString(metadata.id, filePath, "frontmatter.id"),
    title: requireString(metadata.title, filePath, "frontmatter.title"),
    phases: parsePhases(metadata.phases, filePath, "frontmatter.phases"),
    related_practices: optionalStringArray(metadata.related_practices, filePath, "frontmatter.related_practices"),
    related_examples: optionalStringArray(metadata.related_examples, filePath, "frontmatter.related_examples"),
  };
  const appliesTo = parseAppliesTo(metadata.applies_to, filePath);
  const priority = parseOptionalNonNegativeInteger(metadata.priority, filePath, "frontmatter.priority");
  const severity = parseOptionalSeverity(metadata.severity, filePath, "frontmatter.severity");
  if (appliesTo !== undefined) {
    parsed.applies_to = appliesTo;
  }
  if (priority !== undefined) {
    parsed.priority = priority;
  }
  if (severity !== undefined) {
    parsed.severity = severity;
  }
  return parsed;
}

function parseContextBudgets(value: unknown, filePath: string): Partial<Record<PlaybookPhase, number>> {
  const result: Partial<Record<PlaybookPhase, number>> = {};
  if (value === undefined) {
    return result;
  }
  const budgets = requireRecord(value, filePath, "context_budgets");
  for (const [phase, budget] of Object.entries(budgets)) {
    if (!isSupportedPhase(phase)) {
      throw validationError(
        filePath,
        `context_budgets.${phase}`,
        `Unsupported context budget phase. Supported phases: ${SUPPORTED_PLAYBOOK_PHASES.join(", ")}.`,
      );
    }
    result[phase] = requireNonNegativeInteger(budget, filePath, `context_budgets.${phase}`);
  }
  return result;
}

function parseContentPaths(value: unknown, filePath: string, fieldPath: string): PlaybookContentPaths {
  const paths = requireRecord(value, filePath, fieldPath);
  const parsed = {
    paths: optionalStringArray(paths.paths, filePath, `${fieldPath}.paths`),
    globs: optionalStringArray(paths.globs, filePath, `${fieldPath}.globs`),
  };
  if (parsed.paths.length === 0 && parsed.globs.length === 0) {
    throw validationError(filePath, fieldPath, "Expected at least one path or glob declaration.");
  }
  return parsed;
}

function parseSelection(value: unknown, filePath: string): PlaybookSelectionOptions {
  if (value === undefined) {
    return {};
  }
  const selection = requireRecord(value, filePath, "selection");
  const result: PlaybookSelectionOptions = {};
  if (selection.include_examples !== undefined) {
    if (typeof selection.include_examples !== "boolean") {
      throw validationError(filePath, "selection.include_examples", "Expected a boolean value.");
    }
    result.include_examples = selection.include_examples;
  }
  if (selection.max_examples !== undefined) {
    result.max_examples = requireNonNegativeInteger(selection.max_examples, filePath, "selection.max_examples");
  }
  return result;
}

function parseAppliesTo(value: unknown, filePath: string): PlaybookAppliesTo | undefined {
  if (value === undefined) {
    return undefined;
  }
  const appliesTo = requireRecord(value, filePath, "frontmatter.applies_to");
  return {
    ...optionalStringArrayField(appliesTo, filePath, "frontmatter.applies_to", "languages"),
    ...optionalStringArrayField(appliesTo, filePath, "frontmatter.applies_to", "frameworks"),
    ...optionalStringArrayField(appliesTo, filePath, "frontmatter.applies_to", "globs"),
    ...optionalStringArrayField(appliesTo, filePath, "frontmatter.applies_to", "keywords"),
  };
}

function parsePhases(value: unknown, filePath: string, fieldPath: string): PlaybookPhase[] {
  const phases = optionalStringArray(value, filePath, fieldPath);
  for (const phase of phases) {
    if (!isSupportedPhase(phase)) {
      throw validationError(
        filePath,
        fieldPath,
        `Unsupported phase "${phase}". Supported phases: ${SUPPORTED_PLAYBOOK_PHASES.join(", ")}.`,
      );
    }
  }
  return phases as PlaybookPhase[];
}

function parseOptionalSeverity(value: unknown, filePath: string, fieldPath: string): PlaybookSeverity | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !isSupportedSeverity(value)) {
    throw validationError(
      filePath,
      fieldPath,
      `Unsupported severity "${String(value)}". Supported severities: ${SUPPORTED_PLAYBOOK_SEVERITIES.join(", ")}.`,
    );
  }
  return value;
}

function parseOptionalNonNegativeInteger(value: unknown, filePath: string, fieldPath: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireNonNegativeInteger(value, filePath, fieldPath);
}

function resolveContentFiles(playbookRoot: string, contentPaths: PlaybookContentPaths, fieldPath: string): string[] {
  const files = new Set<string>();
  contentPaths.paths.forEach((entry, index) => {
    files.add(resolvePlaybookFile(playbookRoot, entry, `${PLAYBOOK_MANIFEST}: ${fieldPath}.paths[${index}]`));
  });
  contentPaths.globs.forEach((entry, index) => {
    const matches = resolvePlaybookGlob(playbookRoot, entry, `${PLAYBOOK_MANIFEST}: ${fieldPath}.globs[${index}]`);
    for (const match of matches) {
      files.add(match);
    }
  });
  return [...files].sort();
}

function resolvePlaybookFile(playbookRoot: string, relativePath: string, sourceField: string): string {
  const resolved = resolveInsidePlaybook(playbookRoot, relativePath, sourceField);
  if (!existsSync(resolved)) {
    throw new TaskRunnerError(`Missing playbook file referenced by ${sourceField}: ${resolved}. Create the file or update the manifest path.`);
  }
  if (!statSync(resolved).isFile()) {
    throw new TaskRunnerError(`Playbook path referenced by ${sourceField} is not a file: ${resolved}.`);
  }
  return resolved;
}

function resolvePlaybookGlob(playbookRoot: string, pattern: string, sourceField: string): string[] {
  resolveInsidePlaybook(playbookRoot, pattern.replace(/\*/g, "placeholder"), sourceField);
  const matches = findGlobMatches(playbookRoot, pattern);
  if (matches.length === 0) {
    throw new TaskRunnerError(`Playbook glob referenced by ${sourceField} matched no files: ${pattern}. Add matching files or update manifest.yaml.`);
  }
  return matches;
}

function resolveInsidePlaybook(playbookRoot: string, relativePath: string, sourceField: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new TaskRunnerError(`Playbook path referenced by ${sourceField} must be relative to ${playbookRoot}: ${relativePath}.`);
  }
  const resolved = path.resolve(playbookRoot, relativePath);
  const relative = path.relative(playbookRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new TaskRunnerError(`Playbook path traversal is not allowed in ${sourceField}: ${relativePath}. Keep paths inside ${playbookRoot}.`);
  }
  return resolved;
}

function findGlobMatches(playbookRoot: string, pattern: string): string[] {
  const regex = globToRegex(pattern);
  const results: string[] = [];
  for (const filePath of walkFiles(playbookRoot)) {
    const relative = toPlaybookRelative(playbookRoot, filePath);
    if (regex.test(relative)) {
      results.push(filePath);
    }
  }
  return results.sort();
}

function globToRegex(pattern: string): RegExp {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    const next = pattern[index + 1];
    if (character === "*" && next === "*") {
      source += ".*";
      index += 1;
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += escapeRegex(character ?? "");
    }
  }
  return new RegExp(`${source}$`);
}

function walkFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function validateUniqueIds(entries: PlaybookMarkdownEntry[]): void {
  const seen = new Map<string, PlaybookMarkdownEntry>();
  for (const entry of entries) {
    const previous = seen.get(entry.id);
    if (previous) {
      throw new TaskRunnerError(
        `Duplicate playbook id "${entry.id}" in ${entry.absolutePath}; first declared in ${previous.absolutePath}. Use unique ids across practices and examples.`,
      );
    }
    seen.set(entry.id, entry);
  }
}

function validateRelationships(entries: PlaybookMarkdownEntry[]): void {
  const ids = new Set(entries.map((entry) => entry.id));
  for (const entry of entries) {
    for (const relatedId of [...entry.metadata.related_practices, ...entry.metadata.related_examples]) {
      if (!ids.has(relatedId)) {
        throw new TaskRunnerError(
          `Unknown playbook relationship id "${relatedId}" referenced by ${entry.absolutePath}. Add the related file or update the frontmatter reference.`,
        );
      }
    }
  }
}

function parseYaml(source: string, filePath: string): unknown {
  try {
    const yaml = require("yaml") as { parseDocument?: (input: string) => { errors: Error[]; toJSON: () => unknown } };
    if (typeof yaml.parseDocument === "function") {
      const document = yaml.parseDocument(source);
      if (document.errors.length > 0) {
        throw document.errors[0];
      }
      return document.toJSON();
    }
  } catch (error) {
    if (isYamlSyntaxError(error)) {
      throw yamlError(filePath, error);
    }
  }

  try {
    return parseSimpleYaml(source);
  } catch (error) {
    throw yamlError(filePath, error);
  }
}

function parseSimpleYaml(source: string): unknown {
  const lines = source
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((raw) => ({ raw, indent: raw.search(/\S|$/), text: raw.trim() }))
    .filter((line) => line.text.length > 0 && !line.text.startsWith("#"));
  let index = 0;

  function parseBlock(indent: number): unknown {
    if (index >= lines.length) {
      return {};
    }
    if (lines[index]?.indent === indent && lines[index]?.text.startsWith("- ")) {
      return parseArray(indent);
    }
    return parseObject(indent);
  }

  function parseObject(indent: number): UnknownRecord {
    const result: UnknownRecord = {};
    while (index < lines.length) {
      const line = lines[index];
      if (!line || line.indent < indent || line.text.startsWith("- ")) {
        break;
      }
      if (line.indent > indent) {
        throw new Error(`Unexpected indentation near "${line.text}".`);
      }
      const separator = line.text.indexOf(":");
      if (separator === -1) {
        throw new Error(`Expected key/value pair near "${line.text}".`);
      }
      const key = line.text.slice(0, separator).trim();
      const rest = line.text.slice(separator + 1).trim();
      index += 1;
      result[key] = rest.length > 0 ? parseScalar(rest) : parseBlock(indent + 2);
    }
    return result;
  }

  function parseArray(indent: number): unknown[] {
    const result: unknown[] = [];
    while (index < lines.length) {
      const line = lines[index];
      if (!line || line.indent !== indent || !line.text.startsWith("- ")) {
        break;
      }
      const item = line.text.slice(2).trim();
      index += 1;
      result.push(item.length > 0 ? parseScalar(item) : parseBlock(indent + 2));
    }
    return result;
  }

  const parsed = parseBlock(0);
  if (index < lines.length) {
    throw new Error(`Could not parse YAML near "${lines[index]?.text ?? ""}".`);
  }
  return parsed;
}

function parseScalar(value: string): unknown {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (value === "null" || value === "~") {
    return null;
  }
  if (/^-?\d+$/.test(value)) {
    return Number(value);
  }
  if (value.startsWith("[") !== value.endsWith("]")) {
    throw new Error(`Malformed inline array near "${value}".`);
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    return inner.length === 0 ? [] : inner.split(",").map((item) => parseScalar(item.trim()));
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (value.includes(": ")) {
    throw new Error(`Unsupported inline mapping near "${value}".`);
  }
  return value;
}

function requireRecord(value: unknown, filePath: string, fieldPath: string): UnknownRecord {
  if (!isRecord(value)) {
    throw validationError(filePath, fieldPath, "Expected an object.");
  }
  return value;
}

function requireString(value: unknown, filePath: string, fieldPath: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validationError(filePath, fieldPath, "Expected a non-empty string.");
  }
  return value;
}

function optionalStringArray(value: unknown, filePath: string, fieldPath: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
    throw validationError(filePath, fieldPath, "Expected an array of non-empty strings.");
  }
  return value;
}

function optionalStringArrayField(
  record: UnknownRecord,
  filePath: string,
  parentFieldPath: string,
  fieldName: string,
): Record<string, string[]> {
  if (record[fieldName] === undefined) {
    return {};
  }
  return {
    [fieldName]: optionalStringArray(record[fieldName], filePath, `${parentFieldPath}.${fieldName}`),
  };
}

function requireNonNegativeInteger(value: unknown, filePath: string, fieldPath: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw validationError(filePath, fieldPath, "Expected a non-negative integer.");
  }
  return Number(value);
}

function validationError(filePath: string, fieldPath: string, details: string): TaskRunnerError {
  return new TaskRunnerError(`Invalid playbook file ${filePath} at ${fieldPath}: ${details}`);
}

function yamlError(filePath: string, error: unknown): TaskRunnerError {
  const message = error instanceof Error ? error.message : String(error);
  return new TaskRunnerError(`Invalid YAML in playbook file ${filePath}: ${message}`);
}

function isYamlSyntaxError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name.includes("YAML") || error.message.includes("YAML") || error.message.includes("Map keys");
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSupportedPhase(value: string): value is PlaybookPhase {
  return (SUPPORTED_PLAYBOOK_PHASES as readonly string[]).includes(value);
}

function isSupportedSeverity(value: string): value is PlaybookSeverity {
  return (SUPPORTED_PLAYBOOK_SEVERITIES as readonly string[]).includes(value);
}

function readFile(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

function toPlaybookRelative(playbookRoot: string, filePath: string): string {
  return path.relative(playbookRoot, filePath).split(path.sep).join("/");
}

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
