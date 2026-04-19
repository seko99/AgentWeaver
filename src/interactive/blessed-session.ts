import { InteractiveUi } from "../interactive-ui.js";
import type { InteractiveSession, InteractiveSessionOptions } from "./session.js";

export class BlessedInteractiveSession implements InteractiveSession {
  private readonly ui: InteractiveUi;

  constructor(options: InteractiveSessionOptions) {
    this.ui = new InteractiveUi(options);
  }

  mount(): void {
    this.ui.mount();
  }

  destroy(): void {
    this.ui.destroy();
  }

  requestUserInput(form: Parameters<InteractiveUi["requestUserInput"]>[0]) {
    return this.ui.requestUserInput(form);
  }

  setSummary(markdown: string): void {
    this.ui.setSummary(markdown);
  }

  clearSummary(): void {
    this.ui.clearSummary();
  }

  setScope(scopeKey: string, jiraIssueKey?: string | null): void {
    this.ui.setScope(scopeKey, jiraIssueKey);
  }

  appendLog(text: string): void {
    this.ui.appendLog(text);
  }

  setFlowFailed(flowId: string): void {
    this.ui.setFlowFailed(flowId);
  }

  interruptActiveForm(message?: string): void {
    this.ui.interruptActiveForm(message);
  }
}
