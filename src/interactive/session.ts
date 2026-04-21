import type { UserInputFormDefinition, UserInputResult } from "../user-input.js";
import type { FlowLaunchAvailability, FlowLaunchMode } from "../flow-state.js";
import type { InteractiveFlowDefinition } from "./types.js";

export type InteractiveSessionOptions = {
  scopeKey: string;
  jiraIssueKey?: string | null;
  summaryText: string;
  cwd: string;
  gitBranchName: string | null;
  version: string;
  flows: InteractiveFlowDefinition[];
  getRunConfirmation: (flowId: string) => Promise<FlowLaunchAvailability & {
    details?: string | null;
  }>;
  onRun: (flowId: string, mode: FlowLaunchMode) => Promise<void>;
  onInterrupt: (flowId: string) => Promise<void>;
  onExit: () => void;
};

export interface InteractiveSession {
  mount(): void;
  destroy(): void;
  requestUserInput(form: UserInputFormDefinition): Promise<UserInputResult>;
  setSummary(markdown: string): void;
  clearSummary(): void;
  setScope(scopeKey: string, jiraIssueKey?: string | null): void;
  appendLog(text: string): void;
  setFlowFailed(flowId: string): void;
  interruptActiveForm(message?: string): void;
}
