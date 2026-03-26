import type {
  VerifyBuildExecutorConfig,
  VerifyBuildExecutorInput,
  VerifyBuildExecutorResult,
} from "../../executors/verify-build-executor.js";
import { printInfo } from "../../tui.js";
import type { PipelineNodeDefinition } from "../types.js";
import { toExecutorContext } from "../types.js";

export type VerifyBuildNodeParams = {
  dockerComposeFile: string;
  labelText: string;
  service?: string;
};

export const verifyBuildNode: PipelineNodeDefinition<VerifyBuildNodeParams, VerifyBuildExecutorResult> = {
  kind: "verify-build",
  version: 1,
  async run(context, params) {
    printInfo(params.labelText);
    const executor = context.executors.get<VerifyBuildExecutorConfig, VerifyBuildExecutorInput, VerifyBuildExecutorResult>(
      "verify-build",
    );
    const value = await executor.execute(
      toExecutorContext(context),
      {
        dockerComposeFile: params.dockerComposeFile,
        ...(params.service ? { service: params.service } : {}),
      },
      executor.defaultConfig,
    );
    return { value };
  },
};
