import type { JsonValue } from "../executors/types.js";
import type { ExpandedPhaseSpec, ExpandedStepSpec } from "./spec-types.js";
import type {
  ConditionSpec,
  DeclarativeFlowSpec,
  DeclarativePhaseSpec,
  ExpectationSpec,
  PromptBindingSpec,
  RepeatPhaseSpec,
  StepAfterActionSpec,
  ValueSpec,
} from "./spec-types.js";

function interpolateText(template: string, repeatVars: Record<string, JsonValue>): string {
  let result = template;
  for (const [key, value] of Object.entries(repeatVars)) {
    result = result.replaceAll(`\${${key}}`, String(value));
  }
  return result;
}

function interpolateValueSpec(value: ValueSpec, repeatVars: Record<string, JsonValue>): ValueSpec {
  if ("const" in value || "artifact" in value || "artifactList" in value || "list" in value) {
    if ("artifact" in value) {
      return {
        artifact: {
          ...value.artifact,
          taskKey: interpolateValueSpec(value.artifact.taskKey, repeatVars),
          ...(value.artifact.iteration ? { iteration: interpolateValueSpec(value.artifact.iteration, repeatVars) } : {}),
        },
      };
    }
    if ("artifactList" in value) {
      return {
        artifactList: {
          ...value.artifactList,
          taskKey: interpolateValueSpec(value.artifactList.taskKey, repeatVars),
        },
      };
    }
    if ("list" in value) {
      return {
        list: value.list.map((candidate) => interpolateValueSpec(candidate, repeatVars)),
      };
    }
    return value;
  }
  if ("ref" in value) {
    return {
      ref: interpolateText(value.ref, repeatVars),
    };
  }
  if ("template" in value) {
    return {
      template: interpolateText(value.template, repeatVars),
      ...(value.vars
        ? {
            vars: Object.fromEntries(
              Object.entries(value.vars).map(([key, candidate]) => [key, interpolateValueSpec(candidate, repeatVars)]),
            ),
          }
        : {}),
    };
  }
  if ("appendPrompt" in value) {
    return {
      appendPrompt: {
        ...(value.appendPrompt.base ? { base: interpolateValueSpec(value.appendPrompt.base, repeatVars) } : {}),
        suffix: interpolateValueSpec(value.appendPrompt.suffix, repeatVars),
      },
    };
  }
  if ("add" in value) {
    return {
      add: value.add.map((candidate) => interpolateValueSpec(candidate, repeatVars)),
    };
  }
  if ("concat" in value) {
    return {
      concat: value.concat.map((candidate) => interpolateValueSpec(candidate, repeatVars)),
    };
  }
  return value;
}

function interpolateCondition(condition: ConditionSpec | undefined, repeatVars: Record<string, JsonValue>): ConditionSpec | undefined {
  if (!condition) {
    return undefined;
  }
  if ("ref" in condition) {
    return {
      ref: interpolateText(condition.ref, repeatVars),
    };
  }
  if ("not" in condition) {
    return {
      not: interpolateCondition(condition.not, repeatVars) as ConditionSpec,
    };
  }
  if ("all" in condition) {
    return {
      all: condition.all.map((candidate) => interpolateCondition(candidate, repeatVars) as ConditionSpec),
    };
  }
  if ("any" in condition) {
    return {
      any: condition.any.map((candidate) => interpolateCondition(candidate, repeatVars) as ConditionSpec),
    };
  }
  if ("equals" in condition) {
    return {
      equals: [
        interpolateValueSpec(condition.equals[0], repeatVars),
        interpolateValueSpec(condition.equals[1], repeatVars),
      ],
    };
  }
  if ("exists" in condition) {
    return {
      exists: interpolateValueSpec(condition.exists, repeatVars),
    };
  }
  return condition;
}

function interpolatePrompt(prompt: PromptBindingSpec, repeatVars: Record<string, JsonValue>): PromptBindingSpec {
  return {
    ...(prompt.templateRef ? { templateRef: prompt.templateRef } : {}),
    ...(prompt.inlineTemplate ? { inlineTemplate: interpolateText(prompt.inlineTemplate, repeatVars) } : {}),
    ...(prompt.vars
      ? {
          vars: Object.fromEntries(
            Object.entries(prompt.vars).map(([key, candidate]) => [key, interpolateValueSpec(candidate, repeatVars)]),
          ),
        }
      : {}),
    ...(prompt.extraPrompt ? { extraPrompt: interpolateValueSpec(prompt.extraPrompt, repeatVars) } : {}),
    ...(prompt.format ? { format: prompt.format } : {}),
  };
}

function interpolateExpectation(expectation: ExpectationSpec, repeatVars: Record<string, JsonValue>): ExpectationSpec {
  if (expectation.kind === "require-artifacts") {
    const when = expectation.when ? interpolateCondition(expectation.when, repeatVars) : undefined;
    return {
      kind: expectation.kind,
      ...(when ? { when } : {}),
      paths: interpolateValueSpec(expectation.paths, repeatVars),
      message: interpolateText(expectation.message, repeatVars),
    };
  }
  if (expectation.kind === "require-structured-artifacts") {
    const when = expectation.when ? interpolateCondition(expectation.when, repeatVars) : undefined;
    return {
      kind: expectation.kind,
      ...(when ? { when } : {}),
      items: expectation.items.map((item) => ({
        path: interpolateValueSpec(item.path, repeatVars),
        schemaId: item.schemaId,
      })),
      message: interpolateText(expectation.message, repeatVars),
    };
  }
  const when = expectation.when ? interpolateCondition(expectation.when, repeatVars) : undefined;
  if (expectation.kind === "require-file") {
    return {
      kind: expectation.kind,
      ...(when ? { when } : {}),
      path: interpolateValueSpec(expectation.path, repeatVars),
      message: interpolateText(expectation.message, repeatVars),
    };
  }
  return {
    kind: expectation.kind,
    ...(when ? { when } : {}),
    value: interpolateValueSpec(expectation.value, repeatVars),
    ...(expectation.equals ? { equals: interpolateValueSpec(expectation.equals, repeatVars) } : {}),
    message: interpolateText(expectation.message, repeatVars),
  };
}

function interpolateAfterAction(action: StepAfterActionSpec, repeatVars: Record<string, JsonValue>): StepAfterActionSpec {
  const when = action.when ? interpolateCondition(action.when, repeatVars) : undefined;
  return {
    kind: action.kind,
    ...(when ? { when } : {}),
    path: interpolateValueSpec(action.path, repeatVars),
  };
}

function expandPhase(phase: DeclarativePhaseSpec, repeatVars: Record<string, JsonValue>): ExpandedPhaseSpec {
  const phaseWhen = phase.when ? interpolateCondition(phase.when, repeatVars) : undefined;
  return {
    id: interpolateText(phase.id, repeatVars),
    repeatVars,
    ...(phaseWhen ? { when: phaseWhen } : {}),
    steps: phase.steps.map<ExpandedStepSpec>((step) => {
      const stepWhen = step.when ? interpolateCondition(step.when, repeatVars) : undefined;
      const stopFlowIf = step.stopFlowIf ? interpolateCondition(step.stopFlowIf, repeatVars) : undefined;
      return {
        id: interpolateText(step.id, repeatVars),
        node: step.node,
        ...(step.routingGroup ? { routingGroup: step.routingGroup } : {}),
        ...(stepWhen ? { when: stepWhen } : {}),
        ...(step.prompt ? { prompt: interpolatePrompt(step.prompt, repeatVars) } : {}),
        ...(step.params
          ? {
              params: Object.fromEntries(
                Object.entries(step.params).map(([key, value]) => [key, interpolateValueSpec(value, repeatVars)]),
              ),
            }
          : {}),
        ...(step.expect ? { expect: step.expect.map((item) => interpolateExpectation(item, repeatVars)) } : {}),
        ...(stopFlowIf ? { stopFlowIf } : {}),
        ...(step.stopFlowOutcome ? { stopFlowOutcome: step.stopFlowOutcome } : {}),
        ...(step.after ? { after: step.after.map((item) => interpolateAfterAction(item, repeatVars)) } : {}),
        repeatVars,
      };
    }),
  };
}

function expandRepeat(block: RepeatPhaseSpec): ExpandedPhaseSpec[] {
  const phases: ExpandedPhaseSpec[] = [];
  for (let index = block.repeat.from; index <= block.repeat.to; index += 1) {
    const repeatVars: Record<string, JsonValue> = {
      [block.repeat.var]: index,
      [`${block.repeat.var}_minus_one`]: index - 1,
    };
    for (const phase of block.phases) {
      phases.push(expandPhase(phase, repeatVars));
    }
  }
  return phases;
}

export function compileFlowSpec(spec: DeclarativeFlowSpec): ExpandedPhaseSpec[] {
  const phases: ExpandedPhaseSpec[] = [];
  for (const item of spec.phases) {
    if ("repeat" in item) {
      phases.push(...expandRepeat(item));
      continue;
    }
    phases.push(expandPhase(item, {}));
  }
  return phases;
}
