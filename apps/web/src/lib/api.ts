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

export const api = createApiClient({
  getCsrfFallback: () => csrfFallback,
  onUnauthorized: () => {
    const now = Date.now();
    if (now - lastFire < 1500) return; // debounce: one expiry flow per burst of 401s
    lastFire = now;
    listeners.forEach((l) => l());
  },
});

export type { Session };

/**
 * `POST /auth/verify-email` (operationId verifyEmail) is in packages/contracts/openapi.yaml, but the
 * generated client types have not been regenerated yet. Typed here by hand from VerifyEmailRequest;
 * remove this wrapper and call `api.POST("/auth/verify-email", ...)` once `pnpm gen` has run.
 */
export function postVerifyEmail(body: { token: string; password?: string }): Promise<{ error?: unknown; response: Response }> {
  const post = api.POST as unknown as (path: string, init: { body: unknown }) => Promise<{ error?: unknown; response: Response }>;
  return post("/auth/verify-email", { body });
}
