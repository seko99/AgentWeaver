import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const sessionFactoryModule = await import(
  pathToFileURL(path.join(distRoot, "interactive/create-interactive-session.js")).href
);

describe("interactive session renderer selection", () => {
  it("explains why interactive mode is unavailable without a TTY", () => {
    assert.match(
      sessionFactoryModule.describeInkInteractiveSessionAvailability(),
      /requires a real TTY|requires installed runtime dependencies/i,
    );
  });

  it("declares the Ink runtime dependencies required by the default renderer", async () => {
    const packageJson = JSON.parse(await readFile(path.resolve(process.cwd(), "package.json"), "utf8"));
    assert.equal(typeof packageJson.dependencies?.ink, "string");
    assert.equal(typeof packageJson.dependencies?.react, "string");
    assert.equal(packageJson.dependencies?.["neo-blessed"], undefined);

    const builtInkSession = await readFile(path.join(distRoot, "interactive/ink/index.js"), "utf8");
    assert.match(builtInkSession, /import\("ink"\)/);
    assert.match(builtInkSession, /import\("react"\)/);
  });
});
