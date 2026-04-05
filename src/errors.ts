export class TaskRunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskRunnerError";
  }
}

export class FlowInterruptedError extends TaskRunnerError {
  readonly returnCode = 130;

  constructor(message = "Flow interrupted by user.") {
    super(message);
    this.name = "FlowInterruptedError";
  }
}
