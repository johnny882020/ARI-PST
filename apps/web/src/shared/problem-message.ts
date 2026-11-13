import { isApiProblem } from "@ari/api-client";
import type { MessageKey } from "@ari/i18n";

/** Localised message key by stable problem code, then by status. Falls back to generic. */
const BY_CODE: Record<string, MessageKey> = {
  INVALID_CREDENTIALS: "auth.login.error.invalid",
  UNAUTHENTICATED: "error.session.body",
  INVALID_MFA_CODE: "auth.error.code",
  RATE_LIMITED: "error.rateLimit.body",
  KANON_SUPPRESSED: "counts.suppressed.label",
  SOD_VIOLATION: "error.sod.body",
  VALIDATION_FAILED: "form.error.summaryGeneric",
  STEP_UP_REQUIRED: "auth.stepUp.body",
  CART_LIMIT: "cart.limit.body",
};

export function problemMessageKey(e: unknown): MessageKey {
  if (isApiProblem(e)) {
    const byCode = BY_CODE[e.code];
    if (byCode) return byCode;
    if (e.status === 429) return "error.rateLimit.body";
    if (e.status === 403) return "error.forbidden.body";
    if (e.status === 404) return "error.notFound.title";
    if (e.status === 409) return "error.conflict.body";
    if (e.status === 413) return "error.tooLarge.body";
  }
  return "error.generic.body";
}

export function traceIdOf(e: unknown): string | undefined {
  return isApiProblem(e) ? e.traceId : undefined;
}
