import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(MODULE_DIR, "..");
const assets = [
  {
    source: path.join(PACKAGE_ROOT, "src", "pipeline", "flow-specs"),
    target: path.join(PACKAGE_ROOT, "dist", "pipeline", "flow-specs"),
  },
  {
    source: path.join(PACKAGE_ROOT, "src", "structured-artifact-schemas.json"),
    target: path.join(PACKAGE_ROOT, "dist", "structured-artifact-schemas.json"),
  },
];

for (const asset of assets) {
  if (!existsSync(asset.source)) {
    continue;
  }
  mkdirSync(path.dirname(asset.target), { recursive: true });
  if (existsSync(asset.target)) {
    rmSync(asset.target, { recursive: true, force: true });
  }
  cpSync(asset.source, asset.target, { recursive: true });
}
