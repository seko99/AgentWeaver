import { TaskRunnerError } from "./errors.js";

export const REVIEW_SEVERITIES = ["blocker", "critical", "high", "medium", "low", "info"] as const;
export const AGENTWEAVER_REVIEW_BLOCKING_SEVERITIES_ENV = "AGENTWEAVER_REVIEW_BLOCKING_SEVERITIES";

export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number];

export const DEFAULT_REVIEW_BLOCKING_SEVERITIES: ReviewSeverity[] = ["blocker", "critical", "high"];

const REVIEW_SEVERITY_SET = new Set<string>(REVIEW_SEVERITIES);

export function normalizeReviewSeverity(value: unknown): ReviewSeverity | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return REVIEW_SEVERITY_SET.has(normalized) ? (normalized as ReviewSeverity) : null;
}

export function normalizeReviewSeverityList(values: readonly unknown[]): ReviewSeverity[] {
  const result: ReviewSeverity[] = [];
  for (const value of values) {
    const normalized = normalizeReviewSeverity(value);
    if (!normalized || result.includes(normalized)) {
      continue;
    }
    result.push(normalized);
  }
  return result;
}

export function resolveBlockingReviewSeverities(values?: readonly unknown[] | null): ReviewSeverity[] {
  const normalized = Array.isArray(values) ? normalizeReviewSeverityList(values) : [];
  return normalized.length > 0 ? normalized : [...DEFAULT_REVIEW_BLOCKING_SEVERITIES];
}

export function parseReviewSeverityCsv(raw: string): ReviewSeverity[] {
  const values = raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const normalized = normalizeReviewSeverityList(values);
  if (values.length === 0 || normalized.length !== values.length) {
    throw new TaskRunnerError(
      `Invalid review severity list '${raw}'. Allowed values: ${REVIEW_SEVERITIES.join(", ")}.`,
    );
  }
  return normalized;
}

export function resolveReviewBlockingSeveritiesFromEnv(env: NodeJS.ProcessEnv = process.env): ReviewSeverity[] {
  const raw = env[AGENTWEAVER_REVIEW_BLOCKING_SEVERITIES_ENV]?.trim();
  if (!raw) {
    return [...DEFAULT_REVIEW_BLOCKING_SEVERITIES];
  }
  return parseReviewSeverityCsv(raw);
}
