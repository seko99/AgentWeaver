import { TaskRunnerError } from "../errors.js";
import type { NodeRegistry } from "./node-registry.js";
import { isPromptTemplateRef } from "./prompt-registry.js";
import type {
  ConditionSpec,
  DeclarativeFlowSpec,
  DeclarativePhaseSpec,
  DeclarativeStepSpec,
  ExpectationSpec,
  ExpandedPhaseSpec,
  StepAfterActionSpec,
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

function validateCondition(condition: ConditionSpec | undefined, path: string): void {
  if (!condition) {
    return;
  }
  if ("ref" in condition) {
    return;
  }
  if ("not" in condition) {
    validateCondition(condition.not, `${path}.not`);
    return;
  }
  if ("all" in condition) {
    condition.all.forEach((candidate, index) => validateCondition(candidate, `${path}.all[${index}]`));
    return;
  }
  if ("any" in condition) {
    condition.any.forEach((candidate, index) => validateCondition(candidate, `${path}.any[${index}]`));
    return;
  }
  if ("equals" in condition) {
    validateValueSpec(condition.equals[0], `${path}.equals[0]`);
    validateValueSpec(condition.equals[1], `${path}.equals[1]`);
    return;
  }
  if ("exists" in condition) {
    validateValueSpec(condition.exists, `${path}.exists`);
    return;
  }
  throw new TaskRunnerError(`Unsupported condition at ${path}`);
}

function validateStep(step: DeclarativeStepSpec, nodeRegistry: NodeRegistry, path: string): void {
  assert(nodeRegistry.has(step.node), `Unknown node kind '${step.node}' at ${path}.node`);
  const nodeMeta = nodeRegistry.getMeta(step.node);
  validateCondition(step.when, `${path}.when`);
  if (step.prompt) {
    assert(nodeMeta.prompt === "allowed", `Node '${step.node}' does not accept prompt binding at ${path}.prompt`);
  }
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
  if (step.stopFlowIf) {
    validateCondition(step.stopFlowIf, `${path}.stopFlowIf`);
  }
  if (step.after) {
    step.after.forEach((action, index) => validateAfterAction(action, `${path}.after[${index}]`));
  }
}

function validateExpectation(expectation: ExpectationSpec, path: string): void {
  validateCondition(expectation.when, `${path}.when`);
  if (expectation.kind === "require-artifacts") {
    validateValueSpec(expectation.paths, `${path}.paths`);
    return;
  }
  if (expectation.kind === "require-file") {
    validateValueSpec(expectation.path, `${path}.path`);
    return;
  }
  if (expectation.kind === "step-output") {
    validateValueSpec(expectation.value, `${path}.value`);
    if (expectation.equals) {
      validateValueSpec(expectation.equals, `${path}.equals`);
    }
    return;
  }
  throw new TaskRunnerError(`Unsupported expectation at ${path}`);
}

function validateAfterAction(action: StepAfterActionSpec, path: string): void {
  validateCondition(action.when, `${path}.when`);
  if (action.kind === "set-summary-from-file") {
    validateValueSpec(action.path, `${path}.path`);
    return;
  }
  throw new TaskRunnerError(`Unsupported after action at ${path}`);
}

function validatePhase(phase: DeclarativePhaseSpec, nodeRegistry: NodeRegistry, path: string): void {
  assert(phase.id.trim().length > 0, `Phase id must be non-empty at ${path}.id`);
  validateCondition(phase.when, `${path}.when`);
  phase.steps.forEach((step, index) => validateStep(step, nodeRegistry, `${path}.steps[${index}]`));
}

function validateRefPath(
  ref: string,
  phases: ExpandedPhaseSpec[],
  currentPhaseIndex: number,
  currentStepIndex: number,
  path: string,
  allowCurrentStepRef = false,
): void {
  const [scope, ...rest] = ref.split(".");
  const supportedScopes = new Set(["params", "flow", "context", "repeat", "steps"]);
  assert(supportedScopes.has(scope ?? ""), `Unsupported ref scope '${scope ?? ""}' at ${path}`);
  if (scope !== "steps") {
    return;
  }
  assert(rest.length >= 3, `Invalid step ref '${ref}' at ${path}`);
  const [phaseId, stepId, stepScope] = rest;
  assert(stepScope === "outputs" || stepScope === "value" || stepScope === "status", `Unsupported step ref scope '${stepScope}' at ${path}`);
  const phaseIndex = phases.findIndex((candidate) => candidate.id === phaseId);
  assert(phaseIndex >= 0, `Unknown phase '${phaseId}' in ref '${ref}' at ${path}`);
  const phase = phases[phaseIndex];
  if (!phase) {
    throw new TaskRunnerError(`Unknown phase '${phaseId}' in ref '${ref}' at ${path}`);
  }
  const stepIndex = phase.steps.findIndex((candidate) => candidate.id === stepId);
  assert(stepIndex >= 0, `Unknown step '${stepId}' in ref '${ref}' at ${path}`);
  const isCurrentOrFuturePhase =
    phaseIndex > currentPhaseIndex || (phaseIndex === currentPhaseIndex && stepIndex > currentStepIndex);
  const isCurrentStep = phaseIndex === currentPhaseIndex && stepIndex === currentStepIndex;
  assert(!isCurrentOrFuturePhase, `Step ref '${ref}' at ${path} must point to a previously completed step`);
  assert(allowCurrentStepRef || !isCurrentStep, `Step ref '${ref}' at ${path} must not point to the current step`);
}

function validateExpandedValueSpec(
  value: ValueSpec,
  phases: ExpandedPhaseSpec[],
  currentPhaseIndex: number,
  currentStepIndex: number,
  path: string,
  allowCurrentStepRef = false,
): void {
  if ("const" in value) {
    return;
  }
  if ("ref" in value) {
    validateRefPath(value.ref, phases, currentPhaseIndex, currentStepIndex, path, allowCurrentStepRef);
    return;
  }
  if ("artifact" in value) {
    validateExpandedValueSpec(value.artifact.taskKey, phases, currentPhaseIndex, currentStepIndex, `${path}.artifact.taskKey`, allowCurrentStepRef);
    if (value.artifact.iteration) {
      validateExpandedValueSpec(value.artifact.iteration, phases, currentPhaseIndex, currentStepIndex, `${path}.artifact.iteration`, allowCurrentStepRef);
    }
    return;
  }
  if ("artifactList" in value) {
    validateExpandedValueSpec(value.artifactList.taskKey, phases, currentPhaseIndex, currentStepIndex, `${path}.artifactList.taskKey`, allowCurrentStepRef);
    return;
  }
  if ("template" in value) {
    Object.entries(value.vars ?? {}).forEach(([key, candidate]) =>
      validateExpandedValueSpec(candidate, phases, currentPhaseIndex, currentStepIndex, `${path}.vars.${key}`, allowCurrentStepRef),
    );
    return;
  }
  if ("appendPrompt" in value) {
    if (value.appendPrompt.base) {
      validateExpandedValueSpec(value.appendPrompt.base, phases, currentPhaseIndex, currentStepIndex, `${path}.appendPrompt.base`, allowCurrentStepRef);
    }
    validateExpandedValueSpec(value.appendPrompt.suffix, phases, currentPhaseIndex, currentStepIndex, `${path}.appendPrompt.suffix`, allowCurrentStepRef);
    return;
  }
  if ("concat" in value) {
    value.concat.forEach((candidate, index) =>
      validateExpandedValueSpec(candidate, phases, currentPhaseIndex, currentStepIndex, `${path}.concat[${index}]`, allowCurrentStepRef),
    );
    return;
  }
  if ("list" in value) {
    value.list.forEach((candidate, index) =>
      validateExpandedValueSpec(candidate, phases, currentPhaseIndex, currentStepIndex, `${path}.list[${index}]`, allowCurrentStepRef),
    );
  }
}

function validateExpandedCondition(
  condition: ConditionSpec | undefined,
  phases: ExpandedPhaseSpec[],
  currentPhaseIndex: number,
  currentStepIndex: number,
  path: string,
  allowCurrentStepRef = false,
): void {
  if (!condition) {
    return;
  }
  if ("ref" in condition) {
    validateRefPath(condition.ref, phases, currentPhaseIndex, currentStepIndex, path, allowCurrentStepRef);
    return;
  }
  if ("not" in condition) {
    validateExpandedCondition(condition.not, phases, currentPhaseIndex, currentStepIndex, `${path}.not`, allowCurrentStepRef);
    return;
  }
  if ("all" in condition) {
    condition.all.forEach((candidate, index) =>
      validateExpandedCondition(candidate, phases, currentPhaseIndex, currentStepIndex, `${path}.all[${index}]`, allowCurrentStepRef),
    );
    return;
  }
  if ("any" in condition) {
    condition.any.forEach((candidate, index) =>
      validateExpandedCondition(candidate, phases, currentPhaseIndex, currentStepIndex, `${path}.any[${index}]`, allowCurrentStepRef),
    );
    return;
  }
  if ("equals" in condition) {
    validateExpandedValueSpec(condition.equals[0], phases, currentPhaseIndex, currentStepIndex, `${path}.equals[0]`, allowCurrentStepRef);
    validateExpandedValueSpec(condition.equals[1], phases, currentPhaseIndex, currentStepIndex, `${path}.equals[1]`, allowCurrentStepRef);
    return;
  }
  if ("exists" in condition) {
    validateExpandedValueSpec(condition.exists, phases, currentPhaseIndex, currentStepIndex, `${path}.exists`, allowCurrentStepRef);
  }
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
  for (const [phaseIndex, phase] of phases.entries()) {
    if (ids.has(phase.id)) {
      throw new TaskRunnerError(`Duplicate expanded phase id: ${phase.id}`);
    }
    ids.add(phase.id);
    validateExpandedCondition(phase.when, phases, phaseIndex, 0, `phases.${phase.id}.when`);
    const stepIds = new Set<string>();
    for (const [stepIndex, step] of phase.steps.entries()) {
      if (stepIds.has(step.id)) {
        throw new TaskRunnerError(`Duplicate step id '${step.id}' inside phase '${phase.id}'`);
      }
      stepIds.add(step.id);
      validateExpandedCondition(step.when, phases, phaseIndex, stepIndex, `phases.${phase.id}.steps.${step.id}.when`);
      if (step.prompt?.vars) {
        Object.entries(step.prompt.vars).forEach(([key, value]) =>
          validateExpandedValueSpec(value, phases, phaseIndex, stepIndex, `phases.${phase.id}.steps.${step.id}.prompt.vars.${key}`),
        );
      }
      if (step.prompt?.extraPrompt) {
        validateExpandedValueSpec(step.prompt.extraPrompt, phases, phaseIndex, stepIndex, `phases.${phase.id}.steps.${step.id}.prompt.extraPrompt`);
      }
      if (step.params) {
        Object.entries(step.params).forEach(([key, value]) =>
          validateExpandedValueSpec(value, phases, phaseIndex, stepIndex, `phases.${phase.id}.steps.${step.id}.params.${key}`),
        );
      }
      if (step.expect) {
        step.expect.forEach((expectation, index) => {
          validateExpandedCondition(expectation.when, phases, phaseIndex, stepIndex, `phases.${phase.id}.steps.${step.id}.expect[${index}].when`);
          if (expectation.kind === "require-artifacts") {
            validateExpandedValueSpec(expectation.paths, phases, phaseIndex, stepIndex, `phases.${phase.id}.steps.${step.id}.expect[${index}].paths`);
            return;
          }
          if (expectation.kind === "require-file") {
            validateExpandedValueSpec(expectation.path, phases, phaseIndex, stepIndex, `phases.${phase.id}.steps.${step.id}.expect[${index}].path`);
            return;
          }
          validateExpandedValueSpec(expectation.value, phases, phaseIndex, stepIndex, `phases.${phase.id}.steps.${step.id}.expect[${index}].value`);
          if (expectation.equals) {
            validateExpandedValueSpec(expectation.equals, phases, phaseIndex, stepIndex, `phases.${phase.id}.steps.${step.id}.expect[${index}].equals`);
          }
        });
      }
      validateExpandedCondition(step.stopFlowIf, phases, phaseIndex, stepIndex, `phases.${phase.id}.steps.${step.id}.stopFlowIf`, true);
      if (step.after) {
        step.after.forEach((action, index) => {
          validateExpandedCondition(action.when, phases, phaseIndex, stepIndex, `phases.${phase.id}.steps.${step.id}.after[${index}].when`);
          validateExpandedValueSpec(action.path, phases, phaseIndex, stepIndex, `phases.${phase.id}.steps.${step.id}.after[${index}].path`);
        });
      }
    }
  }
}
