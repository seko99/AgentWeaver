import path from "node:path";

import type { FlowCatalogEntry } from "../pipeline/flow-catalog.js";
import { flowRoutingGroups, flowRoutingKey } from "../pipeline/flow-catalog.js";
import { loadNamedDeclarativeFlow, type LoadedDeclarativeFlow } from "../pipeline/declarative-flows.js";
import {
  EXECUTION_ROUTING_GROUPS,
  type ExecutionRoutingGroup,
  type ResolvedExecutionRouting,
  type SelectedExecutionPreset,
} from "../pipeline/execution-routing-config.js";
import {
  DEFAULT_LAUNCH_PROFILE,
  defaultModelForExecutor,
  isAllowedModelForExecutor,
  type LlmExecutorId,
} from "../pipeline/launch-profile-config.js";
import { FlowInterruptedError, TaskRunnerError } from "../errors.js";
import type { UserInputFieldDefinition, UserInputFormDefinition, UserInputFormValues, UserInputRequester } from "../user-input.js";
import {
  BUILT_IN_EXECUTION_PRESETS,
  builtInExecutionPresetList,
  modelOptionsForExecutor,
  resolveExecutionRouting,
  resolveStoredExecutionRoutingSnapshot,
  routingGroupLabel,
} from "./execution-routing.js";
import {
  getFlowDefaultExecutionRouting,
  getLastUsedExecutionRouting,
  getNamedExecutionPresets,
  saveFlowDefaultExecutionRouting,
  saveLastUsedExecutionRouting,
  saveNamedExecutionPreset,
} from "./execution-routing-store.js";

type EditableRouteDraft = {
  executor: LlmExecutorId;
  model: string;
};

type EditableExecutionRoutingDraft = {
  defaultRoute: EditableRouteDraft;
  groups: Record<ExecutionRoutingGroup, EditableRouteDraft>;
};

function executionPresetSelectionForm(
  flowEntry: FlowCatalogEntry,
  flowDefaultAvailable: boolean,
  lastUsedAvailable: boolean,
  namedPresetNames: string[],
): UserInputFormDefinition {
  const options = [];
  if (flowDefaultAvailable) {
    options.push({
      value: "flow-default",
      label: "Flow default",
      description: "Use the saved routing snapshot for this flow.",
    });
  }
  if (lastUsedAvailable) {
    options.push({
      value: "last-used",
      label: "Last used",
      description: "Reuse the most recent routing started for this flow.",
    });
  }
  for (const preset of builtInExecutionPresetList()) {
    options.push({
      value: `built-in:${preset.id}`,
      label: preset.label,
      description: preset.description,
    });
  }
  for (const name of namedPresetNames) {
    options.push({
      value: `named:${name}`,
      label: `Named preset: ${name}`,
      description: "Reuse a saved routing snapshot across flows.",
    });
  }
  options.push({
    value: "custom",
    label: "Custom",
    description: "Start from the default route and edit the fallback route plus routing groups manually.",
  });
  return {
    formId: "flow-execution-preset",
    title: "Execution Routing",
    description: `Select an execution strategy for '${flowEntry.id}'.`,
    submitLabel: "Continue",
    fields: [
      {
        id: "preset",
        type: "single-select",
        label: "Preset",
        required: true,
        default: options[0]?.value ?? "custom",
        options,
      },
    ],
  };
}

function executorFieldOptions(): Array<{ value: string; label: string }> {
  return [
    { value: "codex", label: "codex" },
    { value: "opencode", label: "opencode" },
  ];
}

function selectedExecutorFromValues(
  values: UserInputFormValues,
  fieldId: string,
  fallbackExecutor: LlmExecutorId,
): LlmExecutorId {
  const candidate = values[fieldId];
  return candidate === "codex" || candidate === "opencode" ? candidate : fallbackExecutor;
}

function routingEditorDraftFromRouting(routing: ResolvedExecutionRouting): EditableExecutionRoutingDraft {
  return {
    defaultRoute: {
      executor: routing.defaultRoute.executor,
      model: routing.defaultRoute.model,
    },
    groups: Object.fromEntries(
      EXECUTION_ROUTING_GROUPS.map((group) => [
        group,
        {
          executor: routing.groups[group].executor,
          model: routing.groups[group].model,
        },
      ]),
    ) as Record<ExecutionRoutingGroup, EditableRouteDraft>,
  };
}

function advancedRoutingEditorForm(
  activeGroups: readonly ExecutionRoutingGroup[],
  draft: EditableExecutionRoutingDraft,
  validationMessage?: string,
): UserInputFormDefinition {
  const fields: UserInputFieldDefinition[] = [
    {
      id: "default_route_executor",
      type: "single-select",
      label: "Default route executor",
      required: true,
      default: draft.defaultRoute.executor,
      options: executorFieldOptions(),
    },
    {
      id: "default_route_model",
      type: "single-select",
      label: "Default route model",
      help: "Available models follow the selected default executor.",
      required: true,
      default: draft.defaultRoute.model,
      options: modelOptionsForExecutor(draft.defaultRoute.executor),
      optionsFromValues: (values) =>
        modelOptionsForExecutor(
          selectedExecutorFromValues(values, "default_route_executor", draft.defaultRoute.executor),
        ),
    },
    ...activeGroups.flatMap<UserInputFieldDefinition>((group) => {
      const route = draft.groups[group];
      return [
        {
          id: `${group}_executor`,
          type: "single-select",
          label: `${routingGroupLabel(group)} executor`,
          required: true,
          default: route.executor,
          options: executorFieldOptions(),
        },
        {
          id: `${group}_model`,
          type: "single-select",
          label: `${routingGroupLabel(group)} model`,
          help: `Available models follow the selected ${routingGroupLabel(group)} executor.`,
          required: true,
          default: route.model,
          options: modelOptionsForExecutor(route.executor),
          optionsFromValues: (values) =>
            modelOptionsForExecutor(
              selectedExecutorFromValues(values, `${group}_executor`, route.executor),
            ),
        },
      ];
    }),
  ];
  return {
    formId: "flow-routing-editor",
    title: "Advanced Routing",
    description: validationMessage
      ? `${activeGroups.length > 0
        ? "Edit the fallback route plus executor and model by routing group."
        : "Edit the fallback executor and model used by this flow."}\n\n${validationMessage}`
      : activeGroups.length > 0
        ? "Edit the fallback route plus executor and model by routing group."
        : "Edit the fallback executor and model used by this flow.",
    submitLabel: "Apply",
    fields,
  };
}

function routingActionForm(previewText: string): UserInputFormDefinition {
  return {
    formId: "flow-routing-action",
    title: "Routing Preview",
    description: "Review the effective routing and choose the next action.",
    preview: previewText,
    submitLabel: "Continue",
    fields: [
      {
        id: "action",
        type: "single-select",
        label: "Action",
        required: true,
        default: "start",
        options: [
          { value: "start", label: "Start", description: "Run the flow with the previewed routing." },
          { value: "edit", label: "Edit routing", description: "Open the advanced routing editor." },
          { value: "cancel", label: "Cancel", description: "Abort launching this flow." },
        ],
      },
    ],
  };
}

function routingPersistenceForm(): UserInputFormDefinition {
  return {
    formId: "flow-routing-persistence",
    title: "Save Routing",
    description: "Choose how to persist the edited routing.",
    submitLabel: "Continue",
    fields: [
      {
        id: "persistence",
        type: "single-select",
        label: "Save mode",
        required: true,
        default: "current-run",
        options: [
          { value: "current-run", label: "Current run only", description: "Use the edited routing only for this start." },
          { value: "flow-default", label: "Flow default", description: "Reuse this routing automatically for this flow." },
          { value: "named-preset", label: "Named preset", description: "Save this routing as a reusable preset." },
        ],
      },
    ],
  };
}

function presetNameForm(): UserInputFormDefinition {
  return {
    formId: "flow-routing-preset-name",
    title: "Preset Name",
    description: "Enter a reusable name for the routing preset.",
    submitLabel: "Save",
    fields: [
      {
        id: "name",
        type: "text",
        label: "Preset name",
        required: true,
      },
    ],
  };
}

function normalizeEditableRoute(label: string, route: EditableRouteDraft): {
  route: EditableRouteDraft;
  validationErrors: string[];
} {
  if (isAllowedModelForExecutor(route.executor, route.model)) {
    return {
      route: { ...route },
      validationErrors: [],
    };
  }
  return {
    route: {
      executor: route.executor,
      model: defaultModelForExecutor(route.executor),
    },
    validationErrors: [
      `${label} model '${route.model}' is not allowed for executor '${route.executor}'. Select a ${route.executor} model.`,
    ],
  };
}

function normalizeEditableRoutingDraft(draft: EditableExecutionRoutingDraft): {
  draft: EditableExecutionRoutingDraft;
  currentRunOverrides: Partial<Record<ExecutionRoutingGroup, EditableRouteDraft>>;
  validationErrors: string[];
} {
  const defaultRoute = normalizeEditableRoute("Default route", draft.defaultRoute);
  const groups = {} as Record<ExecutionRoutingGroup, EditableRouteDraft>;
  const currentRunOverrides = {} as Partial<Record<ExecutionRoutingGroup, EditableRouteDraft>>;
  const validationErrors = [...defaultRoute.validationErrors];
  for (const group of EXECUTION_ROUTING_GROUPS) {
    const normalizedRoute = normalizeEditableRoute(routingGroupLabel(group), draft.groups[group]);
    groups[group] = normalizedRoute.route;
    if (
      normalizedRoute.route.executor !== defaultRoute.route.executor
      || normalizedRoute.route.model !== defaultRoute.route.model
    ) {
      currentRunOverrides[group] = normalizedRoute.route;
    }
    validationErrors.push(...normalizedRoute.validationErrors);
  }
  return {
    draft: {
      defaultRoute: defaultRoute.route,
      groups,
    },
    currentRunOverrides,
    validationErrors,
  };
}

type EffectiveRoutedStepRow = {
  step: string;
  group: string;
  executor: string;
  model: string;
};

function normalizedEffectiveStepSignature(row: EffectiveRoutedStepRow): string {
  const normalizedStep = row.step.replace(/review_iteration_\d+/g, "review_iteration_*");
  return [normalizedStep, row.group, row.executor, row.model].join("\u0000");
}

function collapseRepeatedEffectiveRoutedStepRows(rows: EffectiveRoutedStepRow[]): EffectiveRoutedStepRow[] {
  const seen = new Set<string>();
  const collapsed: EffectiveRoutedStepRow[] = [];
  for (const row of rows) {
    const signature = normalizedEffectiveStepSignature(row);
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    collapsed.push(row);
  }
  return collapsed;
}

function truncateTableCell(value: string, maxWidth: number): string {
  if (value.length <= maxWidth) {
    return value;
  }
  if (maxWidth <= 1) {
    return value.slice(0, maxWidth);
  }
  return `${value.slice(0, maxWidth - 1)}…`;
}

function formatAsciiTable(headers: string[], rows: string[][], maxWidths: number[]): string[] {
  const widths = headers.map((header, index) =>
    Math.min(
      maxWidths[index] ?? Number.MAX_SAFE_INTEGER,
      Math.max(
        header.length,
        ...rows.map((row) => (row[index] ?? "").length),
      ),
    )
  );
  const formatRow = (row: string[]) =>
    `| ${row.map((cell, index) => truncateTableCell(cell ?? "", widths[index] ?? 1).padEnd(widths[index] ?? 1)).join(" | ")} |`;
  const separator = `|-${widths.map((width) => "-".repeat(width)).join("-|-")}-|`;
  return [formatRow(headers), separator, ...rows.map((row) => formatRow(row))];
}

function collectEffectiveRoutedStepRows(
  flow: LoadedDeclarativeFlow,
  cwd: string,
  routing: ResolvedExecutionRouting,
  prefixSegments: string[] = [],
  ancestry: string[] = [],
): EffectiveRoutedStepRow[] {
  if (ancestry.includes(flow.absolutePath)) {
    return [];
  }
  const nextAncestry = [...ancestry, flow.absolutePath];
  const rows: EffectiveRoutedStepRow[] = [];
  for (const phase of flow.phases) {
    for (const step of phase.steps) {
      const stepRef = `${phase.id}.${step.id}`;
      if (step.routingGroup) {
        const route = routing.groups[step.routingGroup];
        rows.push({
          step: [...prefixSegments, stepRef].join(" > "),
          group: routingGroupLabel(step.routingGroup),
          executor: route.executor,
          model: route.model,
        });
      }
      if (step.node !== "flow-run") {
        continue;
      }
      const nestedFlowName = step.params?.fileName;
      if (!nestedFlowName || !("const" in nestedFlowName) || typeof nestedFlowName.const !== "string") {
        continue;
      }
      const nestedFlow = loadNamedDeclarativeFlow(nestedFlowName.const, cwd);
      const nestedFlowLabel = path.basename(nestedFlow.fileName, path.extname(nestedFlow.fileName));
      rows.push(
        ...collectEffectiveRoutedStepRows(
          nestedFlow,
          cwd,
          routing,
          [...prefixSegments, stepRef, nestedFlowLabel],
          nextAncestry,
        ),
      );
    }
  }
  return rows;
}

export function describeEffectiveRoutingPreview(
  flowEntry: FlowCatalogEntry,
  routing: ResolvedExecutionRouting,
  cwd: string,
): string {
  const previewGroups = flowRoutingGroups(flowEntry, cwd);
  const summaryRows = [
    ["Default", routing.defaultRoute.executor, routing.defaultRoute.model],
    ...previewGroups.map((group) => [
      routingGroupLabel(group),
      routing.groups[group].executor,
      routing.groups[group].model,
    ]),
  ];
  const lines = [
    "Effective routes:",
    ...formatAsciiTable(["Scope", "Executor", "Model"], summaryRows, [18, 12, 36]),
  ];
  const routedSteps = collapseRepeatedEffectiveRoutedStepRows(
    collectEffectiveRoutedStepRows(flowEntry.flow, cwd, routing),
  );
  if (routedSteps.length === 0) {
    return lines.join("\n");
  }
  return [
    ...lines,
    "",
    "Routed LLM steps:",
    ...formatAsciiTable(
      ["Step", "Group", "Executor", "Model"],
      routedSteps.map((row) => [row.step, row.group, row.executor, row.model]),
      [64, 16, 12, 30],
    ),
  ].join("\n");
}

export async function requestInteractiveExecutionRouting(
  flowEntry: FlowCatalogEntry,
  requestUserInput: UserInputRequester,
): Promise<{ routing: ResolvedExecutionRouting; selectedPreset: SelectedExecutionPreset }> {
  const previewGroups = flowRoutingGroups(flowEntry, process.cwd());
  const flowKey = flowRoutingKey(flowEntry);
  const namedPresets = getNamedExecutionPresets();
  const flowDefault = getFlowDefaultExecutionRouting(flowKey);
  const lastUsed = getLastUsedExecutionRouting(flowKey);
  const presetSelection = await requestUserInput(
    executionPresetSelectionForm(
      flowEntry,
      Boolean(flowDefault),
      Boolean(lastUsed),
      Object.keys(namedPresets).sort((left, right) => left.localeCompare(right, "en")),
    ),
  );
  const selectedPresetValue = String(presetSelection.values.preset ?? "custom");
  let selectedPreset: SelectedExecutionPreset;
  let routing: ResolvedExecutionRouting;

  if (selectedPresetValue === "flow-default") {
    if (!flowDefault) {
      throw new TaskRunnerError("Flow default routing is unavailable.");
    }
    selectedPreset = { kind: "flow-default", label: "Flow default" };
    routing = resolveStoredExecutionRoutingSnapshot(flowDefault.routing);
  } else if (selectedPresetValue === "last-used") {
    if (!lastUsed) {
      throw new TaskRunnerError("Last-used routing is unavailable.");
    }
    selectedPreset = { kind: "last-used", label: "Last used" };
    routing = resolveStoredExecutionRoutingSnapshot(lastUsed.routing);
  } else if (selectedPresetValue.startsWith("named:")) {
    const presetName = selectedPresetValue.slice("named:".length);
    const namedPreset = namedPresets[presetName];
    if (!namedPreset) {
      throw new TaskRunnerError(`Named preset '${presetName}' is unavailable.`);
    }
    selectedPreset = { kind: "named", presetId: presetName, label: `Named preset: ${presetName}` };
    routing = resolveStoredExecutionRoutingSnapshot(namedPreset.routing);
  } else if (selectedPresetValue.startsWith("built-in:")) {
    const presetId = selectedPresetValue.slice("built-in:".length) as keyof typeof BUILT_IN_EXECUTION_PRESETS;
    const preset = BUILT_IN_EXECUTION_PRESETS[presetId];
    if (!preset) {
      throw new TaskRunnerError(`Unknown execution preset '${presetId}'.`);
    }
    selectedPreset = { kind: "built-in", presetId, label: preset.label };
    routing = resolveExecutionRouting({ presetId });
  } else {
    selectedPreset = { kind: "custom", label: "Custom" };
    routing = resolveExecutionRouting({
      defaultRoute: {
        executor: DEFAULT_LAUNCH_PROFILE.executor,
        model: DEFAULT_LAUNCH_PROFILE.model,
      },
    });
  }

  let editorDraft = routingEditorDraftFromRouting(routing);
  let editorValidationMessage: string | undefined;
  for (; ;) {
    const previewText = `Preset: ${selectedPreset.label}\n${describeEffectiveRoutingPreview(flowEntry, routing, process.cwd())}`;
    const actionResult = await requestUserInput(routingActionForm(previewText));
    const action = String(actionResult.values.action ?? "start");
    if (action === "cancel") {
      throw new FlowInterruptedError("Flow launch cancelled.");
    }
    if (action === "start") {
      saveLastUsedExecutionRouting(flowKey, routing, selectedPreset);
      return { routing, selectedPreset };
    }

    const routingFormResult = await requestUserInput(
      advancedRoutingEditorForm(previewGroups, editorDraft, editorValidationMessage),
    );
    const requestedDefaultRoute: EditableRouteDraft = {
      executor: String(
        routingFormResult.values.default_route_executor ?? editorDraft.defaultRoute.executor,
      ) as LlmExecutorId,
      model: String(routingFormResult.values.default_route_model ?? editorDraft.defaultRoute.model),
    };
    const requestedDraft: EditableExecutionRoutingDraft = {
      defaultRoute: requestedDefaultRoute,
      groups: Object.fromEntries(
        EXECUTION_ROUTING_GROUPS.map((group) => {
          const submittedExecutor = String(routingFormResult.values[`${group}_executor`] ?? editorDraft.groups[group].executor);
          const submittedModel = String(routingFormResult.values[`${group}_model`] ?? editorDraft.groups[group].model);
          const inheritedBeforeEdit =
            editorDraft.groups[group].executor === editorDraft.defaultRoute.executor
            && editorDraft.groups[group].model === editorDraft.defaultRoute.model;
          const groupRoute = inheritedBeforeEdit
            && submittedExecutor === editorDraft.groups[group].executor
            && submittedModel === editorDraft.groups[group].model
            ? requestedDefaultRoute
            : { executor: submittedExecutor as LlmExecutorId, model: submittedModel };
          return [
            group,
            groupRoute,
          ];
        }),
      ) as Record<ExecutionRoutingGroup, EditableRouteDraft>,
    };
    const normalizedDraft = normalizeEditableRoutingDraft(requestedDraft);
    editorDraft = normalizedDraft.draft;
    if (normalizedDraft.validationErrors.length > 0) {
      editorValidationMessage = normalizedDraft.validationErrors.join("\n");
      continue;
    }
    try {
      routing = resolveExecutionRouting({
        defaultRoute: {
          executor: normalizedDraft.draft.defaultRoute.executor,
          model: normalizedDraft.draft.defaultRoute.model,
        },
        currentRunOverrides: normalizedDraft.currentRunOverrides,
      });
    } catch (error) {
      if (error instanceof TaskRunnerError) {
        editorValidationMessage = error.message;
        continue;
      }
      throw error;
    }
    editorDraft = routingEditorDraftFromRouting(routing);
    editorValidationMessage = undefined;
    selectedPreset = { kind: "custom", label: "Custom" };

    const persistenceResult = await requestUserInput(routingPersistenceForm());
    const persistence = String(persistenceResult.values.persistence ?? "current-run");
    if (persistence === "flow-default") {
      selectedPreset = { kind: "flow-default", label: "Flow default" };
      saveFlowDefaultExecutionRouting(flowKey, routing, selectedPreset);
    } else if (persistence === "named-preset") {
      const presetNameResult = await requestUserInput(presetNameForm());
      const presetName = String(presetNameResult.values.name ?? "").trim();
      if (!presetName) {
        throw new TaskRunnerError("Preset name is required.");
      }
      selectedPreset = { kind: "named", presetId: presetName, label: `Named preset: ${presetName}` };
      saveNamedExecutionPreset(presetName, routing, selectedPreset);
    }
  }
}
