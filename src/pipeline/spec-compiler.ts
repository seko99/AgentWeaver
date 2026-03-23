import type { JsonValue } from "../executors/types.js";
import type { ExpandedPhaseSpec, ExpandedStepSpec } from "./spec-types.js";
import type { DeclarativeFlowSpec, DeclarativePhaseSpec, RepeatPhaseSpec } from "./spec-types.js";

function interpolateText(template: string, repeatVars: Record<string, JsonValue>): string {
  let result = template;
  for (const [key, value] of Object.entries(repeatVars)) {
    result = result.replaceAll(`\${${key}}`, String(value));
  }
  return result;
}

function expandPhase(phase: DeclarativePhaseSpec, repeatVars: Record<string, JsonValue>): ExpandedPhaseSpec {
  return {
    id: interpolateText(phase.id, repeatVars),
    repeatVars,
    ...(phase.when ? { when: phase.when } : {}),
    steps: phase.steps.map<ExpandedStepSpec>((step) => ({
      id: interpolateText(step.id, repeatVars),
      node: step.node,
      ...(step.when ? { when: step.when } : {}),
      ...(step.prompt ? { prompt: step.prompt } : {}),
      ...(step.params ? { params: step.params } : {}),
      ...(step.expect ? { expect: step.expect } : {}),
      ...(step.after ? { after: step.after } : {}),
      repeatVars,
    })),
  };
}

function expandRepeat(block: RepeatPhaseSpec): ExpandedPhaseSpec[] {
  const phases: ExpandedPhaseSpec[] = [];
  for (let index = block.repeat.from; index <= block.repeat.to; index += 1) {
    const repeatVars: Record<string, JsonValue> = {
      [block.repeat.var]: index,
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
