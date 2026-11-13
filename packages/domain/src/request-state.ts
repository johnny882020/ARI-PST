// Canonical request states. Source: plan/11-integration/canonical-decisions.md section 2.
export const REQUEST_STATES = [
  'draft', 'submitted', 'precheck', 'needs_info', 'committee_review', 'appeal_review',
  'approved', 'rejected', 'center_coordination', 'agreements', 'delivery', 'closed',
] as const;
export type RequestState = (typeof REQUEST_STATES)[number];
export const CLOSE_REASONS = ['delivered', 'withdrawn', 'expired', 'rejected', 'policy_cancelled'] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];

export const TRANSITIONS: Readonly<Record<RequestState, readonly RequestState[]>> = {
  draft: ['submitted', 'closed'],
  submitted: ['precheck', 'closed'],
  precheck: ['needs_info', 'committee_review', 'closed'],
  needs_info: ['precheck', 'closed'],
  committee_review: ['approved', 'rejected', 'needs_info', 'closed'],
  rejected: ['appeal_review', 'closed'],
  appeal_review: ['approved', 'closed'],
  approved: ['center_coordination', 'closed'],
  center_coordination: ['agreements', 'closed'],
  agreements: ['delivery', 'closed'],
  delivery: ['closed'],
  closed: [],
};
export function canTransition(from: RequestState, to: RequestState): boolean {
  return TRANSITIONS[from].includes(to);
}
