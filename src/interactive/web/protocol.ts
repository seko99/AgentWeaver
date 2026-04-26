import type { UserInputFormDefinition, UserInputFormValues } from "../../user-input.js";
import type { FlowLaunchMode } from "../../flow-state.js";
import type { InteractiveFlowDefinition } from "../types.js";

export type WebSessionSnapshot = {
  scopeKey: string;
  jiraIssueKey: string | null;
  summaryText: string;
  logs: string[];
  flows: Pick<InteractiveFlowDefinition, "id" | "label" | "description" | "treePath">[];
  failedFlowId: string | null;
  pendingInput: WebPendingInput | null;
  pendingConfirmation: WebPendingConfirmation | null;
  shuttingDown: boolean;
};

export type WebPendingInput = {
  requestId: string;
  form: UserInputFormDefinition;
};

export type WebPendingConfirmation = {
  requestId: string;
  flowId: string;
  mode: FlowLaunchMode;
  details: string | null;
};

export type WebServerMessage =
  | { type: "snapshot"; state: WebSessionSnapshot }
  | { type: "summaryUpdated"; markdown: string }
  | { type: "summaryCleared" }
  | { type: "scopeUpdated"; scopeKey: string; jiraIssueKey: string | null }
  | { type: "logAppended"; text: string }
  | { type: "flowFailed"; flowId: string }
  | { type: "inputRequested"; requestId: string; form: UserInputFormDefinition }
  | { type: "confirmationRequested"; requestId: string; flowId: string; mode: FlowLaunchMode; details: string | null }
  | { type: "formInterrupted"; requestId: string | null; message: string }
  | { type: "shutdown" }
  | { type: "error"; message: string; requestId?: string };

export type WebClientAction =
  | { type: "submitInput"; requestId: string; values: UserInputFormValues }
  | { type: "requestRun"; flowId: string }
  | { type: "cancelInput"; requestId: string }
  | { type: "confirmRun"; requestId: string }
  | { type: "rejectRun"; requestId: string }
  | { type: "interrupt"; flowId?: string }
  | { type: "exit" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRequestId(value: Record<string, unknown>): string {
  if (typeof value.requestId !== "string" || value.requestId.trim().length === 0) {
    throw new Error("Protocol action requires a non-empty requestId.");
  }
  return value.requestId;
}

export function parseWebClientAction(raw: string): WebClientAction {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Protocol message must be valid JSON.");
  }

  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    throw new Error("Protocol message requires a string type.");
  }

  if (parsed.type === "submitInput") {
    const requestId = requireRequestId(parsed);
    if (!isRecord(parsed.values)) {
      throw new Error("submitInput requires object values.");
    }
    return { type: "submitInput", requestId, values: parsed.values as UserInputFormValues };
  }
  if (parsed.type === "requestRun") {
    if (typeof parsed.flowId !== "string" || parsed.flowId.trim().length === 0) {
      throw new Error("requestRun requires a non-empty flowId.");
    }
    return { type: "requestRun", flowId: parsed.flowId };
  }
  if (parsed.type === "cancelInput") {
    return { type: "cancelInput", requestId: requireRequestId(parsed) };
  }
  if (parsed.type === "confirmRun") {
    return { type: "confirmRun", requestId: requireRequestId(parsed) };
  }
  if (parsed.type === "rejectRun") {
    return { type: "rejectRun", requestId: requireRequestId(parsed) };
  }
  if (parsed.type === "interrupt") {
    if (parsed.flowId !== undefined && typeof parsed.flowId !== "string") {
      throw new Error("interrupt flowId must be a string when provided.");
    }
    return parsed.flowId ? { type: "interrupt", flowId: parsed.flowId } : { type: "interrupt" };
  }
  if (parsed.type === "exit") {
    return { type: "exit" };
  }

  throw new Error(`Unknown protocol action: ${parsed.type}`);
}
