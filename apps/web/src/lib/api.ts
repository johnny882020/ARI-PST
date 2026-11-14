import { createApiClient, type Session } from "@ari/api-client";

/** In-memory only. Fallback when the __Host-csrf cookie is unreadable (e.g. plain-http dev). */
let csrfFallback: string | undefined;
export function setCsrfFallback(token: string | undefined) {
  csrfFallback = token;
}

const listeners = new Set<() => void>();
let lastFire = 0;
export function onUnauthorized(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Step-up: a sensitive call (vote, decision, role grant, k change, registration decision...) answers 401 STEP_UP_REQUIRED
 * when the second factor is older than 5 minutes. The StepUpHost dialog registers here. Parallel refusals share one dialog.
 */
type StepUpHandler = () => Promise<boolean>;
let stepUpHandler: StepUpHandler | null = null;
let pendingStepUp: Promise<boolean> | null = null;
export function setStepUpHandler(fn: StepUpHandler | null): void {
  stepUpHandler = fn;
}
export function requestStepUp(): Promise<boolean> {
  if (!stepUpHandler) return Promise.resolve(false);
  if (!pendingStepUp) pendingStepUp = stepUpHandler().finally(() => { pendingStepUp = null; });
  return pendingStepUp;
}

export const api = createApiClient({
  onStepUpRequired: () => requestStepUp(),
  getCsrfFallback: () => csrfFallback,
  onUnauthorized: () => {
    const now = Date.now();
    if (now - lastFire < 1500) return; // debounce: one expiry flow per burst of 401s
    lastFire = now;
    listeners.forEach((l) => l());
  },
});

export type { Session };

