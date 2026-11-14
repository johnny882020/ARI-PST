// Maps PostgreSQL errors raised by the database rules (functions, triggers, RLS) to domain errors. Messages are fixed words, never values.
import { DomainError, type ErrorCode } from '@ari/domain';

const BY_MESSAGE: Record<string, ErrorCode> = {
  forbidden: 'FORBIDDEN', session_denied: 'UNAUTHENTICATED', stepup_required: 'STEP_UP_REQUIRED', second_approver_required: 'SECOND_APPROVER_REQUIRED',
  separation_of_duties: 'SOD_VIOLATION', conflict_of_interest: 'SOD_VIOLATION', conflict_own_request: 'SOD_VIOLATION', ineligible_appeal_voter: 'SOD_VIOLATION',
  invalid_transition: 'REQUEST_STATE_INVALID', voting_closed: 'REQUEST_STATE_INVALID', appeal_not_allowed: 'REQUEST_STATE_INVALID', closed_is_terminal: 'REQUEST_STATE_INVALID',
  request_form_locked: 'REQUEST_STATE_INVALID', state_change_via_functions_only: 'FORBIDDEN', requests_created_via_function_only: 'FORBIDDEN',
  info_rounds_exhausted: 'REQUEST_STATE_INVALID', agreements_missing: 'REQUEST_STATE_INVALID', center_not_involved: 'REQUEST_STATE_INVALID',
  form_incomplete: 'VALIDATION_FAILED', checklist_incomplete: 'VALIDATION_FAILED', no_resolved_samples: 'VALIDATION_FAILED', reason_required: 'VALIDATION_FAILED',
  sample_not_found: 'VALIDATION_FAILED', too_many_items: 'VALIDATION_FAILED', k_floor: 'VALIDATION_FAILED', k_below_default: 'VALIDATION_FAILED',
  invalid_role: 'VALIDATION_FAILED', invalid_center: 'VALIDATION_FAILED', invalid_status: 'VALIDATION_FAILED', invalid_kind: 'VALIDATION_FAILED',
  email_not_verified: 'CONFLICT', user_closed: 'CONFLICT', admin_exists: 'CONFLICT', self_change_denied: 'SOD_VIOLATION', already_voted: 'CONFLICT',
  ethics_center_mismatch: 'VALIDATION_FAILED', donor_inconsistent: 'VALIDATION_FAILED', commit_requires_validated_dry_run: 'CONFLICT',
  invalid_import_transition: 'CONFLICT', invalid_import_status: 'CONFLICT', filter_limit: 'VALIDATION_FAILED', invalid_filters: 'VALIDATION_FAILED', unknown_facet: 'VALIDATION_FAILED',
  signed_month_required: 'VALIDATION_FAILED', signed_month_in_future: 'VALIDATION_FAILED', invalid_agreement_status: 'VALIDATION_FAILED',
  not_found: 'NOT_FOUND',
};
export function mapPgError(e: unknown): unknown {
  if (e instanceof DomainError) return e;
  const err = e as { code?: string; message?: string; constraint?: string };
  if (!err || typeof err.code !== 'string') return e;
  const msg = (err.message ?? '').trim();
  const known = BY_MESSAGE[msg];
  if (known) return new DomainError(known);
  switch (err.code) {
    case 'P0002': return new DomainError('NOT_FOUND');
    case '42501': return new DomainError('FORBIDDEN');                      // RLS or privilege
    case '23505': return new DomainError('CONFLICT');
    case '23503': return new DomainError('VALIDATION_FAILED', [{ field: '$', rule: 'VOCAB' }]);
    case '23514': case '22023': case '22P02': case '22007': case '22008': case '23502': return new DomainError('VALIDATION_FAILED', [{ field: '$', rule: 'FORMAT' }]);
    case '57014': return new DomainError('RATE_LIMITED');                    // statement_timeout
    default: return e;
  }
}
export const isUndefinedObject = (e: unknown): boolean => { const c = (e as { code?: string })?.code; return c === '42883' || c === '42P01' || c === '3F000'; };
