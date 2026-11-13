// RFC 9457 Problem Details. Fixed sentence per code. No identifiers and no user text in any member.
import { DomainError, ERROR_STATUS, type ErrorCode, type FieldIssue } from '@ari/domain';

const TITLES: Record<ErrorCode, { slug: string; title: string; detail: string }> = {
  VALIDATION_FAILED: { slug: 'validation-failed', title: 'Validation failed', detail: 'One or more fields are not valid.' },
  UNAUTHENTICATED: { slug: 'unauthenticated', title: 'Not authenticated', detail: 'Sign in to continue.' },
  FORBIDDEN: { slug: 'forbidden', title: 'Forbidden', detail: 'Your role cannot do this.' },
  NOT_FOUND: { slug: 'not-found', title: 'Not found', detail: 'The resource does not exist or is not visible to you.' },
  CONFLICT: { slug: 'conflict', title: 'Conflict', detail: 'The request conflicts with the current state.' },
  ETAG_MISMATCH: { slug: 'etag-mismatch', title: 'Precondition failed', detail: 'The resource changed. Reload and try again.' },
  IDEMPOTENCY_CONFLICT: { slug: 'idempotency-conflict', title: 'Idempotency conflict', detail: 'This key was used with a different request.' },
  RATE_LIMITED: { slug: 'rate-limited', title: 'Too many requests', detail: 'Try again later.' },
  SOD_VIOLATION: { slug: 'separation-of-duties', title: 'Separation of duties', detail: 'This combination of roles or actions is not allowed.' },
  IMPORT_FILE_INVALID: { slug: 'import-file-invalid', title: 'Import file invalid', detail: 'The file cannot be processed.' },
  IMPORT_FILE_TOO_LARGE: { slug: 'import-file-too-large', title: 'File too large', detail: 'The file is larger than the limit.' },
  IMPORT_HASH_MISMATCH: { slug: 'import-hash-mismatch', title: 'Import hash mismatch', detail: 'The file differs from the validated dry run.' },
  REQUEST_STATE_INVALID: { slug: 'request-state-invalid', title: 'Request state invalid', detail: 'This step is not allowed in the current request state.' },
  QUORUM_NOT_REACHED: { slug: 'quorum-not-reached', title: 'Quorum not reached', detail: 'Not enough committee votes for this outcome.' },
  STEP_UP_REQUIRED: { slug: 'step-up-required', title: 'Re-authentication required', detail: 'Confirm your second factor to continue.' },
  CSRF_INVALID: { slug: 'csrf-invalid', title: 'Request rejected', detail: 'The request failed a cross-site check.' },
  SECOND_APPROVER_REQUIRED: { slug: 'second-approver-required', title: 'Second approver required', detail: 'A different administrator must approve this change.' },
  INTERNAL: { slug: 'internal', title: 'Internal error', detail: 'Something went wrong. Quote the trace id to support.' },
};
export interface Problem { type: string; title: string; status: number; detail: string; code: ErrorCode; traceId: string; instance?: string; errors?: FieldIssue[] }

export function problemFor(code: ErrorCode, traceId: string, errors?: FieldIssue[]): Problem {
  const t = TITLES[code];
  const p: Problem = { type: `/problems/${t.slug}`, title: t.title, status: ERROR_STATUS[code], detail: t.detail, code, traceId };
  if (errors && errors.length) p.errors = errors;
  return p;
}
export function toProblem(err: unknown, traceId: string): Problem {
  if (err instanceof DomainError) return problemFor(err.code, traceId, err.errors);
  return problemFor('INTERNAL', traceId);
}
export class HttpProblem extends DomainError {
  constructor(code: ErrorCode, public readonly headers: Record<string, string> = {}, errors?: FieldIssue[]) { super(code, errors); }
}
