import path from "node:path";

export function agentweaverHome(packageRoot: string): string {
  const configured = process.env.AGENTWEAVER_HOME?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return packageRoot;
}