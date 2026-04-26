import type { UserInputFormValues } from "../../user-input.js";
import type { FocusPane } from "../types.js";
import type { InteractiveSessionViewModel } from "../view-model.js";

export type ServerEvent =
  | { type: "snapshot"; viewModel: InteractiveSessionViewModel }
  | { type: "log.append"; appendedLines: string[] }
  | { type: "error"; message: string; requestId?: string; actionId?: string }
  | { type: "closed"; reason?: string };

export type ClientAction =
  | { type: "flow.select"; index?: number; key?: string; actionId?: string }
  | { type: "folder.toggle"; key: string; actionId?: string }
  | { type: "run.openConfirm"; flowId?: string; key?: string; actionId?: string }
  | { type: "confirm.select"; action: string; actionId?: string }
  | { type: "confirm.accept"; action?: string; actionId?: string }
  | { type: "confirm.cancel"; actionId?: string }
  | { type: "form.update"; values: UserInputFormValues; actionId?: string }
  | { type: "form.fieldUpdate"; fieldId: string; value: UserInputFormValues[string]; actionId?: string }
  | { type: "form.submit"; values?: UserInputFormValues; actionId?: string }
  | { type: "form.cancel"; actionId?: string }
  | { type: "interrupt.openConfirm"; actionId?: string }
  | { type: "flow.interrupt"; flowId?: string; actionId?: string }
  | { type: "log.clear"; actionId?: string }
  | { type: "help.toggle"; visible?: boolean; actionId?: string }
  | { type: "scroll"; pane: FocusPane | "help"; delta?: number; offset?: number; actionId?: string };

const ACTION_TYPES = new Set([
  "flow.select",
  "folder.toggle",
  "run.openConfirm",
  "confirm.select",
  "confirm.accept",
  "confirm.cancel",
  "form.update",
  "form.fieldUpdate",
  "form.submit",
  "form.cancel",
  "interrupt.openConfirm",
  "flow.interrupt",
  "log.clear",
  "help.toggle",
  "scroll",
]);

const SCROLL_PANES = new Set(["flows", "progress", "summary", "log", "help"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalActionId(value: Record<string, unknown>): string | undefined {
  if (value.actionId === undefined) {
    return undefined;
  }
  if (typeof value.actionId !== "string" || value.actionId.trim().length === 0) {
    throw new Error("actionId must be a non-empty string when provided.");
  }
  return value.actionId;
}

function requireNonEmptyString(value: Record<string, unknown>, fieldName: string): string {
  const field = value[fieldName];
  if (typeof field !== "string" || field.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return field;
}

function optionalNonEmptyString(value: Record<string, unknown>, fieldName: string): string | undefined {
  if (value[fieldName] === undefined) {
    return undefined;
  }
  return requireNonEmptyString(value, fieldName);
}

function optionalInteger(value: Record<string, unknown>, fieldName: string): number | undefined {
  if (value[fieldName] === undefined) {
    return undefined;
  }
  const field = value[fieldName];
  if (typeof field !== "number" || !Number.isInteger(field)) {
    throw new Error(`${fieldName} must be an integer.`);
  }
  return field;
}

function requireValues(value: Record<string, unknown>, fieldName = "values"): UserInputFormValues {
  const values = value[fieldName];
  if (!isRecord(values)) {
    throw new Error(`${fieldName} must be an object.`);
  }
  return values as UserInputFormValues;
}

export function parseClientAction(raw: string): ClientAction {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Protocol message must be valid JSON.");
  }

  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    throw new Error("Protocol message requires a string type.");
  }
  if (!ACTION_TYPES.has(parsed.type)) {
    throw new Error(`Unknown protocol action: ${parsed.type}`);
  }

  const actionId = optionalActionId(parsed);
  if (parsed.type === "flow.select") {
    const index = optionalInteger(parsed, "index");
    const key = optionalNonEmptyString(parsed, "key");
    if (index === undefined && key === undefined) {
      throw new Error("flow.select requires index or key.");
    }
    return { type: "flow.select", ...(index !== undefined ? { index } : {}), ...(key ? { key } : {}), ...(actionId ? { actionId } : {}) };
  }
  if (parsed.type === "folder.toggle") {
    return { type: "folder.toggle", key: requireNonEmptyString(parsed, "key"), ...(actionId ? { actionId } : {}) };
  }
  if (parsed.type === "run.openConfirm") {
    const flowId = optionalNonEmptyString(parsed, "flowId");
    const key = optionalNonEmptyString(parsed, "key");
    return { type: "run.openConfirm", ...(flowId ? { flowId } : {}), ...(key ? { key } : {}), ...(actionId ? { actionId } : {}) };
  }
  if (parsed.type === "confirm.select") {
    return { type: "confirm.select", action: requireNonEmptyString(parsed, "action"), ...(actionId ? { actionId } : {}) };
  }
  if (parsed.type === "confirm.accept") {
    const action = optionalNonEmptyString(parsed, "action");
    return { type: "confirm.accept", ...(action ? { action } : {}), ...(actionId ? { actionId } : {}) };
  }
  if (parsed.type === "confirm.cancel" || parsed.type === "form.cancel" || parsed.type === "log.clear") {
    return { type: parsed.type, ...(actionId ? { actionId } : {}) } as ClientAction;
  }
  if (parsed.type === "form.update") {
    return { type: "form.update", values: requireValues(parsed), ...(actionId ? { actionId } : {}) };
  }
  if (parsed.type === "form.fieldUpdate") {
    const fieldId = requireNonEmptyString(parsed, "fieldId");
    if (!("value" in parsed)) {
      throw new Error("value is required.");
    }
    const value = parsed.value;
    if (
      typeof value !== "string"
      && typeof value !== "boolean"
      && (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    ) {
      throw new Error("value must be a string, boolean, or string array.");
    }
    return { type: "form.fieldUpdate", fieldId, value, ...(actionId ? { actionId } : {}) };
  }
  if (parsed.type === "form.submit") {
    return {
      type: "form.submit",
      ...(parsed.values !== undefined ? { values: requireValues(parsed) } : {}),
      ...(actionId ? { actionId } : {}),
    };
  }
  if (parsed.type === "interrupt.openConfirm") {
    return { type: "interrupt.openConfirm", ...(actionId ? { actionId } : {}) };
  }
  if (parsed.type === "flow.interrupt") {
    const flowId = optionalNonEmptyString(parsed, "flowId");
    return { type: "flow.interrupt", ...(flowId ? { flowId } : {}), ...(actionId ? { actionId } : {}) };
  }
  if (parsed.type === "help.toggle") {
    if (parsed.visible !== undefined && typeof parsed.visible !== "boolean") {
      throw new Error("visible must be a boolean when provided.");
    }
    return { type: "help.toggle", ...(parsed.visible !== undefined ? { visible: parsed.visible } : {}), ...(actionId ? { actionId } : {}) };
  }

  const pane = requireNonEmptyString(parsed, "pane");
  if (!SCROLL_PANES.has(pane)) {
    throw new Error("scroll pane must be one of flows, progress, summary, log, or help.");
  }
  const delta = optionalInteger(parsed, "delta");
  const offset = optionalInteger(parsed, "offset");
  if (delta === undefined && offset === undefined) {
    throw new Error("scroll requires delta or offset.");
  }
  return {
    type: "scroll",
    pane: pane as FocusPane | "help",
    ...(delta !== undefined ? { delta } : {}),
    ...(offset !== undefined ? { offset } : {}),
    ...(actionId ? { actionId } : {}),
  };
}
