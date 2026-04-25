import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

type InventoryObservation = {
  kind: string;
  title: string;
  evidence_paths: string[];
  details?: Record<string, unknown>;
};

export type RepoInventory = {
  summary: string;
  repository_root: string;
  generated_at: string;
  ignored_directories: string[];
  stack_indicators: InventoryObservation[];
  test_structure: InventoryObservation[];
  architecture_hints: InventoryObservation[];
  quality_tooling: InventoryObservation[];
  specification_files: InventoryObservation[];
  runtime_configs: InventoryObservation[];
  generated_code: InventoryObservation[];
  evidence: string[];
};

const IGNORED_DIRECTORIES = [".git", "node_modules", "dist", ".agentweaver/scopes/*/.artifacts/manifest-history"];
const EXACT_IGNORED_DIRS = new Set([".git", "node_modules", "dist"]);

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function shouldIgnoreDirectory(relativePath: string): boolean {
  if (!relativePath) {
    return false;
  }
  const parts = toPosix(relativePath).split("/");
  if (parts.some((part) => EXACT_IGNORED_DIRS.has(part))) {
    return true;
  }
  return parts.length >= 5
    && parts[0] === ".agentweaver"
    && parts[1] === "scopes"
    && parts[3] === ".artifacts"
    && parts[4] === "manifest-history";
}

function walkFiles(root: string, directory = root): string[] {
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
  const files: string[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = toPosix(path.relative(root, absolutePath));
    if (entry.isDirectory()) {
      if (!shouldIgnoreDirectory(relativePath)) {
        files.push(...walkFiles(root, absolutePath));
      }
      continue;
    }
    if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function hasFile(files: Set<string>, filePath: string): boolean {
  return files.has(filePath);
}

function addObservation(target: InventoryObservation[], kind: string, title: string, evidence: string[], details?: Record<string, unknown>): void {
  const evidence_paths = Array.from(new Set(evidence)).sort((left, right) => left.localeCompare(right));
  if (evidence_paths.length === 0) {
    return;
  }
  target.push({
    kind,
    title,
    evidence_paths,
    ...(details && Object.keys(details).length > 0 ? { details } : {}),
  });
}

function findByRegex(files: string[], pattern: RegExp): string[] {
  return files.filter((filePath) => pattern.test(filePath)).sort((left, right) => left.localeCompare(right));
}

function readJsonIfPresent(root: string, relativePath: string): Record<string, unknown> | null {
  const filePath = path.join(root, relativePath);
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function detectTextUsage(root: string, files: string[], pattern: RegExp): string[] {
  const candidates = files.filter((filePath) => {
    const absolutePath = path.join(root, filePath);
    try {
      if (statSync(absolutePath).size > 256 * 1024) {
        return false;
      }
      return pattern.test(readFileSync(absolutePath, "utf8"));
    } catch {
      return false;
    }
  });
  return candidates.sort((left, right) => left.localeCompare(right));
}

export function collectRepoInventory(repositoryRoot: string, generatedAt = new Date().toISOString()): RepoInventory {
  const root = path.resolve(repositoryRoot);
  const files = walkFiles(root);
  const fileSet = new Set(files);
  const stack_indicators: InventoryObservation[] = [];
  const test_structure: InventoryObservation[] = [];
  const architecture_hints: InventoryObservation[] = [];
  const quality_tooling: InventoryObservation[] = [];
  const specification_files: InventoryObservation[] = [];
  const runtime_configs: InventoryObservation[] = [];
  const generated_code: InventoryObservation[] = [];

  const packageJson = readJsonIfPresent(root, "package.json");
  if (packageJson) {
    const scripts = packageJson.scripts && typeof packageJson.scripts === "object" && !Array.isArray(packageJson.scripts)
      ? Object.keys(packageJson.scripts as Record<string, unknown>).sort()
      : [];
    addObservation(stack_indicators, "node_package", "Node package manifest", ["package.json"], scripts.length > 0 ? { scripts } : {});
    if (scripts.length > 0) {
      addObservation(quality_tooling, "npm_scripts", "NPM scripts", ["package.json"], { scripts });
    }
  }
  for (const [kind, title, evidence] of [
    ["go_module", "Go module", "go.mod"],
    ["maven_project", "Maven project", "pom.xml"],
    ["gradle_project", "Gradle project", "build.gradle"],
    ["gradle_kotlin_project", "Gradle Kotlin project", "build.gradle.kts"],
    ["typescript_config", "TypeScript configuration", "tsconfig.json"],
    ["dockerfile", "Dockerfile", "Dockerfile"],
    ["makefile", "Makefile", "Makefile"],
  ] as const) {
    if (hasFile(fileSet, evidence)) {
      addObservation(stack_indicators, kind, title, [evidence]);
    }
  }
  addObservation(stack_indicators, "compose_file", "Compose runtime file", findByRegex(files, /(^|\/)(docker-)?compose\.(ya?ml|json)$/i));

  const specFiles = findByRegex(files, /(^|\/)(openapi|swagger|asyncapi|graphql|schema|spec)[^/]*(\.(ya?ml|json|graphql|proto|md))$/i);
  addObservation(specification_files, "api_or_specification", "API or specification files", specFiles);
  if (specFiles.some((filePath) => /openapi|swagger/i.test(filePath))) {
    addObservation(stack_indicators, "openapi_specification", "OpenAPI or Swagger specification", specFiles.filter((filePath) => /openapi|swagger/i.test(filePath)));
  }

  addObservation(test_structure, "test_directories", "Test directories", findByRegex(files, /(^|\/)(tests?|__tests__)\//i).map((filePath) => filePath.split("/").slice(0, -1).join("/")).filter(Boolean));
  addObservation(test_structure, "go_tests", "Go test files", findByRegex(files, /_test\.go$/));
  addObservation(test_structure, "typescript_tests", "TypeScript or JavaScript test files", findByRegex(files, /(\.|\/)(test|spec)\.[cm]?[tj]sx?$/));
  addObservation(test_structure, "java_tests", "Java test files", findByRegex(files, /(^|\/)[^/]*(Test|IT)\.java$/));
  addObservation(test_structure, "fixtures", "Fixture directories or files", findByRegex(files, /(^|\/)(fixtures?|testdata)\//i));
  addObservation(test_structure, "testcontainers_usage", "Testcontainers usage", detectTextUsage(root, files, /testcontainers/i));
  addObservation(test_structure, "mocks_usage", "Mock usage", detectTextUsage(root, files, /\b(mock|vi\.fn|jest\.fn|sinon)\b/i));

  addObservation(architecture_hints, "handlers_or_controllers", "Handlers or controllers", findByRegex(files, /(^|\/)(handlers?|controllers?)\//i));
  addObservation(architecture_hints, "services", "Service modules", findByRegex(files, /(^|\/)services?\//i));
  addObservation(architecture_hints, "repositories", "Repository modules", findByRegex(files, /(^|\/)repositories?\//i));
  addObservation(architecture_hints, "migrations", "Migration files", findByRegex(files, /(^|\/)migrations?\//i));
  addObservation(architecture_hints, "dtos", "DTO modules", findByRegex(files, /(^|\/)(dto|dtos)\//i));

  addObservation(generated_code, "generated_paths", "Generated code paths", findByRegex(files, /(^|\/)(generated|gen)\//i).concat(findByRegex(files, /\.(generated|gen)\./i)));

  addObservation(runtime_configs, "environment_files", "Environment example files", findByRegex(files, /(^|\/)\.env(\.example|\.sample)?$/i));
  addObservation(runtime_configs, "runtime_config_files", "Runtime configuration files", findByRegex(files, /(^|\/)(config|configs)\//i).concat(findByRegex(files, /(^|\/)(app|application|settings)\.(json|ya?ml|toml|properties)$/i)));

  addObservation(quality_tooling, "eslint_config", "ESLint configuration", findByRegex(files, /(^|\/)(eslint\.config\.[cm]?js|\.eslintrc(\..*)?)$/i));
  addObservation(quality_tooling, "prettier_config", "Prettier configuration", findByRegex(files, /(^|\/)(\.prettierrc(\..*)?|prettier\.config\.[cm]?js)$/i));
  addObservation(quality_tooling, "golangci_lint", "golangci-lint configuration", findByRegex(files, /(^|\/)\.golangci\.ya?ml$/i));
  addObservation(quality_tooling, "jest_or_vitest", "Jest or Vitest configuration", findByRegex(files, /(^|\/)(jest|vitest)\.config\.[cm]?[tj]s$/i));
  addObservation(quality_tooling, "ci_config", "CI configuration", findByRegex(files, /(^|\/)(\.github\/workflows\/|\.gitlab-ci\.yml|Jenkinsfile)/i));
  addObservation(quality_tooling, "custom_scripts", "Custom scripts", findByRegex(files, /(^|\/)(scripts?|bin)\//i));

  const observations = [
    ...stack_indicators,
    ...test_structure,
    ...architecture_hints,
    ...quality_tooling,
    ...specification_files,
    ...runtime_configs,
    ...generated_code,
  ];
  const evidence = Array.from(new Set(observations.flatMap((observation) => observation.evidence_paths))).sort((left, right) => left.localeCompare(right));

  return {
    summary: `Repository inventory captured ${evidence.length} evidence paths across stack, tests, architecture, quality, specifications, runtime config, and generated code.`,
    repository_root: root,
    generated_at: generatedAt,
    ignored_directories: [...IGNORED_DIRECTORIES],
    stack_indicators: stack_indicators.sort((left, right) => left.kind.localeCompare(right.kind)),
    test_structure: test_structure.sort((left, right) => left.kind.localeCompare(right.kind)),
    architecture_hints: architecture_hints.sort((left, right) => left.kind.localeCompare(right.kind)),
    quality_tooling: quality_tooling.sort((left, right) => left.kind.localeCompare(right.kind)),
    specification_files: specification_files.sort((left, right) => left.kind.localeCompare(right.kind)),
    runtime_configs: runtime_configs.sort((left, right) => left.kind.localeCompare(right.kind)),
    generated_code: generated_code.sort((left, right) => left.kind.localeCompare(right.kind)),
    evidence,
  };
}

function renderObservationList(observations: InventoryObservation[]): string {
  if (observations.length === 0) {
    return "- Нет подтвержденных сигналов.";
  }
  return observations
    .map((observation) => `- ${observation.title}: ${observation.evidence_paths.join(", ")}`)
    .join("\n");
}

export function renderRepoInventoryMarkdown(inventory: RepoInventory): string {
  return [
    "# Инвентаризация репозитория",
    "",
    inventory.summary,
    "",
    "## Стек",
    renderObservationList(inventory.stack_indicators),
    "",
    "## Тесты",
    renderObservationList(inventory.test_structure),
    "",
    "## Архитектура",
    renderObservationList(inventory.architecture_hints),
    "",
    "## Качество",
    renderObservationList(inventory.quality_tooling),
    "",
    "## Спецификации",
    renderObservationList(inventory.specification_files),
    "",
    "## Runtime-конфигурация",
    renderObservationList(inventory.runtime_configs),
    "",
    "## Сгенерированный код",
    renderObservationList(inventory.generated_code),
    "",
  ].join("\n");
}
