import type { InteractiveSession, InteractiveSessionOptions } from "../session.js";

export function isInkInteractiveSessionAvailable(): boolean {
  return false;
}

export function createInkInteractiveSession(_options: InteractiveSessionOptions): InteractiveSession | null {
  return null;
}
