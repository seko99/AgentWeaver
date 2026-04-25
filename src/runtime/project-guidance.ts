import { existsSync } from "node:fs";
import path from "node:path";

import { TaskRunnerError } from "../errors.js";
import {
  loadProjectPlaybook,
  PLAYBOOK_DIR,
  PLAYBOOK_MANIFEST,
  type LoadedProjectPlaybook,
  type PlaybookMarkdownEntry,
  type PlaybookPhase,
  type PlaybookSeverity,
} from "./playbook.js";

export const GUIDANCE_PHASES = ["plan", "design-review", "implement", "review", "repair/review-fix"] as const;
export type GuidancePhase = (typeof GUIDANCE_PHASES)[number];
export type InvalidPlaybookPolicy = "fail_before_prompt" | "write_diagnostic_artifact";
export type ProjectGuidanceStatus = "available" | "missing_playbook" | "empty_selection" | "invalid_playbook";

export const DEFAULT_GUIDANCE_BUDGETS: Record<GuidancePhase, number> = {
  plan: 1200,
  "design-review": 1000,
  implement: 1400,
  review: 1000,
  "repair/review-fix": 1000,
};

export const DEFAULT_INLINE_THRESHOLD = 300;

export type ProjectGuidanceBudget = {
  limit: number;
  used: number;
  remaining: number;
  inline_threshold: number;
  unit: "approx_tokens";
  estimator: "chars_div_4";
};

export type ProjectGuidanceWarning = {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
};

export type ProjectGuidanceTaskSignals = {
  title: string;
  source_type: string;
  keywords: string[];
  file_globs: string[];
  referenced_paths: string[];
  languages: string[];
  frameworks: string[];
};

export type ProjectGuidanceSelectedItem = {
  id: string;
  title: string;
  kind: "practice" | "example";
  source_path: string;
  selection_reasons: string[];
  relevance_score: number;
  priority: number;
  severity: PlaybookSeverity;
  reference_only: boolean;
  reference: {
    source_path: string;
    reason: string;
  };
  inline_content?: string;
};

export type ProjectGuidanceSkippedItem = {
  id: string;
  kind: "practice" | "example" | "always_include";
  source_path: string;
  reason: string;
};

export type ProjectGuidance = {
  summary: string;
  status: ProjectGuidanceStatus;
  phase: GuidancePhase;
  source_playbook: {
    root_dir: string;
    manifest_path: string;
    exists: boolean;
    valid: boolean;
    error?: string;
  };
  task_signals: ProjectGuidanceTaskSignals;
  selected_practices: ProjectGuidanceSelectedItem[];
  selected_examples: ProjectGuidanceSelectedItem[];
  always_include: string[];
  phase_sections: string[];
  budget: ProjectGuidanceBudget;
  skipped_items: ProjectGuidanceSkippedItem[];
  warnings: ProjectGuidanceWarning[];
};

export type BuildProjectGuidanceOptions = {
  projectRoot: string;
  taskContext: unknown;
  phase: string;
  budgetLimit?: number;
  inlineThreshold?: number;
  invalidPlaybookPolicy?: InvalidPlaybookPolicy;
};

type ScoredEntry = {
  entry: PlaybookMarkdownEntry;
  score: number;
  reasons: string[];
  always: boolean;
};

const LANGUAGE_HINTS = ["typescript", "javascript", "node", "go", "golang", "python", "react", "vue", "svelte"];
const FRAMEWORK_HINTS = ["express", "fastify", "nestjs", "react", "vite", "vitest", "node:test", "jest", "ink"];

export function normalizeGuidancePhase(value: string): GuidancePhase {
  const normalized = value.trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "design_review") {
    return "design-review";
  }
  if (normalized === "repair" || normalized === "review-fix") {
    return "repair/review-fix";
  }
  if (GUIDANCE_PHASES.includes(normalized as GuidancePhase)) {
    return normalized as GuidancePhase;
  }
  throw new TaskRunnerError(`Unsupported project guidance phase '${value}'. Supported phases: ${GUIDANCE_PHASES.join(", ")}.`);
}

export function toPlaybookPhase(phase: GuidancePhase): PlaybookPhase {
  switch (phase) {
    case "design-review":
      return "design_review";
    case "repair/review-fix":
      return "repair";
    default:
      return phase;
  }
}

export function getDefaultGuidanceBudget(phase: GuidancePhase): { limit: number; inlineThreshold: number } {
  return { limit: DEFAULT_GUIDANCE_BUDGETS[phase], inlineThreshold: DEFAULT_INLINE_THRESHOLD };
}

export function estimateApproxTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

export function extractTaskSignals(taskContext: unknown): ProjectGuidanceTaskSignals {
  const values: string[] = [];
  collectStrings(taskContext, values);
  const joined = values.join("\n");
  const keywords = Array.from(new Set(joined.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? []))
    .filter((word) => !STOP_WORDS.has(word))
    .sort();
  const referencedPaths = Array.from(new Set(joined.match(/(?:^|\s)([./]?[A-Za-z0-9_.@-]+\/[A-Za-z0-9_./@-]+)/g)?.map((item) => item.trim()) ?? []))
    .map((item) => item.replace(/^["'`]|["'`,.;:]$/g, ""))
    .sort();
  const languages = LANGUAGE_HINTS.filter((hint) => keywords.includes(hint));
  const frameworks = FRAMEWORK_HINTS.filter((hint) => keywords.includes(hint));
  const record = isRecord(taskContext) ? taskContext : {};
  return {
    title: firstString(record.title, record.summary, record.key) || "Untitled task",
    source_type: firstString(record.source_type, record.sourceType) || "unknown",
    keywords,
    file_globs: referencedPaths,
    referenced_paths: referencedPaths,
    languages,
    frameworks,
  };
}

export function buildProjectGuidance(options: BuildProjectGuidanceOptions): ProjectGuidance {
  const phase = normalizeGuidancePhase(options.phase);
  const playbookRoot = path.join(path.resolve(options.projectRoot), PLAYBOOK_DIR);
  const manifestPath = path.join(playbookRoot, PLAYBOOK_MANIFEST);
  const defaults = getDefaultGuidanceBudget(phase);
  const budget = makeBudget(options.budgetLimit ?? defaults.limit, options.inlineThreshold ?? defaults.inlineThreshold);
  const taskSignals = extractTaskSignals(options.taskContext);

  if (!existsSync(manifestPath)) {
    return {
      summary: `No project playbook manifest was found for ${phase} guidance.`,
      status: "missing_playbook",
      phase,
      source_playbook: { root_dir: playbookRoot, manifest_path: manifestPath, exists: false, valid: false },
      task_signals: taskSignals,
      selected_practices: [],
      selected_examples: [],
      always_include: [],
      phase_sections: [],
      budget,
      skipped_items: [],
      warnings: [{ code: "missing_playbook", message: "Project guidance was not generated because manifest.yaml is absent.", severity: "warning" }],
    };
  }

  let playbook: LoadedProjectPlaybook;
  try {
    playbook = loadProjectPlaybook(options.projectRoot);
  } catch (error) {
    const message = (error as Error).message;
    if ((options.invalidPlaybookPolicy ?? "fail_before_prompt") === "write_diagnostic_artifact") {
      return {
        summary: `The project playbook manifest is invalid for ${phase} guidance.`,
        status: "invalid_playbook",
        phase,
        source_playbook: { root_dir: playbookRoot, manifest_path: manifestPath, exists: true, valid: false, error: message },
        task_signals: taskSignals,
        selected_practices: [],
        selected_examples: [],
        always_include: [],
        phase_sections: [],
        budget,
        skipped_items: [],
        warnings: [{ code: "invalid_playbook", message, severity: "error" }],
      };
    }
    throw new TaskRunnerError(`Invalid project playbook ${manifestPath}: ${message}`);
  }

  const scored = [...playbook.practices, ...playbook.examples]
    .map((entry) => scoreEntry(entry, playbook, phase, taskSignals))
    .filter((entry): entry is ScoredEntry => entry !== null)
    .sort(compareScoredEntries);
  const skipped: ProjectGuidanceSkippedItem[] = [];
  const selected: ProjectGuidanceSelectedItem[] = [];
  for (const scoredEntry of scored) {
    selected.push(materializeEntry(scoredEntry, playbook, budget, skipped));
  }

  const selectedPractices = selected.filter((entry) => entry.kind === "practice");
  const selectedExamples = selected.filter((entry) => entry.kind === "example");
  const status = selected.length > 0 || playbook.alwaysInclude.length > 0 ? "available" : "empty_selection";
  return {
    summary: status === "available"
      ? `Selected compact ${phase} project guidance from manifest.yaml.`
      : `No matching project guidance was selected for ${phase}.`,
    status,
    phase,
    source_playbook: { root_dir: playbook.playbookRoot, manifest_path: playbook.manifestPath, exists: true, valid: true },
    task_signals: taskSignals,
    selected_practices: selectedPractices,
    selected_examples: selectedExamples,
    always_include: playbook.alwaysInclude,
    phase_sections: selectedPractices.map((entry) => entry.title),
    budget,
    skipped_items: skipped,
    warnings: [],
  };
}

export function renderProjectGuidanceMarkdown(guidance: ProjectGuidance, language: "en" | "ru" = "en"): string {
  if (language === "ru") {
    return renderRussianMarkdown(guidance);
  }
  return renderEnglishMarkdown(guidance);
}

function scoreEntry(
  entry: PlaybookMarkdownEntry,
  playbook: LoadedProjectPlaybook,
  phase: GuidancePhase,
  signals: ProjectGuidanceTaskSignals,
): ScoredEntry | null {
  const playbookPhase = toPlaybookPhase(phase);
  const phases = entry.metadata.phases;
  const always = playbook.alwaysInclude.includes(entry.path);
  const reasons: string[] = [];
  let score = 0;
  if (always) {
    score += 1000;
    reasons.push("always_include");
  }
  if (phases.length === 0 || phases.includes(playbookPhase)) {
    score += 100;
    reasons.push("phase_match");
  } else if (!always) {
    return null;
  }
  const appliesTo = entry.metadata.applies_to;
  const text = `${entry.id} ${entry.title} ${entry.body}`.toLowerCase();
  const keywordMatches = (appliesTo?.keywords ?? signals.keywords).filter((keyword) => signals.keywords.includes(keyword.toLowerCase()) || text.includes(keyword.toLowerCase()));
  if (keywordMatches.length > 0) {
    score += Math.min(keywordMatches.length, 10) * 8;
    reasons.push("keyword_match");
  }
  if ((appliesTo?.globs ?? []).some((glob) => signals.referenced_paths.some((filePath) => globMatches(glob, filePath)))) {
    score += 40;
    reasons.push("glob_match");
  }
  if ((appliesTo?.languages ?? []).some((language) => signals.languages.includes(language.toLowerCase()))) {
    score += 30;
    reasons.push("language_match");
  }
  if ((appliesTo?.frameworks ?? []).some((framework) => signals.frameworks.includes(framework.toLowerCase()))) {
    score += 30;
    reasons.push("framework_match");
  }
  score += (entry.metadata.priority ?? 0) * 5;
  if (entry.metadata.priority !== undefined) {
    reasons.push("priority");
  }
  score += severityWeight(entry.metadata.severity);
  if (entry.metadata.severity) {
    reasons.push("severity");
  }
  if (score <= 0) {
    return null;
  }
  return { entry, score, reasons: Array.from(new Set(reasons)), always };
}

function materializeEntry(
  scored: ScoredEntry,
  playbook: LoadedProjectPlaybook,
  budget: ProjectGuidanceBudget,
  skipped: ProjectGuidanceSkippedItem[],
): ProjectGuidanceSelectedItem {
  const safePath = containedPlaybookPath(playbook, scored.entry.path);
  const tokens = estimateApproxTokens(scored.entry.body);
  const referenceReason = scored.entry.kind === "example" ? "example_reference_only" : "over_budget";
  const item: ProjectGuidanceSelectedItem = {
    id: scored.entry.id,
    title: scored.entry.title,
    kind: scored.entry.kind,
    source_path: safePath,
    selection_reasons: scored.reasons,
    relevance_score: scored.score,
    priority: scored.entry.metadata.priority ?? 0,
    severity: scored.entry.metadata.severity ?? "info",
    reference_only: true,
    reference: { source_path: safePath, reason: referenceReason },
  };
  if (scored.entry.kind === "practice" && tokens <= budget.inline_threshold && tokens <= budget.remaining) {
    item.inline_content = scored.entry.body.trim();
    item.reference_only = false;
    item.reference.reason = "inlined";
    budget.used += tokens;
    budget.remaining = Math.max(0, budget.limit - budget.used);
  } else if (tokens > budget.inline_threshold || tokens > budget.remaining) {
    skipped.push({ id: scored.entry.id, kind: scored.entry.kind, source_path: safePath, reason: tokens > budget.inline_threshold ? "inline_threshold_exceeded" : "over_budget" });
  }
  return item;
}

function containedPlaybookPath(playbook: LoadedProjectPlaybook, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new TaskRunnerError(`Playbook reference must be relative: ${relativePath}`);
  }
  const resolved = path.resolve(playbook.playbookRoot, relativePath);
  const relative = path.relative(playbook.playbookRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new TaskRunnerError(`Playbook reference escapes ${PLAYBOOK_DIR}: ${relativePath}`);
  }
  return relative.split(path.sep).join("/");
}

function compareScoredEntries(left: ScoredEntry, right: ScoredEntry): number {
  return (
    Number(right.always) - Number(left.always) ||
    right.score - left.score ||
    (right.entry.metadata.priority ?? 0) - (left.entry.metadata.priority ?? 0) ||
    severityWeight(right.entry.metadata.severity) - severityWeight(left.entry.metadata.severity) ||
    left.entry.id.localeCompare(right.entry.id)
  );
}

function severityWeight(severity: PlaybookSeverity | undefined): number {
  if (severity === "must") {
    return 30;
  }
  if (severity === "should") {
    return 10;
  }
  return 0;
}

function makeBudget(limit: number, inlineThreshold: number): ProjectGuidanceBudget {
  return {
    limit: Math.max(0, Math.floor(limit)),
    used: 0,
    remaining: Math.max(0, Math.floor(limit)),
    inline_threshold: Math.max(0, Math.floor(inlineThreshold)),
    unit: "approx_tokens",
    estimator: "chars_div_4",
  };
}

function renderRussianMarkdown(guidance: ProjectGuidance): string {
  const lines = [`# Проектные рекомендации: ${guidance.phase}`, "", `Статус: ${guidance.status}`, "", "## Обязательные правила"];
  if (guidance.status === "missing_playbook") {
    lines.push("- Проектный playbook manifest.yaml не найден; дополнительных проектных рекомендаций нет.");
  } else if (guidance.selected_practices.length === 0) {
    lines.push("- Для этой фазы не выбраны дополнительные правила.");
  } else {
    for (const item of guidance.selected_practices) {
      lines.push(`- ${item.title} (${item.source_path}): ${item.selection_reasons.join(", ")}`);
      if (item.inline_content) {
        lines.push(`  ${item.inline_content.replace(/\n/g, " ")}`);
      }
    }
  }
  lines.push("", "## Релевантные примеры и ссылки");
  const refs = [...guidance.selected_examples, ...guidance.selected_practices.filter((item) => item.reference_only)];
  lines.push(...(refs.length === 0 ? ["- Нет релевантных ссылок."] : refs.map((item) => `- ${item.title}: ${item.source_path} (${item.reference.reason})`)));
  lines.push("", "Открывайте полные примеры только когда они напрямую релевантны текущему изменению.");
  lines.push("", "## Бюджет", `Использовано ${guidance.budget.used} из ${guidance.budget.limit} ${guidance.budget.unit}; осталось ${guidance.budget.remaining}.`);
  return `${lines.join("\n")}\n`;
}

function renderEnglishMarkdown(guidance: ProjectGuidance): string {
  const lines = [`# Project Guidance: ${guidance.phase}`, "", `Status: ${guidance.status}`, "", "## Must-Follow Rules"];
  if (guidance.status === "missing_playbook") {
    lines.push("- Project playbook manifest.yaml was not found; no additional project guidance is available.");
  } else if (guidance.selected_practices.length === 0) {
    lines.push("- No additional rules were selected for this phase.");
  } else {
    for (const item of guidance.selected_practices) {
      lines.push(`- ${item.title} (${item.source_path}): ${item.selection_reasons.join(", ")}`);
      if (item.inline_content) {
        lines.push(`  ${item.inline_content.replace(/\n/g, " ")}`);
      }
    }
  }
  lines.push("", "## Relevant Examples And References");
  const refs = [...guidance.selected_examples, ...guidance.selected_practices.filter((item) => item.reference_only)];
  lines.push(...(refs.length === 0 ? ["- No relevant references."] : refs.map((item) => `- ${item.title}: ${item.source_path} (${item.reference.reason})`)));
  lines.push("", "Open full examples only when they are directly relevant to the current change.");
  lines.push("", "## Budget", `Used ${guidance.budget.used} of ${guidance.budget.limit} ${guidance.budget.unit}; remaining ${guidance.budget.remaining}.`);
  return `${lines.join("\n")}\n`;
}

function collectStrings(value: unknown, result: string[]): void {
  if (typeof value === "string") {
    result.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, result));
    return;
  }
  if (isRecord(value)) {
    Object.values(value).forEach((item) => collectStrings(item, result));
  }
}

function firstString(...values: unknown[]): string {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function globMatches(glob: string, value: string): boolean {
  const source = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${source}$`).test(value.replace(/^\.\//, ""));
}

const STOP_WORDS = new Set([
  "and", "the", "with", "for", "from", "into", "that", "this", "when", "then", "must", "should", "will", "are", "was",
  "как", "для", "что", "это", "или", "при", "над", "под", "если",
]);
