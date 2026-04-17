import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { DESIGN_REVIEW_PROMPT_TEMPLATE } = await import(pathToFileURL(path.join(distRoot, "prompts.js")).href);

describe("DESIGN_REVIEW_PROMPT_TEMPLATE", () => {
  it("uses the dedicated design-review schema and critique dimensions", () => {
    assert.match(DESIGN_REVIEW_PROMPT_TEMPLATE, /design-review\/v1/);
    assert.doesNotMatch(DESIGN_REVIEW_PROMPT_TEMPLATE, /review-findings\/v1/);
    assert.match(DESIGN_REVIEW_PROMPT_TEMPLATE, /specification critic, not as an implementer/i);
    assert.match(DESIGN_REVIEW_PROMPT_TEMPLATE, /completeness, consistency, implementation readiness, risk coverage, QA coverage, and scope discipline/i);
    assert.match(DESIGN_REVIEW_PROMPT_TEMPLATE, /literal value 'not provided'/i);
  });

  it("documents the allowed statuses and readiness mapping", () => {
    assert.match(DESIGN_REVIEW_PROMPT_TEMPLATE, /approved, approved_with_warnings, or needs_revision/);
    assert.match(DESIGN_REVIEW_PROMPT_TEMPLATE, /needs_revision when any blocking finding exists/i);
    assert.match(
      DESIGN_REVIEW_PROMPT_TEMPLATE,
      /approved_with_warnings when there are no blocking findings, but there are major findings, warnings, non-blocking missing information items, QA coverage gaps, or non-blocking consistency issues/i,
    );
    assert.match(DESIGN_REVIEW_PROMPT_TEMPLATE, /approved only when there are no unresolved blocking findings, major findings, warnings, missing information items, or QA coverage gaps/i);
    assert.match(DESIGN_REVIEW_PROMPT_TEMPLATE, /Create ready-to-merge\.md only when status is approved or approved_with_warnings/i);
    assert.match(DESIGN_REVIEW_PROMPT_TEMPLATE, /Do not create ready-to-merge\.md when status is needs_revision/i);
  });
});
