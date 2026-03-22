export class TaskRunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskRunnerError";
  }
}
