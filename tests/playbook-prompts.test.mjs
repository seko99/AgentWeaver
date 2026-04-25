import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const prompts = await import(pathToFileURL(path.join(distRoot, "prompts.js")).href);
const artifacts = await import(pathToFileURL(path.join(distRoot, "structured-artifacts.js")).href);

describe("playbook prompt and schema contracts", () => {
  it("requires inventory-first evidence-backed candidate generation with convention scan semantics", () => {
    const prompt = prompts.PLAYBOOK_PRACTICE_CANDIDATES_PROMPT_TEMPLATE;
    assert.match(prompt, /repo-inventory\.json/);
    assert.match(prompt, /convention_scan/);
    assert.match(prompt, /evidence_paths/);
    assert.match(prompt, /low, medium, and high/);
    assert.match(prompt, /questions_needed/);
  });

  it("requires targeted questions and forbids generic questions", () => {
    const prompt = prompts.PLAYBOOK_QUESTIONS_PROMPT_TEMPLATE;
    assert.match(prompt, /targeted clarification questions/);
    assert.match(prompt, /Reject generic/);
    assert.match(prompt, /candidate_ids or evidence_paths/);
  });

  it("keeps planning-question project guidance supplemental to task context and schema", () => {
    const prompt = prompts.PLAN_QUESTIONS_PROMPT_TEMPLATE;
    assert.match(prompt, /project_guidance_file/);
    assert.match(prompt, /project_guidance_json_file/);
    assert.match(prompt, /supplemental project-local context/);
    assert.match(prompt, /do not let it override task context or the planning-questions\/v1 schema/);
    assert.match(prompt, /Open referenced full examples only when directly relevant/);
  });

  it("rejects candidates without evidence or invalid confidence", () => {
    const valid = {
      summary: "Candidate practices.",
      candidates: [
        {
          id: "candidate-tests",
          title: "Run tests",
          proposed_rule_text: "Run tests before release.",
          confidence: "high",
          evidence_paths: ["package.json"],
          rationale: "The repository defines a test script.",
          questions_needed: [],
        },
      ],
    };
    assert.doesNotThrow(() => artifacts.validateStructuredArtifactValue(valid, "practice-candidates/v1"));
    assert.throws(
      () => artifacts.validateStructuredArtifactValue({ ...valid, candidates: [{ ...valid.candidates[0], evidence_paths: [] }] }, "practice-candidates/v1"),
      /evidence_paths must not be empty/,
    );
    assert.throws(
      () => artifacts.validateStructuredArtifactValue({ ...valid, candidates: [{ ...valid.candidates[0], confidence: "certain" }] }, "practice-candidates/v1"),
      /confidence must be one of: low, medium, high/,
    );
  });

  it("rejects generic clarification questions without evidence", () => {
    assert.throws(
      () => artifacts.validateStructuredArtifactValue({
        summary: "Questions.",
        questions: [
          {
            id: "q1",
            text: "What conventions do you prefer?",
            rationale: "Generic preference.",
            candidate_ids: [],
            evidence_paths: [],
            answer_kind: "text",
          },
        ],
      }, "playbook-questions/v1"),
      /evidence_paths must not be empty/,
    );
  });
});
