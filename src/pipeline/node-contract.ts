export type NodeContractPromptMode = "required" | "allowed" | "forbidden";

export type NodeContractMetadata = {
  kind: string;
  version: number;
  prompt: NodeContractPromptMode;
  requiredParams?: string[];
  executors?: string[];
  nestedFlowParam?: string;
};
