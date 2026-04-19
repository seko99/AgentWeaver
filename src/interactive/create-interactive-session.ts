import { createInkInteractiveSession, describeInkInteractiveSessionAvailability } from "./ink/index.js";
import type { InteractiveSession, InteractiveSessionOptions } from "./session.js";

export function createInteractiveSession(options: InteractiveSessionOptions): InteractiveSession {
  return createInkInteractiveSession(options);
}

export { describeInkInteractiveSessionAvailability };
