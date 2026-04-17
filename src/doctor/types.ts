export enum DoctorStatus {
  Ok = "ok",
  Warn = "warn",
  Fail = "fail",
}

export enum DoctorImpact {
  Blocking = "blocking",
  Advisory = "advisory",
}

export enum ReadinessStatus {
  Ready = "ready",
  ReadyWithWarnings = "ready_with_warnings",
  NotReady = "not_ready",
}

export enum WorkflowContinuityState {
  Available = "available",
  NeedsPreviousStage = "needs_previous_stage",
  NotConfigured = "not_configured",
  InvalidState = "invalid_state",
}

export interface DoctorResult {
  id: string;
  status: DoctorStatus;
  impact?: DoctorImpact;
  title: string;
  message: string;
  hint?: string;
  details?: string;
  data?: unknown;
}

export interface DoctorCheck {
  id: string;
  category: string;
  title: string;
  impact?: DoctorImpact;
  execute: () => Promise<DoctorResult>;
  dependencies: string[];
  timeout?: number;
}

export interface DoctorReport {
  overall: ReadinessStatus;
  checks: DoctorResult[];
  timestamp: string;
}
