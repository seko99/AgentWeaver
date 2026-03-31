import type {
  JiraFetchExecutorConfig,
  JiraFetchExecutorInput,
  JiraFetchExecutorResult,
} from "../../executors/jira-fetch-executor.js";
import type { NodeCheckSpec, NodeOutputSpec, PipelineNodeDefinition } from "../types.js";
import { toExecutorContext } from "../types.js";

export type JiraFetchNodeParams = {
  jiraApiUrl: string;
  outputFile: string;
  attachmentsManifestFile?: string;
  attachmentsContextFile?: string;
};

export const jiraFetchNode: PipelineNodeDefinition<JiraFetchNodeParams, JiraFetchExecutorResult> = {
  kind: "jira-fetch",
  version: 1,
  async run(context, params) {
    const executor = context.executors.get<JiraFetchExecutorConfig, JiraFetchExecutorInput, JiraFetchExecutorResult>("jira-fetch");
    const value = await executor.execute(
      toExecutorContext(context),
      {
        jiraApiUrl: params.jiraApiUrl,
        outputFile: params.outputFile,
        ...(params.attachmentsManifestFile ? { attachmentsManifestFile: params.attachmentsManifestFile } : {}),
        ...(params.attachmentsContextFile ? { attachmentsContextFile: params.attachmentsContextFile } : {}),
      },
      executor.defaultConfig,
    );
    const outputs: NodeOutputSpec[] = [{ kind: "file", path: params.outputFile, required: true }];
    if (params.attachmentsManifestFile) {
      outputs.push({ kind: "artifact", path: params.attachmentsManifestFile, required: true });
    }
    if (params.attachmentsContextFile) {
      outputs.push({ kind: "artifact", path: params.attachmentsContextFile, required: true });
    }
    return {
      value,
      outputs,
    };
  },
  checks(_context, params) {
    const checks: NodeCheckSpec[] = [
      {
        kind: "require-file",
        path: params.outputFile,
        message: `Jira fetch node did not produce ${params.outputFile}.`,
      },
    ];
    if (params.attachmentsManifestFile) {
      checks.push({
        kind: "require-file",
        path: params.attachmentsManifestFile,
        message: `Jira fetch node did not produce ${params.attachmentsManifestFile}.`,
      });
    }
    if (params.attachmentsContextFile) {
      checks.push({
        kind: "require-file",
        path: params.attachmentsContextFile,
        message: `Jira fetch node did not produce ${params.attachmentsContextFile}.`,
      });
    }
    return checks;
  },
};
