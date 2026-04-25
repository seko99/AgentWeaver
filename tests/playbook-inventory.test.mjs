import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { collectRepoInventory } = await import(pathToFileURL(path.join(distRoot, "playbook/repo-inventory.js")).href);
const { validateStructuredArtifactValue } = await import(pathToFileURL(path.join(distRoot, "structured-artifacts.js")).href);

let repoDir;

function write(relativePath, content = "") {
  const filePath = path.join(repoDir, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");
}

function normalize(inventory) {
  return { ...inventory, generated_at: "<normalized>" };
}

beforeEach(() => {
  repoDir = mkdtempSync(path.join(os.tmpdir(), "agentweaver-playbook-inventory-"));
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe("playbook repository inventory", () => {
  it("captures stack, tests, architecture, quality, specs, runtime config, and generated code deterministically", () => {
    write("package.json", JSON.stringify({ scripts: { test: "vitest", lint: "eslint ." } }));
    write("go.mod", "module example.com/demo\n");
    write("tsconfig.json", "{}\n");
    write("Makefile", "test:\n\tnpm test\n");
    write("openapi.yaml", "openapi: 3.0.0\n");
    write("tests/user.test.ts", "import { vi } from 'vitest'; vi.fn();\n");
    write("src/services/user.ts", "export const userService = {};\n");
    write("src/repositories/user.ts", "export const repo = {};\n");
    write("migrations/001_init.sql", "select 1;\n");
    write("config/app.yaml", "port: 3000\n");
    write("eslint.config.js", "export default [];\n");
    write(".github/workflows/ci.yml", "name: ci\n");
    write("src/generated/client.ts", "export {};\n");
    write("dist/ignored.js", "ignored\n");
    write("node_modules/pkg/index.js", "ignored\n");

    const first = collectRepoInventory(repoDir, "2026-04-25T00:00:00.000Z");
    const second = collectRepoInventory(repoDir, "2026-04-25T00:00:01.000Z");

    assert.doesNotThrow(() => validateStructuredArtifactValue(first, "repo-inventory/v1"));
    assert.deepEqual(normalize(first), normalize(second));
    assert.ok(first.stack_indicators.some((item) => item.kind === "node_package"));
    assert.ok(first.stack_indicators.some((item) => item.kind === "go_module"));
    assert.ok(first.test_structure.some((item) => item.kind === "typescript_tests"));
    assert.ok(first.test_structure.some((item) => item.kind === "mocks_usage"));
    assert.ok(first.architecture_hints.some((item) => item.kind === "services"));
    assert.ok(first.quality_tooling.some((item) => item.kind === "eslint_config"));
    assert.ok(first.quality_tooling.some((item) => item.kind === "ci_config"));
    assert.ok(first.specification_files.some((item) => item.kind === "api_or_specification"));
    assert.ok(first.runtime_configs.some((item) => item.kind === "runtime_config_files"));
    assert.ok(first.generated_code.some((item) => item.kind === "generated_paths"));
    assert.equal(first.evidence.includes("dist/ignored.js"), false);
    assert.equal(first.evidence.includes("node_modules/pkg/index.js"), false);
  });
});
