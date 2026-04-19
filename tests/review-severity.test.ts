import { describe, expect, it } from "vitest";

import {
  AGENTWEAVER_REVIEW_BLOCKING_SEVERITIES_ENV,
  DEFAULT_REVIEW_BLOCKING_SEVERITIES,
  resolveReviewBlockingSeveritiesFromEnv,
} from "../src/review-severity.js";

describe("review severity defaults", () => {
  it("uses blocker, critical, and high by default", () => {
    expect(DEFAULT_REVIEW_BLOCKING_SEVERITIES).toEqual(["blocker", "critical", "high"]);
    expect(resolveReviewBlockingSeveritiesFromEnv({})).toEqual(["blocker", "critical", "high"]);
  });

  it("reads blocking severities from environment", () => {
    expect(resolveReviewBlockingSeveritiesFromEnv({
      [AGENTWEAVER_REVIEW_BLOCKING_SEVERITIES_ENV]: "blocker,critical",
    })).toEqual(["blocker", "critical"]);
  });
});
