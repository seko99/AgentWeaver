import { TaskRunnerError } from "../errors.js";
import type { NodeRegistry } from "./node-registry.js";
import { isPromptTemplateRef } from "./prompt-registry.js";
import type {
  DeclarativeFlowSpec,
  DeclarativePhaseSpec,
  DeclarativeStepSpec,
  ExpectationSpec,
  ExpandedPhaseSpec,
  ValueSpec,
} from "./spec-types.js";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new TaskRunnerError(message);
  }
}

function validateValueSpec(value: ValueSpec, path: string): void {
  if ("const" in value || "ref" in value || "artifact" in value || "artifactList" in value) {
    return;
  }
  if ("template" in value) {
    if (value.vars) {
      for (const [key, candidate] of Object.entries(value.vars)) {
        validateValueSpec(candidate, `${path}.vars.${key}`);
      }
    }
    return;
  }
  if ("appendPrompt" in value) {
    if (value.appendPrompt.base) {
      validateValueSpec(value.appendPrompt.base, `${path}.appendPrompt.base`);
    }
    validateValueSpec(value.appendPrompt.suffix, `${path}.appendPrompt.suffix`);
    return;
  }
  if ("concat" in value) {
    value.concat.forEach((candidate, index) => validateValueSpec(candidate, `${path}.concat[${index}]`));
    return;
  }
  if ("list" in value) {
    value.list.forEach((candidate, index) => validateValueSpec(candidate, `${path}.list[${index}]`));
    return;
  }
  throw new TaskRunnerError(`Unsupported value spec at ${path}`);
}

function validateStep(step: DeclarativeStepSpec, nodeRegistry: NodeRegistry, path: string): void {
  assert(nodeRegistry.has(step.node), `Unknown node kind '${step.node}' at ${path}.node`);
  if (step.prompt?.templateRef) {
    assert(isPromptTemplateRef(step.prompt.templateRef), `Unknown prompt template '${step.prompt.templateRef}' at ${path}.prompt.templateRef`);
  }
  if (step.prompt?.vars) {
    for (const [key, value] of Object.entries(step.prompt.vars)) {
      validateValueSpec(value, `${path}.prompt.vars.${key}`);
    }
  }
  if (step.prompt?.extraPrompt) {
    validateValueSpec(step.prompt.extraPrompt, `${path}.prompt.extraPrompt`);
  }
  if (step.params) {
    for (const [key, value] of Object.entries(step.params)) {
      validateValueSpec(value, `${path}.params.${key}`);
    }
  }
  if (step.expect) {
    step.expect.forEach((expectation, index) => validateExpectation(expectation, `${path}.expect[${index}]`));
  }
}

function validateExpectation(expectation: ExpectationSpec, path: string): void {
  if (expectation.kind === "require-artifacts") {
    validateValueSpec(expectation.paths, `${path}.paths`);
    return;
  }
  if (expectation.kind === "require-file") {
    validateValueSpec(expectation.path, `${path}.path`);
    return;
  }
  throw new TaskRunnerError(`Unsupported expectation at ${path}`);
}

function validatePhase(phase: DeclarativePhaseSpec, nodeRegistry: NodeRegistry, path: string): void {
  assert(phase.id.trim().length > 0, `Phase id must be non-empty at ${path}.id`);
  phase.steps.forEach((step, index) => validateStep(step, nodeRegistry, `${path}.steps[${index}]`));
}

export function validateFlowSpec(spec: DeclarativeFlowSpec, nodeRegistry: NodeRegistry): void {
  assert(spec.kind.trim().length > 0, "Flow spec kind must be non-empty");
  assert(Number.isInteger(spec.version) && spec.version > 0, "Flow spec version must be a positive integer");
  spec.phases.forEach((item, index) => {
    if ("repeat" in item) {
      assert(item.repeat.var.trim().length > 0, `Repeat var must be non-empty at phases[${index}].repeat.var`);
      assert(item.repeat.to >= item.repeat.from, `Repeat range is invalid at phases[${index}].repeat`);
      item.phases.forEach((phase, phaseIndex) => validatePhase(phase, nodeRegistry, `phases[${index}].phases[${phaseIndex}]`));
      return;
    }
    validatePhase(item, nodeRegistry, `phases[${index}]`);
  });
}

export function validateExpandedPhases(phases: ExpandedPhaseSpec[]): void {
  const ids = new Set<string>();
  for (const phase of phases) {
    if (ids.has(phase.id)) {
      throw new TaskRunnerError(`Duplicate expanded phase id: ${phase.id}`);
    }
    ids.add(phase.id);
    const stepIds = new Set<string>();
    for (const step of phase.steps) {
      if (stepIds.has(step.id)) {
        throw new TaskRunnerError(`Duplicate step id '${step.id}' inside phase '${phase.id}'`);
      }
      stepIds.add(step.id);
    }
  }
}
