import process from "node:process";
import { createInterface } from "node:readline/promises";

import { TaskRunnerError } from "./errors.js";

export type UserInputOption = {
  value: string;
  label: string;
  description?: string;
};

export type UserInputFieldDefinition =
  | {
      id: string;
      type: "boolean";
      label: string;
      help?: string;
      required?: boolean;
      default?: boolean;
    }
    | {
      id: string;
      type: "text";
      label: string;
      help?: string;
      required?: boolean;
      default?: string;
      multiline?: boolean;
      rows?: number;
      placeholder?: string;
    }
  | {
      id: string;
      type: "single-select";
      label: string;
      help?: string;
      required?: boolean;
      options: UserInputOption[];
      default?: string;
    }
  | {
      id: string;
      type: "multi-select";
      label: string;
      help?: string;
      required?: boolean;
      options: UserInputOption[];
      default?: string[];
    };

export type UserInputFormDefinition = {
  formId: string;
  title: string;
  description?: string;
  submitLabel?: string;
  fields: UserInputFieldDefinition[];
};

export type UserInputFormValues = Record<string, string | boolean | string[]>;

export type UserInputResult = {
  formId: string;
  submittedAt: string;
  values: UserInputFormValues;
};

export type UserInputRequester = (form: UserInputFormDefinition) => Promise<UserInputResult>;

function normalizeText(value: string): string {
  return value.trim();
}

export function defaultValueForField(field: UserInputFieldDefinition): string | boolean | string[] {
  if (field.type === "boolean") {
    return field.default ?? false;
  }
  if (field.type === "text") {
    return field.default ?? "";
  }
  if (field.type === "single-select") {
    return field.default ?? field.options[0]?.value ?? "";
  }
  return [...(field.default ?? [])];
}

export function buildInitialUserInputValues(fields: UserInputFieldDefinition[]): UserInputFormValues {
  return Object.fromEntries(fields.map((field) => [field.id, defaultValueForField(field)]));
}

export function validateUserInputValues(form: UserInputFormDefinition, values: UserInputFormValues): void {
  for (const field of form.fields) {
    const value = values[field.id];
    if (field.type === "boolean") {
      if (typeof value !== "boolean") {
        throw new TaskRunnerError(`Field '${field.label}' must be a boolean.`);
      }
      continue;
    }

    if (field.type === "text") {
      if (typeof value !== "string") {
        throw new TaskRunnerError(`Field '${field.label}' must be a string.`);
      }
      if (field.required && normalizeText(value).length === 0) {
        throw new TaskRunnerError(`Field '${field.label}' is required.`);
      }
      continue;
    }

    if (field.type === "single-select") {
      if (typeof value !== "string") {
        throw new TaskRunnerError(`Field '${field.label}' must be a string.`);
      }
      if (field.required && normalizeText(value).length === 0) {
        throw new TaskRunnerError(`Field '${field.label}' is required.`);
      }
      if (value && !field.options.some((option) => option.value === value)) {
        throw new TaskRunnerError(`Field '${field.label}' contains an unknown option '${value}'.`);
      }
      continue;
    }

    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      throw new TaskRunnerError(`Field '${field.label}' must be a string array.`);
    }
    if (field.required && value.length === 0) {
      throw new TaskRunnerError(`Field '${field.label}' requires at least one selected option.`);
    }
    const allowed = new Set(field.options.map((option) => option.value));
    for (const item of value) {
      if (!allowed.has(item)) {
        throw new TaskRunnerError(`Field '${field.label}' contains an unknown option '${item}'.`);
      }
    }
  }

  if (form.formId === "review-fix-selection") {
    const applyAll = values.apply_all === true;
    const selectedFindings = Array.isArray(values.selected_findings)
      ? values.selected_findings.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    if (!applyAll && selectedFindings.length === 0) {
      throw new TaskRunnerError("Select at least one finding or enable 'apply all'.");
    }
  }

  if (form.formId === "task-describe-source-input") {
    const jiraRef = typeof values.jira_ref === "string" ? normalizeText(values.jira_ref) : "";
    const taskDescription = typeof values.task_description === "string" ? normalizeText(values.task_description) : "";
    if (!jiraRef && !taskDescription) {
      throw new TaskRunnerError("Provide either Jira URL/key or a short task description.");
    }
    if (jiraRef && taskDescription) {
      throw new TaskRunnerError("Provide either Jira URL/key or a short task description, not both.");
    }
  }
}

function parseBoolean(value: string): boolean | null {
  const normalized = normalizeText(value).toLowerCase();
  if (["y", "yes", "true", "1", "да", "д"].includes(normalized)) {
    return true;
  }
  if (["n", "no", "false", "0", "нет", "н"].includes(normalized)) {
    return false;
  }
  return null;
}

export async function requestUserInputInTerminal(form: UserInputFormDefinition): Promise<UserInputResult> {
  if (form.fields.length === 0) {
    return {
      formId: form.formId,
      submittedAt: new Date().toISOString(),
      values: {},
    };
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new TaskRunnerError(
      `Flow requires interactive user input for form '${form.formId}', but no TTY is available.`,
    );
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    process.stdout.write(`\n${form.title}\n`);
    if (form.description?.trim()) {
      process.stdout.write(`${form.description.trim()}\n`);
    }
    const values = buildInitialUserInputValues(form.fields);

    for (const field of form.fields) {
      if (field.type === "boolean") {
        while (true) {
          const current = values[field.id];
          const answer = await rl.question(`${field.label} [y/n] (${current ? "y" : "n"}): `);
          const parsed = answer.trim() ? parseBoolean(answer) : Boolean(current);
          if (parsed === null) {
            process.stdout.write("Please answer y/n.\n");
            continue;
          }
          values[field.id] = parsed;
          break;
        }
        continue;
      }

      if (field.type === "text") {
        const current = String(values[field.id] ?? "");
        if (field.multiline) {
          process.stdout.write(`${field.label}${current ? " (leave empty to keep current value)" : ""}:\n`);
          if (field.help?.trim()) {
            process.stdout.write(`${field.help.trim()}\n`);
          }
          process.stdout.write("Finish input with an empty line.\n");
          const lines: string[] = [];
          while (true) {
            const line = await rl.question(lines.length === 0 ? "> " : "... ");
            if (!line.trim()) {
              break;
            }
            lines.push(line);
          }
          values[field.id] = lines.length > 0 ? lines.join("\n") : current;
        } else {
          const answer = await rl.question(`${field.label}${current ? ` (${current})` : ""}: `);
          values[field.id] = answer.trim() ? answer : current;
        }
        continue;
      }

      const options = field.options
        .map((option, index) => {
          const description = option.description
            ? `\n   ${option.description.split("\n").join("\n   ")}`
            : "";
          return `${index + 1}. ${option.label}${description}`;
        })
        .join("\n");
      process.stdout.write(`${field.label}\n${options}\n`);
      if (field.type === "single-select") {
        while (true) {
          const current = String(values[field.id] ?? "");
          const answer = await rl.question(`Choose one option${current ? ` (${current})` : ""}: `);
          const raw = answer.trim();
          if (!raw && current) {
            break;
          }
          const index = Number.parseInt(raw, 10) - 1;
          const option = field.options[index];
          if (!option) {
            process.stdout.write("Unknown option number.\n");
            continue;
          }
          values[field.id] = option.value;
          break;
        }
        continue;
      }

      while (true) {
        const current = Array.isArray(values[field.id]) ? (values[field.id] as string[]) : [];
        const answer = await rl.question(
          `Choose one or more options separated by comma${current.length > 0 ? ` (${current.join(", ")})` : ""}: `,
        );
        const raw = answer.trim();
        if (!raw && current.length > 0) {
          break;
        }
        const selected = raw
          .split(",")
          .map((item) => Number.parseInt(item.trim(), 10) - 1)
          .map((index) => field.options[index]?.value)
          .filter((item): item is string => Boolean(item));
        if (selected.length === 0 && field.required) {
          process.stdout.write("Select at least one option.\n");
          continue;
        }
        values[field.id] = selected;
        break;
      }
    }

    validateUserInputValues(form, values);
    return {
      formId: form.formId,
      submittedAt: new Date().toISOString(),
      values,
    };
  } finally {
    rl.close();
  }
}
