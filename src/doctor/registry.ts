import type { DoctorCheck } from "./types.js";

class CheckRegistry {
  private checks: DoctorCheck[] = [];

  register(check: DoctorCheck): void {
    this.checks.push(check);
  }

  getAll(): DoctorCheck[] {
    return [...this.checks];
  }

  getByCategory(category: string): DoctorCheck[] {
    return this.checks.filter((check) => check.category === category);
  }

  getById(id: string): DoctorCheck | undefined {
    return this.checks.find((check) => check.id === id);
  }

  getByTitle(title: string): DoctorCheck | undefined {
    return this.checks.find((check) => check.title === title);
  }

  getDependencyOrder(): DoctorCheck[] {
    const result: DoctorCheck[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (check: DoctorCheck): void => {
      if (visited.has(check.id)) {
        return;
      }
      if (visiting.has(check.id)) {
        throw new Error(`Cycle detected in check dependencies: ${check.id}`);
      }
      visiting.add(check.id);

      for (const depId of check.dependencies) {
        const dep = this.getById(depId);
        if (dep) {
          visit(dep);
        }
      }

      visiting.delete(check.id);
      visited.add(check.id);
      result.push(check);
    };

    for (const check of this.checks) {
      if (!visited.has(check.id)) {
        visit(check);
      }
    }

    return result;
  }
}

export { CheckRegistry };

const REGISTRY = new CheckRegistry();

export { REGISTRY };