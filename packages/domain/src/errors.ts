// Stable error codes (plan/03-data-integration/yaml/error-codes.yaml). No identifiers or user text in errors.
export const ERROR_STATUS = {
  VALIDATION_FAILED: 422, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409,
  ETAG_MISMATCH: 412, IDEMPOTENCY_CONFLICT: 409, RATE_LIMITED: 429, SOD_VIOLATION: 409,
  IMPORT_FILE_INVALID: 422, IMPORT_FILE_TOO_LARGE: 413, IMPORT_HASH_MISMATCH: 409,
  REQUEST_STATE_INVALID: 409, QUORUM_NOT_REACHED: 409, STEP_UP_REQUIRED: 401, CSRF_INVALID: 403,
  SECOND_APPROVER_REQUIRED: 409, INTERNAL: 500,
  MALFORMED_REQUEST: 400, UNSUPPORTED_MEDIA_TYPE: 415,
} as const;
export type ErrorCode = keyof typeof ERROR_STATUS;
export interface FieldIssue { field: string; rule: string }

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly errors?: FieldIssue[];
  readonly extra?: Record<string, unknown>;
  constructor(code: ErrorCode, errors?: FieldIssue[], extra?: Record<string, unknown>) {
    super(code); this.name = 'DomainError'; this.code = code;
    if (errors) this.errors = errors;
    if (extra) this.extra = extra;
  }
  get status(): number { return ERROR_STATUS[this.code]; }
}
