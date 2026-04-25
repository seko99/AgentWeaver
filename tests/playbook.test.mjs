import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { loadProjectPlaybook } = await import(pathToFileURL(path.join(distRoot, "runtime/playbook.js")).href);

let tempDir;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), "agentweaver-playbook-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function writePlaybookFile(relativePath, content) {
  const filePath = path.join(tempDir, ".agentweaver/playbook", relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");
  return filePath;
}

function writeValidPlaybook(overrides = {}) {
  writePlaybookFile("project.md", "# Project\n");
  writePlaybookFile(
    "practices/typescript.md",
    `---
id: practice.typescript
title: TypeScript runtime checks
phases: [implement, review]
applies_to:
  languages: [typescript]
  frameworks: [node]
  globs: ["src/**/*.ts"]
  keywords: [validation]
priority: 10
severity: must
related_examples: [example.validation]
---
Use typed validation at runtime boundaries.
`,
  );
  writePlaybookFile(
    "examples/validation.md",
    `---
id: example.validation
title: Validation example
phases: [implement]
severity: should
related_practices: [practice.typescript]
---
Keep examples path-addressable.
`,
  );
  writePlaybookFile("templates/default.md", "# Template\n");

  const manifest =
    overrides.manifest ??
    `version: 1
project:
  name: AgentWeaver
  stack: [node]
  languages: [typescript]
  frameworks: [node]
context_budgets:
  plan: 1000
  design_review: 1200
  implement: 2000
  review: 1000
  repair: 900
practices:
  globs: ["practices/*.md"]
examples:
  paths: ["examples/validation.md"]
templates:
  paths: ["templates/default.md"]
always_include: ["project.md"]
selection:
  include_examples: true
  max_examples: 3
`;
  writePlaybookFile("manifest.yaml", manifest);
}

async function assertPlaybookError(pattern) {
  assert.throws(() => loadProjectPlaybook(tempDir), pattern);
}

describe("project playbook loader", () => {
  it("loads a valid manifest, markdown frontmatter, and referenced files", () => {
    writeValidPlaybook();

    const playbook = loadProjectPlaybook(tempDir);

    assert.equal(playbook.manifest.version, 1);
    assert.equal(playbook.manifest.project.name, "AgentWeaver");
    assert.equal(playbook.manifest.context_budgets.implement, 2000);
    assert.equal(playbook.practices.length, 1);
    assert.equal(playbook.practices[0].id, "practice.typescript");
    assert.equal(playbook.practices[0].metadata.severity, "must");
    assert.deepEqual(playbook.practices[0].metadata.applies_to.languages, ["typescript"]);
    assert.equal(playbook.examples.length, 1);
    assert.equal(playbook.examples[0].id, "example.validation");
    assert.deepEqual(playbook.templates, ["templates/default.md"]);
    assert.deepEqual(playbook.alwaysInclude, ["project.md"]);
  });

  it("fails clearly for malformed manifest YAML", async () => {
    writeValidPlaybook({ manifest: "version: [1\nproject:\n  name: AgentWeaver\n" });

    await assertPlaybookError(/Invalid YAML.*manifest\.yaml.*Malformed inline array/);
  });

  it("fails clearly for unsupported manifest versions", async () => {
    writeValidPlaybook({
      manifest: `version: 2
project:
  name: AgentWeaver
`,
    });

    await assertPlaybookError(/version.*Unsupported playbook version 2.*Supported version: 1/);
  });

  it("fails clearly for missing referenced files", async () => {
    writeValidPlaybook({
      manifest: `version: 1
project:
  name: AgentWeaver
practices:
  paths: ["practices/missing.md"]
examples:
  paths: ["examples/validation.md"]
templates:
  paths: ["templates/default.md"]
always_include: ["missing.md"]
`,
    });

    await assertPlaybookError(/Missing playbook file referenced by manifest\.yaml: practices\.paths\[0\].*practices\/missing\.md/);
  });

  it("rejects duplicate ids across practices and examples", async () => {
    writeValidPlaybook();
    writePlaybookFile(
      "examples/validation.md",
      `---
id: practice.typescript
title: Duplicate id
phases: [review]
---
Duplicate.
`,
    );

    await assertPlaybookError(/Duplicate playbook id "practice\.typescript".*examples\/validation\.md.*practices\/typescript\.md/);
  });

  it("validates malformed practice and example frontmatter", async () => {
    writeValidPlaybook();
    writePlaybookFile(
      "practices/typescript.md",
      `---
id: [broken
title: Broken
---
Broken.
`,
    );

    await assertPlaybookError(/Invalid YAML.*practices\/typescript\.md.*Malformed inline array/);
  });

  it("rejects invalid frontmatter phase values", async () => {
    writeValidPlaybook();
    writePlaybookFile(
      "examples/validation.md",
      `---
id: example.validation
title: Validation example
phases: [deploy]
severity: blocker
---
Invalid.
`,
    );

    await assertPlaybookError(/frontmatter\.phases.*Unsupported phase "deploy"/);
  });

  it("rejects invalid frontmatter severity values", async () => {
    writeValidPlaybook();
    writePlaybookFile(
      "examples/validation.md",
      `---
id: example.validation
title: Validation example
phases: [implement]
severity: blocker
---
Invalid.
`,
    );

    await assertPlaybookError(/frontmatter\.severity.*Unsupported severity "blocker"/);
  });

  it("rejects unknown relationship references", async () => {
    writeValidPlaybook();
    writePlaybookFile(
      "examples/validation.md",
      `---
id: example.validation
title: Validation example
phases: [implement]
severity: should
related_practices: [practice.missing]
---
Broken reference.
`,
    );

    await assertPlaybookError(/Unknown playbook relationship id "practice\.missing".*examples\/validation\.md/);
  });

  it("rejects unsupported context budget phases", async () => {
    writeValidPlaybook({
      manifest: `version: 1
project:
  name: AgentWeaver
context_budgets:
  deploy: 100
practices:
  paths: ["practices/typescript.md"]
examples:
  paths: ["examples/validation.md"]
templates:
  paths: ["templates/default.md"]
`,
    });

    await assertPlaybookError(/context_budgets\.deploy.*Supported phases: plan, design_review, implement, review, repair/);
  });

  it("rejects path traversal outside the playbook root", async () => {
    writeValidPlaybook({
      manifest: `version: 1
project:
  name: AgentWeaver
practices:
  paths: ["../outside.md"]
examples:
  paths: ["examples/validation.md"]
templates:
  paths: ["templates/default.md"]
`,
    });

    await assertPlaybookError(/path traversal is not allowed.*practices\.paths\[0\]/);
  });
});
