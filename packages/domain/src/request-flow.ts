// Who may drive which request transition. Canonical decisions C-01 and RT-03. The database enforces the same rules.
import { canTransition, type CloseReason, type RequestState } from './request-state.js';
import type { Role } from './roles.js';

export type RequestActor = 'applicant' | 'coordinator' | 'committee' | 'system';
export const STEP_KEYS = ['submitted', 'precheck', 'committee_review', 'decision', 'center_coordination', 'mta_dta', 'delivery', 'closed'] as const;
export type StepKey = (typeof STEP_KEYS)[number];

const A = 'applicant', C = 'coordinator', M = 'committee', S = 'system';
type Rule = readonly RequestActor[];
const RULES: Record<string, Rule> = {
  'draft>submitted': [A],
  'draft>closed': [A, S],
  'submitted>precheck': [C],
  'submitted>closed': [A, C],
  'precheck>needs_info': [C],
  'submitted>committee_review': [],
  'precheck>committee_review': [C],
  'precheck>closed': [A, C],
  'needs_info>precheck': [A],
  'needs_info>closed': [A, S],
  'committee_review>approved': [M],
  'committee_review>rejected': [M],
  'committee_review>needs_info': [M],
  'committee_review>closed': [A],
  'rejected>appeal_review': [A],
  'rejected>closed': [S, C],
  'appeal_review>approved': [M],
  'appeal_review>closed': [M, A],
  'approved>center_coordination': [C],
  'approved>closed': [A, C],
  'center_coordination>agreements': [C],
  'center_coordination>closed': [A, C, S],
  'agreements>delivery': [C],
  'agreements>closed': [A, C, S],
  'delivery>closed': [A, S],
};
export function actorsFor(from: RequestState, to: RequestState): readonly RequestActor[] { return RULES[`${from}>${to}`] ?? []; }

export function actorOf(role: Role, isOwner: boolean): RequestActor[] {
  const out: RequestActor[] = [];
  if (role === 'researcher_il' && isOwner) out.push('applicant');
  if (role === 'national_coordinator') out.push('coordinator');
  if (role === 'committee_member') out.push('committee');
  return out; // system_admin and everybody else: none (separation of duties)
}
export interface TransitionCheck { ok: boolean; reason?: 'illegal' | 'actor' | 'delivered_by_non_applicant' | 'self_precheck' }
/** closed(delivered) is the applicant's confirmation. A coordinator cannot mark delivered (RT-26). */
export function checkTransition(
  from: RequestState, to: RequestState, role: Role, isOwner: boolean, closeReason?: CloseReason, coordinatorIsApplicant = false,
): TransitionCheck {
  if (!canTransition(from, to)) return { ok: false, reason: 'illegal' };
  const actors = actorOf(role, isOwner);
  const allowed = actorsFor(from, to);
  if (!actors.some((a) => allowed.includes(a))) return { ok: false, reason: 'actor' };
  // Only the holding centers confirm delivery (database function request_center_delivered). Expiry is the system timer.
  if (to === 'closed' && (closeReason === 'delivered' || closeReason === 'expired')) return { ok: false, reason: 'delivered_by_non_applicant' };
  if (from === 'submitted' && to === 'precheck' && coordinatorIsApplicant) return { ok: false, reason: 'self_precheck' };
  return { ok: true };
}
export function isTerminal(s: RequestState): boolean { return s === 'closed'; }

/** Stepper step shown to the applicant for a state (REQ-034, 8 steps). */
export function stepForState(s: RequestState): StepKey {
  switch (s) {
    case 'draft': return 'submitted';
    case 'submitted': return 'submitted';
    case 'precheck': case 'needs_info': return 'precheck';
    case 'committee_review': return 'committee_review';
    case 'approved': case 'rejected': case 'appeal_review': return 'decision';
    case 'center_coordination': return 'center_coordination';
    case 'agreements': return 'mta_dta';
    case 'delivery': return 'delivery';
    case 'closed': return 'closed';
  }
}
/** Fields an applicant may edit. Only while draft or needs_info. Applicant cannot reopen a closed request. */
export function applicantMayEdit(s: RequestState): boolean { return s === 'draft' || s === 'needs_info'; }
export function cartMayChange(s: RequestState): boolean { return s === 'draft'; }
