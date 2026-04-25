import { TaskRunnerError } from "../errors.js";

export type PracticeCandidate = {
  id: string;
  title: string;
  proposed_rule_text: string;
  confidence: "low" | "medium" | "high";
  evidence_paths: string[];
  rationale: string;
  questions_needed: string[];
};

export type PracticeCandidatesArtifact = {
  summary: string;
  candidates: PracticeCandidate[];
};

const CONFIDENCE_VALUES = new Set(["low", "medium", "high"]);

export function validatePracticeCandidatesArtifact(artifact: PracticeCandidatesArtifact): void {
  for (const candidate of artifact.candidates) {
    if (!CONFIDENCE_VALUES.has(candidate.confidence)) {
      throw new TaskRunnerError(`Practice candidate '${candidate.id}' has unsupported confidence '${candidate.confidence}'.`);
    }
    if (!Array.isArray(candidate.evidence_paths) || candidate.evidence_paths.length === 0) {
      throw new TaskRunnerError(`Practice candidate '${candidate.id}' must cite at least one evidence path.`);
    }
  }
}
