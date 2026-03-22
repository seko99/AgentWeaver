import type {
  CommandCheckExecutorConfig,
  CommandCheckExecutorInput,
  CommandCheckExecutorResult,
} from "../../executors/command-check-executor.js";
import type { PipelineNodeDefinition } from "../types.js";
import { toExecutorContext } from "../types.js";

export type CommandCheckNodeParams = CommandCheckExecutorInput;

export const commandCheckNode: PipelineNodeDefinition<CommandCheckNodeParams, CommandCheckExecutorResult> = {
  kind: "command-check",
  version: 1,
  async run(context, params) {
    const executor = context.executors.get<
      CommandCheckExecutorConfig,
      CommandCheckExecutorInput,
      CommandCheckExecutorResult
    >("command-check");
    const value = await executor.execute(toExecutorContext(context), params, executor.defaultConfig);
    return { value };
  },
};
