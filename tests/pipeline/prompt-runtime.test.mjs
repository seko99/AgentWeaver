import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { renderPrompt } = await import(pathToFileURL(path.join(distRoot, "pipeline/prompt-runtime.js")).href);

function context(mdLang) {
  return {
    flowParams: { mdLang },
    flowConstants: {},
    pipelineContext: {},
    repeatVars: {},
  };
}

describe("prompt runtime markdown language instruction", () => {
  it("scopes mdLang to generated workflow artifacts only", () => {
    const prompt = renderPrompt(
      {
        inlineTemplate: "Write {output_file}.",
        vars: {
          output_file: { const: "artifact.md" },
        },
      },
      context("ru"),
    );

    assert.match(prompt, /Generate workflow markdown artifact files in Russian language\./);
    assert.match(prompt, /applies only to generated AgentWeaver artifacts/);
    assert.match(prompt, /not to repository source files, code comments, committed documentation, or project-local playbook rules/);
    assert.doesNotMatch(prompt, /Generate all markdown output files/);
  });

  it("keeps the same repository-file boundary for English markdown artifacts", () => {
    const prompt = renderPrompt(
      {
        inlineTemplate: "Write {output_file}.",
        vars: {
          output_file: { const: "artifact.md" },
        },
      },
      context("en"),
    );

    assert.match(prompt, /Generate workflow markdown artifact files in English language\./);
    assert.match(prompt, /not to repository source files, code comments, committed documentation, or project-local playbook rules/);
  });
});
