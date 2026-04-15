export enum DoctorStatus {
  Ok = "ok",
  Warn = "warn",
  Fail = "fail",
}

export enum ReadinessStatus {
  Ready = "ready",
  ReadyWithWarnings = "ready_with_warnings",
  NotReady = "not_ready",
}

export interface DoctorResult {
  id: string;
  status: DoctorStatus;
  title: string;
  message: string;
  hint?: string;
  details?: string;
}

export interface DoctorCheck {
  id: string;
  category: string;
  title: string;
  execute: () => Promise<DoctorResult>;
  dependencies: string[];
  timeout?: number;
}

export interface DoctorReport {
  overall: ReadinessStatus;
  checks: DoctorResult[];
  timestamp: string;
}