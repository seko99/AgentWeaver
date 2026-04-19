export function parseReviewIterationCandidate(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return undefined;
  }
  return value;
}

export function resolveReviewLoopBaseIteration(params: Record<string, unknown>): number | undefined {
  const baseIteration = parseReviewIterationCandidate(params["baseIteration"]);
  if (baseIteration !== undefined) {
    return baseIteration;
  }
  return parseReviewIterationCandidate(params["iteration"]);
}

export function withCanonicalReviewLoopParams(
  flowKind: string,
  params: Record<string, unknown>,
): Record<string, unknown> {
  if (flowKind !== "review-loop-flow" && flowKind !== "review-project-loop-flow") {
    return params;
  }

  const baseIteration = resolveReviewLoopBaseIteration(params);
  if (baseIteration === undefined) {
    return params;
  }

  return {
    ...params,
    baseIteration,
  };
}
