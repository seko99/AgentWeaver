import process from "node:process";

import { BlessedInteractiveSession } from "./blessed-session.js";
import { createInkInteractiveSession, isInkInteractiveSessionAvailable } from "./ink/index.js";
import type { InteractiveRenderer, InteractiveSession, InteractiveSessionOptions } from "./session.js";

function normalizeRenderer(value: string | undefined): InteractiveRenderer | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "ink" || normalized === "blessed") {
    return normalized;
  }
  return null;
}

export function resolveInteractiveRenderer(env: NodeJS.ProcessEnv = process.env): InteractiveRenderer {
  return normalizeRenderer(env.AGENTWEAVER_TUI) ?? "ink";
}

export function resolveEffectiveInteractiveRenderer(
  env: NodeJS.ProcessEnv = process.env,
  inkAvailable = isInkInteractiveSessionAvailable(),
): InteractiveRenderer {
  const requested = resolveInteractiveRenderer(env);
  if (requested === "blessed") {
    return "blessed";
  }
  return inkAvailable ? "ink" : "blessed";
}

export function createInteractiveSession(
  options: InteractiveSessionOptions,
  env: NodeJS.ProcessEnv = process.env,
): InteractiveSession {
  const effectiveRenderer = resolveEffectiveInteractiveRenderer(env);
  if (effectiveRenderer === "ink") {
    const inkSession = createInkInteractiveSession(options);
    if (inkSession) {
      return inkSession;
    }
  }
  return new BlessedInteractiveSession(options);
}
