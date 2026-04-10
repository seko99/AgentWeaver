import { describe, it } from "node:test";
import assert from "node:assert";
import { gitCommitExecutor } from "/home/seko/Projects/ai/AgentWeaver/dist/executors/git-commit-executor.js";
import { parsePorcelain } from "/home/seko/Projects/ai/AgentWeaver/dist/pipeline/nodes/git-status-node.js";

describe("parsePorcelain", () => {
  it("parses simple modified file", () => {
    const output = " M file.txt\n";
    const files = parsePorcelain(output);
    assert.strictEqual(files.length, 1);
    assert.strictEqual(files[0].file, "file.txt");
    assert.strictEqual(files[0].type, "modified");
  });

  it("parses staged added file", () => {
    const output = "A  newfile.ts\n";
    const files = parsePorcelain(output);
    assert.strictEqual(files.length, 1);
    assert.strictEqual(files[0].file, "newfile.ts");
    assert.strictEqual(files[0].type, "added");
    assert.strictEqual(files[0].staged, true);
  });

  it("parses untracked file", () => {
    const output = "?? untracked.txt\n";
    const files = parsePorcelain(output);
    assert.strictEqual(files.length, 1);
    assert.strictEqual(files[0].type, "untracked");
  });

  it("parses deleted file", () => {
    const output = "D  deleted.go\n";
    const files = parsePorcelain(output);
    assert.strictEqual(files.length, 1);
    assert.strictEqual(files[0].type, "deleted");
  });

  it("parses renamed file with -> notation", () => {
    const output = "R  old_name.txt -> new_name.txt\n";
    const files = parsePorcelain(output);
    assert.strictEqual(files.length, 1);
    assert.strictEqual(files[0].type, "renamed");
    assert.strictEqual(files[0].file, "new_name.txt");
    assert.strictEqual(files[0].originalFile, "old_name.txt");
  });

  it("parses copied file with -> notation", () => {
    const output = "C  original.txt -> copy.txt\n";
    const files = parsePorcelain(output);
    assert.strictEqual(files.length, 1);
    assert.strictEqual(files[0].type, "modified");
    assert.strictEqual(files[0].file, "copy.txt");
    assert.strictEqual(files[0].originalFile, "original.txt");
  });

  it("parses quoted path with spaces", () => {
    const output = 'A  "file with spaces.txt"\n';
    const files = parsePorcelain(output);
    assert.strictEqual(files.length, 1);
    assert.strictEqual(files[0].file, "file with spaces.txt");
    assert.strictEqual(files[0].type, "added");
  });

  it("parses quoted path with tab", () => {
    const output = 'M  "file\twith\ttabs.txt"\n';
    const files = parsePorcelain(output);
    assert.strictEqual(files[0].file, "file\twith\ttabs.txt");
  });

  it("parses quoted path with newline", () => {
    const output = 'M  "file\\nwith\\nnewlines.txt"\n';
    const files = parsePorcelain(output);
    assert.strictEqual(files[0].file, "file\nwith\nnewlines.txt");
  });

  it("parses quoted path with backslash", () => {
    const output = 'M  "file\\\\with\\\\backslashes.txt"\n';
    const files = parsePorcelain(output);
    assert.strictEqual(files[0].file, "file\\with\\backslashes.txt");
  });

  it("parses quoted path with octal escapes", () => {
    const output = 'M  "file\\101\\102.txt"\n';
    const files = parsePorcelain(output);
    assert.strictEqual(files[0].file, "fileAB.txt");
  });

  it("parses utf-8 path encoded as adjacent octal escapes", () => {
    const output = 'M  "\\320\\277\\321\\200\\320\\270\\320\\262\\320\\265\\321\\202.txt"\n';
    const files = parsePorcelain(output);
    assert.strictEqual(files[0].file, "привет.txt");
  });

  it("parses renamed quoted path", () => {
    const output = 'R  "old file.txt" -> "new file.txt"\n';
    const files = parsePorcelain(output);
    assert.strictEqual(files.length, 1);
    assert.strictEqual(files[0].file, "new file.txt");
    assert.strictEqual(files[0].originalFile, "old file.txt");
    assert.strictEqual(files[0].type, "renamed");
  });

  it("parses file with -> inside quoted path", () => {
    const output = 'M  "arrow -> file.txt"\n';
    const files = parsePorcelain(output);
    assert.strictEqual(files[0].file, "arrow -> file.txt");
    assert.strictEqual(files[0].type, "modified");
  });

  it("parses renamed quoted path when both names contain ->", () => {
    const output = 'R  "old -> file.txt" -> "new -> file.txt"\n';
    const files = parsePorcelain(output);
    assert.strictEqual(files[0].file, "new -> file.txt");
    assert.strictEqual(files[0].originalFile, "old -> file.txt");
    assert.strictEqual(files[0].type, "renamed");
  });

  it("parses copied quoted path with spaces", () => {
    const output = 'C  "original file.txt" -> "copy file.txt"\n';
    const files = parsePorcelain(output);
    assert.strictEqual(files[0].file, "copy file.txt");
    assert.strictEqual(files[0].originalFile, "original file.txt");
  });

  it("parses multiple files", () => {
    const output = "A  added.txt\n M modified.txt\n?? untracked.txt\n";
    const files = parsePorcelain(output);
    assert.strictEqual(files.length, 3);
    assert.strictEqual(files[0].type, "added");
    assert.strictEqual(files[1].type, "modified");
    assert.strictEqual(files[2].type, "untracked");
  });

  it("ignores empty lines", () => {
    const output = "M  file1.txt\n\nM  file2.txt\n";
    const files = parsePorcelain(output);
    assert.strictEqual(files.length, 2);
  });

  it("handles carriage return + linefeed", () => {
    const output = "M  file.txt\r\n";
    const files = parsePorcelain(output);
    assert.strictEqual(files.length, 1);
    assert.strictEqual(files[0].file, "file.txt");
  });

  it("extracts correct xy status codes", () => {
    const output = "MR modified.txt\n";
    const files = parsePorcelain(output);
    assert.strictEqual(files[0].xy, "MR");
    assert.strictEqual(files[0].indexStatus, "M");
    assert.strictEqual(files[0].workTreeStatus, "R");
  });

  it("sets staged true when index status is not space or question mark", () => {
    const output = "M  staged.txt\n";
    const files = parsePorcelain(output);
    assert.strictEqual(files[0].staged, true);
  });

  it("sets staged false when index status is space", () => {
    const output = " M unstaged.txt\n";
    const files = parsePorcelain(output);
    assert.strictEqual(files[0].staged, false);
  });

  it("sets staged false when index status is question mark", () => {
    const output = "?? untracked.txt\n";
    const files = parsePorcelain(output);
    assert.strictEqual(files[0].staged, false);
  });
});

describe("gitCommitExecutor", () => {
  it("passes a parsed path with spaces to git add as a single argument", async () => {
    const porcelain = '?? "file with spaces.txt"\n';
    const files = parsePorcelain(porcelain).map((entry) => entry.file);
    const commands = [];

    assert.deepStrictEqual(files, ["file with spaces.txt"]);

    const result = await gitCommitExecutor.execute(
      {
        cwd: process.cwd(),
        env: process.env,
        ui: {},
        dryRun: false,
        verbose: false,
        runtime: {
          resolveCmd: (commandName) => commandName,
          resolveDockerComposeCmd: () => [],
          dockerRuntimeEnv: () => process.env,
          runCommand: async (argv) => {
            commands.push(argv);
            if (argv[0] === "git" && argv[1] === "commit") {
              return "[main abc1234] commit spaced file\n 1 file changed, 1 insertion(+)\n";
            }
            return "";
          },
        },
      },
      {
        message: "commit spaced file",
        files,
      },
      {},
    );

    assert.match(result.output, /commit spaced file/);
    assert.match(result.commitHash ?? "", /^[0-9a-f]{7,40}$/);
    assert.deepStrictEqual(commands, [
      ["git", "add", "file with spaces.txt"],
      ["git", "commit", "-m", "commit spaced file"],
    ]);
  });
});
