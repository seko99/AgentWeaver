import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(MODULE_DIR, "..");
const sourceDir = path.join(PACKAGE_ROOT, "src", "pipeline", "flow-specs");
const targetDir = path.join(PACKAGE_ROOT, "dist", "pipeline", "flow-specs");

if (existsSync(sourceDir)) {
  mkdirSync(targetDir, { recursive: true });
  cpSync(sourceDir, targetDir, { recursive: true });
}
